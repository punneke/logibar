use tauri::{Manager, PhysicalPosition};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
