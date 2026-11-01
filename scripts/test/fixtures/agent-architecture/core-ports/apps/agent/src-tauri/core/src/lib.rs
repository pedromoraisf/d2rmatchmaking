// Fixture: a struct in core that holds six ports, one more than the limit of five.
#![forbid(unsafe_code)]

use std::sync::Arc;

pub struct Ports {
    pub tokens: Arc<dyn TokenStore>,
    pub processes: Arc<dyn ProcessSource>,
    pub reader: Arc<dyn TextReader>,
    pub ids: Arc<dyn IdGenerator>,
    pub updater: Arc<dyn Updater>,
    pub clock: Arc<dyn WallClock>,
}
