//! The stream reconnection service (AHM-11, AHM-15; AD-059). A dropped stream reconnects after 1 s, the delay doubling after
//! each completed sleep up to 60 s. A stream that stayed open for at least 60 s starts the backoff again. The service reads
//! no clock: the caller measures how long a stream stayed open and does the sleeping.

use std::time::Duration;

use crate::timings::{RECONNECT_MAX, RECONNECT_MIN, RESET_AFTER_OPEN};

/// The reconnect delay of the event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reconnect {
    delay: Duration,
}

impl Reconnect {
    /// The first delay: `RECONNECT_MIN`.
    pub fn new() -> Self {
        Self {
            delay: RECONNECT_MIN,
        }
    }

    /// The delay to wait before the next connection.
    pub fn delay(&self) -> Duration {
        self.delay
    }

    /// Records a completed sleep: the next delay doubles, and never exceeds `RECONNECT_MAX`. An interrupted sleep is not
    /// recorded, so the caller does not call this for it.
    pub fn slept(&mut self) {
        self.delay = (self.delay * 2).min(RECONNECT_MAX);
    }

    /// Records how long the last stream stayed open. At `RESET_AFTER_OPEN` or more, the backoff starts again.
    pub fn opened_for(&mut self, open: Duration) {
        if open >= RESET_AFTER_OPEN {
            self.delay = RECONNECT_MIN;
        }
    }
}

impl Default for Reconnect {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::Reconnect;

    #[test]
    fn reconnect_doubles_to_sixty_and_resets_at_sixty_seconds() {
        let mut reconnect = Reconnect::new();
        let mut seen = [Duration::ZERO; 8];
        for slot in &mut seen {
            *slot = reconnect.delay();
            reconnect.slept();
        }
        assert_eq!(
            seen,
            [1, 2, 4, 8, 16, 32, 60, 60].map(Duration::from_secs),
            "1 s, doubling to 60 s and staying there"
        );

        reconnect.opened_for(Duration::from_secs(60));
        assert_eq!(
            reconnect.delay(),
            Duration::from_secs(1),
            "a stream open for 60 s resets the delay"
        );
    }

    #[test]
    fn interrupted_sleep_does_not_double() {
        let mut reconnect = Reconnect::new();
        reconnect.slept();
        assert_eq!(reconnect.delay(), Duration::from_secs(2));

        // An interrupted sleep (a 401 or a 426) records nothing, so the delay stays where it was.
        assert_eq!(reconnect.delay(), Duration::from_secs(2));

        reconnect.slept();
        assert_eq!(reconnect.delay(), Duration::from_secs(4));
    }

    #[test]
    fn open_for_fifty_nine_point_nine_nine_nine_seconds_keeps_the_delay() {
        let mut reconnect = Reconnect::new();
        reconnect.slept();
        reconnect.slept();
        assert_eq!(reconnect.delay(), Duration::from_secs(4));

        reconnect.opened_for(Duration::from_millis(59_999));
        assert_eq!(
            reconnect.delay(),
            Duration::from_secs(4),
            "59.999 s is short of the reset"
        );

        reconnect.opened_for(Duration::from_secs(60));
        assert_eq!(
            reconnect.delay(),
            Duration::from_secs(1),
            "60 s resets the delay"
        );
    }
}
