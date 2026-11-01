//! The state the core loops share: the ports the use cases read and the device state they change (design.md § Runtime,
//! state and telemetry). Loops never hold a lock across an await; the view is published after each change.

use std::sync::Arc;

use crate::device_state::DeviceState;
use crate::ports::{
    ApiError, IdGenerator, ProcessSource, StateSink, TextReader, TokenStore, WallClock,
};
use crate::updates::Updater;

/// The ports the pairing loop uses (AHM-17): exactly three.
pub struct PairingPorts<G> {
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub clock: Arc<dyn WallClock + Send + Sync>,
}

/// The ports the heartbeat loop uses (AHM-17): exactly three.
pub struct HeartbeatPorts<G> {
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub processes: Arc<dyn ProcessSource + Send + Sync>,
}

/// The ports the stream loop uses (AHM-17): exactly two.
pub struct StreamPorts<G> {
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
}

/// The ports the update loop uses (AHM-17): exactly one.
pub struct UpdatePorts {
    pub updater: Arc<dyn Updater>,
}

/// The ports the frame read and the observation post use (AHM-17): exactly five, not widened.
pub struct ReadPorts<G> {
    pub reader: Arc<dyn TextReader + Send + Sync>,
    pub ids: Arc<dyn IdGenerator + Send + Sync>,
    pub clock: Arc<dyn WallClock + Send + Sync>,
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
}

/// The five port groups the composition root builds, one per loop (AHM-17). No group holds every port.
pub struct Groups<G> {
    pub pairing: PairingPorts<G>,
    pub heartbeat: HeartbeatPorts<G>,
    pub stream: StreamPorts<G>,
    pub update: UpdatePorts,
    pub read: ReadPorts<G>,
}

/// Everything the loops share. Built once by `Context::from_groups` and kept in an `Arc`. `G` is the API gateway the
/// composition root supplies.
pub struct Context<G> {
    pub version: String,
    /// The API as the use cases see it (the gateway port). Every API call of the loops goes through it.
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub processes: Arc<dyn ProcessSource + Send + Sync>,
    pub reader: Arc<dyn TextReader + Send + Sync>,
    pub ids: Arc<dyn IdGenerator + Send + Sync>,
    pub updater: Arc<dyn Updater>,
    pub clock: Arc<dyn WallClock + Send + Sync>,
    /// The paired device, the room and the signals that wake the loops (AGS-08, AGS-14, AGS-27).
    pub device: Arc<DeviceState>,
}

impl<G> Context<G> {
    /// Builds the context from the five port groups. The shared ports come from the group that names them first (the
    /// pairing group for the gateway, tokens and clock); the groups hold clones of the same `Arc`s, so every loop sees one
    /// store. The stream group holds the same gateway and tokens and adds nothing the context does not already hold.
    pub fn from_groups(
        version: String,
        sink: Arc<dyn StateSink + Send + Sync>,
        groups: Groups<G>,
    ) -> Arc<Self> {
        let Groups {
            pairing,
            heartbeat,
            read,
            update,
            ..
        } = groups;
        Arc::new(Self {
            version,
            gateway: pairing.gateway,
            tokens: pairing.tokens,
            processes: heartbeat.processes,
            reader: read.reader,
            ids: read.ids,
            updater: update.updater,
            clock: pairing.clock,
            device: Arc::new(DeviceState::new(sink)),
        })
    }

    /// A 401 on any request: the token goes, the room goes, and the pairing loop shows a new code (AGS-08).
    pub fn on_unauthorized(&self) {
        self.device.on_unauthorized(self.tokens.as_ref());
    }

    /// A 426 on any request: the API loops stop until an update installs and the update loop checks now (AGS-27).
    pub fn on_upgrade_required(&self) {
        self.device.on_upgrade_required(self.tokens.as_ref());
    }

    /// Applies what a failed API request means for the whole agent: a 401 is `on_unauthorized`, a 426 is
    /// `on_upgrade_required`. Every other error changes nothing here; each loop decides what its own failure means.
    pub fn handle_api_error(&self, error: &ApiError) {
        self.device.handle_api_error(error, self.tokens.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use chrono::{DateTime, Utc};

    use super::{
        Context, Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
    };
    use crate::fakes::{FakeApiGateway, MemoryTokens, NoProcesses, NoText, NoUpdates, NullSink};
    use crate::ports::{SequentialIds, TokenStore, WallClock};

    struct FixedClock;

    impl WallClock for FixedClock {
        fn now_utc(&self) -> DateTime<Utc> {
            "2026-10-31T10:00:00Z".parse().expect("a valid instant")
        }
    }

    #[test]
    fn groups_build_a_context() {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        let clock: Arc<dyn WallClock + Send + Sync> = Arc::new(FixedClock);
        let groups = Groups {
            pairing: PairingPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
                clock: Arc::clone(&clock),
            },
            heartbeat: HeartbeatPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
                processes: Arc::new(NoProcesses),
            },
            stream: StreamPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
            },
            update: UpdatePorts {
                updater: Arc::new(NoUpdates),
            },
            read: ReadPorts {
                reader: Arc::new(NoText),
                ids: Arc::new(SequentialIds::new()),
                clock,
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
            },
        };
        let ctx = Context::from_groups("0.0.1".to_string(), Arc::new(NullSink), groups);

        assert_eq!(ctx.version, "0.0.1");
        assert_eq!(ctx.device.epoch(), 0);
        assert!(!ctx.device.is_paired(), "a context starts unpaired");
        assert!(ctx.gateway.calls().is_empty(), "the gateway port is wired");
        assert!(tokens.load().is_none(), "the token store is shared");
    }
}
