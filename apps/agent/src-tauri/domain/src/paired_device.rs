//! The device rules (AHM-08, AHM-15; ADR 027). The device holds the pairing state and whether a token is held, and it
//! decides what a `401` and a `426` mean for the agent. It returns the effects, in order, and the application applies
//! them to its ports, its view and its signals. It reads no clock and no store.

use crate::pairing::Pairing;

/// What the application does after the device has decided. Each effect is applied once, in the order returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceEffect {
    /// Delete the stored token.
    ForgetToken,
    /// Clear the held room assignment and its view.
    ClearRoom,
    /// Overtake the observation retries that are waiting (the retry epoch moved).
    DropPendingRetries,
    /// Show the pairing screen and ask for a new code.
    AskNewCode,
    /// Show "Update required" and stop the API loops.
    RequireUpdate,
    /// Wake the update loop for a check now.
    CheckForUpdateNow,
}

/// The pairing state, the token's presence, the pending update gate and the retry epoch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairedDevice {
    pairing: Pairing,
    paired: bool,
    update_required: bool,
    epoch: u64,
}

impl PairedDevice {
    /// No token is held, no code is shown and no update is pending.
    pub fn unpaired() -> Self {
        Self {
            pairing: Pairing::new(),
            paired: false,
            update_required: false,
            epoch: 0,
        }
    }

    /// A token is held and no update is pending.
    pub fn paired() -> Self {
        Self {
            paired: true,
            ..Self::unpaired()
        }
    }

    /// The pairing state.
    pub fn pairing(&self) -> &Pairing {
        &self.pairing
    }

    /// The pairing state, to be driven by the pairing use case.
    pub fn pairing_mut(&mut self) -> &mut Pairing {
        &mut self.pairing
    }

    /// Whether a token is held.
    pub fn is_paired(&self) -> bool {
        self.paired
    }

    /// Records whether a token is held (a claim stored one, or the store was read at start).
    pub fn set_paired(&mut self, paired: bool) {
        self.paired = paired;
    }

    /// Whether a `426` is pending and no update has installed since.
    pub fn update_required(&self) -> bool {
        self.update_required
    }

    /// An installed update clears the pending `426`.
    pub fn update_installed(&mut self) {
        self.update_required = false;
    }

    /// A `401` on any request: the token goes, the room goes, a new code is asked and pending retries are overtaken.
    pub fn on_unauthorized(&mut self) -> Vec<DeviceEffect> {
        self.paired = false;
        self.bump_epoch();
        vec![
            DeviceEffect::ForgetToken,
            DeviceEffect::ClearRoom,
            DeviceEffect::DropPendingRetries,
            DeviceEffect::AskNewCode,
        ]
    }

    /// A `426` on any request: the update gate is raised, pending retries are overtaken and an update check runs now.
    pub fn on_upgrade_required(&mut self) -> Vec<DeviceEffect> {
        self.update_required = true;
        self.bump_epoch();
        vec![
            DeviceEffect::RequireUpdate,
            DeviceEffect::DropPendingRetries,
            DeviceEffect::CheckForUpdateNow,
        ]
    }

    /// Whether the API loops may run: a token is held and no `426` is pending.
    pub fn api_allowed(&self) -> bool {
        self.paired && !self.update_required
    }

    /// Whether the pairing loop may run: no `426` is pending.
    pub fn pairing_allowed(&self) -> bool {
        !self.update_required
    }

    /// The current retry epoch. A retry that started under an older epoch was overtaken by a `401` or a `426`.
    pub fn retry_epoch(&self) -> u64 {
        self.epoch
    }

    fn bump_epoch(&mut self) {
        self.epoch = self.epoch.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::{DeviceEffect, PairedDevice};
    use crate::pairing::PairingCode;

    #[test]
    fn pairing_accessors_read_and_write_the_device_state() {
        let mut device = PairedDevice::unpaired();
        assert!(
            device.pairing().code().is_none(),
            "nothing is shown at start"
        );

        let expires_at = Utc.timestamp_opt(300, 0).single().expect("a valid instant");
        device
            .pairing_mut()
            .show(PairingCode::new("123456").expect("six digits"), expires_at);

        assert_eq!(
            device.pairing().code().map(PairingCode::as_str),
            Some("123456"),
            "pairing_mut writes the state that pairing reads"
        );
        assert_eq!(device.pairing().expires_at(), Some(expires_at));
    }

    #[test]
    fn update_required_follows_the_426_and_the_install() {
        let mut device = PairedDevice::paired();
        assert!(!device.update_required(), "no 426 is pending at start");

        device.on_upgrade_required();
        assert!(device.update_required(), "a 426 raises the gate");

        device.update_installed();
        assert!(
            !device.update_required(),
            "an installed update clears the gate"
        );
    }

    #[test]
    fn paired_device_401_and_426_effects_in_order() {
        let mut on_401 = PairedDevice::paired();
        assert_eq!(
            on_401.on_unauthorized(),
            vec![
                DeviceEffect::ForgetToken,
                DeviceEffect::ClearRoom,
                DeviceEffect::DropPendingRetries,
                DeviceEffect::AskNewCode,
            ]
        );
        assert!(!on_401.is_paired(), "a 401 forgets the token");

        let mut on_426 = PairedDevice::paired();
        assert_eq!(
            on_426.on_upgrade_required(),
            vec![
                DeviceEffect::RequireUpdate,
                DeviceEffect::DropPendingRetries,
                DeviceEffect::CheckForUpdateNow,
            ]
        );
        assert!(on_426.update_required(), "a 426 raises the update gate");
        assert!(on_426.is_paired(), "a 426 keeps the token");
    }

    #[test]
    fn epoch_bumps_on_both() {
        let mut device = PairedDevice::unpaired();
        assert_eq!(device.retry_epoch(), 0);

        device.on_unauthorized();
        assert_eq!(device.retry_epoch(), 1, "a 401 overtakes pending retries");

        device.on_upgrade_required();
        assert_eq!(device.retry_epoch(), 2, "a 426 overtakes pending retries");
    }

    #[test]
    fn api_allowed_needs_a_token_and_no_pending_update() {
        let mut device = PairedDevice::unpaired();
        assert!(!device.api_allowed(), "no token, no API call");
        assert!(device.pairing_allowed(), "pairing needs no token");

        device.set_paired(true);
        assert!(device.api_allowed(), "a token and no 426 allow the API");

        device.on_upgrade_required();
        assert!(!device.api_allowed(), "a pending 426 blocks the API");
        assert!(!device.pairing_allowed(), "a pending 426 blocks pairing");

        device.update_installed();
        assert!(device.api_allowed(), "an installed update reopens the API");

        device.on_unauthorized();
        assert!(!device.api_allowed(), "a 401 removes the token");
    }
}
