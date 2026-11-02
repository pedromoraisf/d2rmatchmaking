//! The port groups the composition root builds, one per loop (AHM-17). Each group holds exactly the ports its use case
//! uses, and no group holds every port. The runtime hands each loop its own group.

use std::sync::Arc;

use crate::check_update::Updater;
use crate::ports::{IdGenerator, ProcessSource, TextReader, TokenStore, WallClock};

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

/// The five port groups the composition root builds, one per loop (AHM-17).
pub struct Groups<G> {
    pub pairing: PairingPorts<G>,
    pub heartbeat: HeartbeatPorts<G>,
    pub stream: StreamPorts<G>,
    pub update: UpdatePorts,
    pub read: ReadPorts<G>,
}
