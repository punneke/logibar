//! Minimal stub of the reference project's config module.
//!
//! The widget doesn't persist device profiles — this only exists so
//! `hid/client.rs` can compile unchanged. `load_device_profiles` always returns
//! an empty set and `save_device_profiles` is a no-op.

use anyhow::Result;
use std::collections::HashMap;

/// What we learned about a device the first time we enumerated it — which HID++
/// 2.0 battery feature to use and its table index, plus the display name.
#[derive(Clone, Debug)]
pub struct DeviceProfile {
    pub battery_feature_id: u16,
    pub battery_feature_index: u8,
    pub name: String,
}

/// In-memory map of WPID (lower-case hex, e.g. "4099") -> [`DeviceProfile`].
#[derive(Clone, Debug, Default)]
pub struct DeviceProfiles {
    pub devices: HashMap<String, DeviceProfile>,
}

impl DeviceProfiles {
    /// Format a WPID as the map key.
    pub fn key(wpid: u16) -> String {
        format!("{wpid:04x}")
    }

    pub fn get(&self, wpid: u16) -> Option<&DeviceProfile> {
        self.devices.get(&Self::key(wpid))
    }

    /// Insert/replace a profile, returning true if it changed.
    pub fn upsert(&mut self, wpid: u16, profile: DeviceProfile) -> bool {
        match self.devices.get(&Self::key(wpid)) {
            Some(existing)
                if existing.battery_feature_id == profile.battery_feature_id
                    && existing.battery_feature_index == profile.battery_feature_index
                    && existing.name == profile.name =>
            {
                false
            }
            _ => {
                self.devices.insert(Self::key(wpid), profile);
                true
            }
        }
    }
}

/// No persistence for the widget — always returns an empty set.
pub fn load_device_profiles() -> DeviceProfiles {
    DeviceProfiles::default()
}

/// No persistence for the widget — no-op.
pub fn save_device_profiles(_profiles: &DeviceProfiles) -> Result<()> {
    Ok(())
}
