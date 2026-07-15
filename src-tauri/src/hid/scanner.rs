use anyhow::{Context, Result};
use hidapi::{HidApi, HidDevice};

pub const LOGITECH_VID: u16 = 0x046D;

/// The HID++ vendor interface on Logitech receivers uses this usage page.
const HIDPP_USAGE_PAGE: u16 = 0xFF00;

/// A discovered Logitech HID++ receiver, with both vendor collections it exposes.
///
/// On Windows a receiver presents the HID++ command interface (MI_02) as two
/// top-level collections at separate device paths: usage 0x0001 (short, 0x10
/// reports) and usage 0x0002 (long, 0x11 reports). HID++ 2.0 device traffic
/// (ping, enumeration, battery) goes on the long collection; the HID++ 1.0
/// receiver registers and the device-connection notification live on the short
/// collection (confirmed on C547 via `--diag`). We keep both.
#[derive(Clone, Debug)]
pub struct ReceiverPath {
    pub pid: u16,
    /// usage 0x0002 — HID++ 2.0 device traffic. Always present (selection key).
    pub long_path: std::ffi::CString,
    /// usage 0x0001 — receiver registers + connection notifications. Absent on
    /// receivers that don't expose a short vendor collection.
    pub short_path: Option<std::ffi::CString>,
}

/// HID++ usage for the long-report (0x11, 20-byte) collection. Modern devices
/// reply on this channel, so we must talk to it rather than the short (0x01) one.
const HIDPP_LONG_USAGE: u16 = 0x0002;
/// HID++ usage for the short-report (0x10, 7-byte) collection — receiver
/// registers and notifications.
const HIDPP_SHORT_USAGE: u16 = 0x0001;

/// Scan for all Logitech HID++ receiver interfaces.
///
/// We look for any device with VID 0x046D and usage_page 0xFF00.
/// This covers Unifying receivers, LIGHTSPEED nano-receivers, and
/// Bolt receivers without needing a hardcoded PID list.
///
/// On Windows the HID++ command interface (MI_02) exposes two top-level
/// collections: usage 0x0001 (short, 0x10 reports) and usage 0x0002 (long,
/// 0x11 reports) as separate device paths. We prefer the long one because
/// wireless devices answer on the long channel; a short request to the device
/// gets no reply on the short handle. We deduplicate by PID.
/// Compute a stable key that maps every HID interface belonging to the same
/// physical dongle to the same string, so we don't merge two dongles that share
/// a PID (e.g. two LIGHTSPEED receivers with PID_C547).
///
/// On Windows the HID path looks like:
///     `\\?\HID#VID_046D&PID_C547&MI_02&Col01#a&215d9e4d&0&0000#{guid}`
/// The short (Col01) and long (Col02) collections of the same dongle share the
/// middle instance-ID segment except for the trailing collection index. We
/// normalise both by stripping the `&Col0X` chunk from segment 1 and the
/// trailing `&NNNN` from segment 2. Falls back to (pid, serial) on paths that
/// don't match the Windows shape.
fn dedup_key(info: &hidapi::DeviceInfo) -> String {
    let path = info.path().to_string_lossy().to_ascii_lowercase();
    let parts: Vec<&str> = path.split('#').collect();
    if parts.len() >= 3 {
        let iface = parts[1].replace("&col01", "").replace("&col02", "");
        let inst = match parts[2].rfind('&') {
            Some(idx) => &parts[2][..idx],
            None => parts[2],
        };
        format!("{iface}#{inst}")
    } else {
        format!(
            "{:04x}|{}",
            info.product_id(),
            info.serial_number().unwrap_or("")
        )
    }
}

pub fn scan_receivers(api: &HidApi) -> Vec<ReceiverPath> {
    // key -> (pid, long?, short?) grouped by physical dongle. Two dongles that
    // share a PID (e.g. two LIGHTSPEED receivers) must not be merged; we key on
    // the device path with the Windows collection tag stripped so both usages
    // of the same physical device produce the same key. Falls back to (pid,
    // serial) on paths that don't look like Windows HID paths.
    let mut found: std::collections::HashMap<
        String,
        (u16, Option<std::ffi::CString>, Option<std::ffi::CString>),
    > = std::collections::HashMap::new();

    for info in api.device_list() {
        if info.vendor_id() != LOGITECH_VID || info.usage_page() != HIDPP_USAGE_PAGE {
            continue;
        }
        let key = dedup_key(info);
        let entry = found
            .entry(key)
            .or_insert_with(|| (info.product_id(), None, None));
        match info.usage() {
            HIDPP_LONG_USAGE => entry.1 = Some(info.path().to_owned()),
            HIDPP_SHORT_USAGE => entry.2 = Some(info.path().to_owned()),
            _ => {}
        }
    }

    found
        .into_iter()
        // The long collection is required (device traffic); without it the
        // receiver is unusable for our purposes.
        .filter_map(|(_key, (pid, long, short))| {
            long.map(|long_path| ReceiverPath {
                pid,
                long_path,
                short_path: short,
            })
        })
        .collect()
}

/// Open the long (0x0002) collection — HID++ 2.0 device traffic.
pub fn open_receiver(api: &HidApi, receiver: &ReceiverPath) -> Result<HidDevice> {
    api.open_path(receiver.long_path.as_c_str())
        .with_context(|| format!("failed to open receiver {:04X}", receiver.pid))
}

/// Open the short (0x0001) collection — receiver registers + notifications.
/// Errors if the receiver exposes no short collection.
pub fn open_notifier(api: &HidApi, receiver: &ReceiverPath) -> Result<HidDevice> {
    let path = receiver
        .short_path
        .as_ref()
        .with_context(|| format!("receiver {:04X} has no short collection", receiver.pid))?;
    api.open_path(path.as_c_str())
        .with_context(|| format!("failed to open receiver {:04X} notifier", receiver.pid))
}
