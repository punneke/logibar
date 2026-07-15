mod config;
mod device_map;
mod hid;
mod model;

use serde::Serialize;
use std::sync::mpsc;
use tauri::{Emitter, Manager, PhysicalPosition};

use crate::hid::client::{spawn_receiver_worker, DeviceEvent, WorkerCommand};
use crate::hid::scanner::scan_receivers;

#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    match app.get_webview_window("settings") {
        Some(w) => {
            tracing::info!("open_settings: showing window");
            w.show().map_err(|e| format!("show failed: {e}"))?;
            w.unminimize().ok();
            w.set_focus().map_err(|e| format!("focus failed: {e}"))?;
            Ok(())
        }
        None => {
            tracing::warn!("open_settings: no window with label 'settings'");
            Err("settings window not registered".into())
        }
    }
}

#[derive(Clone, Serialize)]
struct BatteryPayload {
    device_key: String,
    device_kind: String,
    name: String,
    percentage: Option<u8>,
    charging: bool,
}

/// Short stable id derived from the receiver's HID path — needed because two
/// dongles can share a PID *and* have a device on the same slot, which would
/// otherwise collapse into a single `device_key` in the frontend.
fn short_id(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:08x}", h.finish() as u32)
}

fn device_kind(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.contains("keyboard")
        || lower.contains("keys")
        || lower.contains("g715")
        || lower.contains("g915")
        || lower.contains("g815")
    {
        return "keyboard";
    }
    if lower.contains("mouse")
        || lower.contains("mx master")
        || lower.contains("mx anywhere")
        || lower.contains("superlight")
        || lower.contains("pro x wireless")
        || lower.contains("pro wireless")
        || lower.contains("g pro")
        || lower.contains("g502")
        || lower.contains("g703")
        || lower.contains("g903")
    {
        return "mouse";
    }
    "other"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| {
                    tracing_subscriber::EnvFilter::new("logibar_lib=debug,info")
                }),
        )
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_settings])
        .on_window_event(|window, event| {
            // Intercept X on the settings window so it stays alive and can be
            // reopened via "Manage devices…" instead of being destroyed.
            if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let window = app.get_webview_window("widget").unwrap();
            if let Some(monitor) = window.current_monitor()? {
                let screen = monitor.size();
                let size = window.outer_size()?;
                let margin = 20u32;
                let x = screen.width.saturating_sub(size.width).saturating_sub(margin);
                let y = screen.height.saturating_sub(size.height).saturating_sub(60);
                window.set_position(PhysicalPosition::new(x as i32, y as i32))?;
            }

            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let api = match hidapi::HidApi::new() {
                    Ok(api) => api,
                    Err(err) => {
                        tracing::warn!("failed to initialize hidapi: {err}");
                        return;
                    }
                };

                let receivers = scan_receivers(&api);
                tracing::info!("found {} Logitech HID++ receiver(s)", receivers.len());

                // Workers treat a disconnected command channel as Exit, so hold
                // onto the senders for the app's lifetime — we never send commands
                // but the workers must keep running.
                let mut senders: Vec<mpsc::Sender<WorkerCommand>> = Vec::new();
                for receiver in receivers {
                    let rid = short_id(&receiver.long_path.to_string_lossy());
                    tracing::info!(
                        "spawning worker for receiver {rid} (PID {:04X})",
                        receiver.pid
                    );
                    let (tx, rx) = mpsc::channel();
                    let emit_handle = app_handle.clone();
                    spawn_receiver_worker(receiver, 180, rx, move |event| {
                        let payload = match event {
                            DeviceEvent::Update(state) => BatteryPayload {
                                device_key: format!("{rid}:{}", state.device_key),
                                device_kind: device_kind(&state.display_name).to_string(),
                                name: state.display_name,
                                percentage: Some(state.battery_percent),
                                charging: state.is_charging,
                            },
                            DeviceEvent::Gone(device_key) => BatteryPayload {
                                device_key: format!("{rid}:{}", device_key),
                                device_kind: "other".to_string(),
                                name: String::new(),
                                percentage: None,
                                charging: false,
                            },
                        };
                        if let Err(err) = emit_handle.emit("battery-update", payload) {
                            tracing::warn!("failed to emit battery-update: {err}");
                        }
                    });
                    senders.push(tx);
                }
                std::mem::forget(senders);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
