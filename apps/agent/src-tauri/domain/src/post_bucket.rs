//! A sliding-window cap on posts (server-name-match: at most 20 chat sightings a minute). Pure: the caller passes the
//! instant, so a test moves the clock by hand. A post is allowed when fewer than `limit` posts were allowed in the `window`
//! before it; a refused post is not counted, so the cap never starves the next window.

use std::collections::VecDeque;
use std::time::Duration;

use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostBucket {
    limit: usize,
    window: Duration,
    taken: VecDeque<DateTime<Utc>>,
}

impl PostBucket {
    pub fn new(limit: usize, window: Duration) -> Self {
        Self {
            limit,
            window,
            taken: VecDeque::new(),
        }
    }

    /// The chat post's cap: 20 a minute.
    pub fn per_minute(limit: usize) -> Self {
        Self::new(limit, Duration::from_secs(60))
    }

    /// Takes a place at `now`: `true` when one was free. A place taken `window` ago or more is free again, and one taken in
    /// the future (the clock went back) is forgotten.
    pub fn take(&mut self, now: DateTime<Utc>) -> bool {
        let window = chrono::Duration::from_std(self.window).unwrap_or(chrono::Duration::MAX);
        self.taken
            .retain(|&at| at <= now && now.signed_duration_since(at) < window);
        if self.taken.len() >= self.limit {
            return false;
        }
        self.taken.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use chrono::{DateTime, TimeDelta, Utc};

    use super::PostBucket;

    fn start() -> DateTime<Utc> {
        "2026-11-21T10:00:00Z".parse().expect("a valid instant")
    }

    #[test]
    fn twenty_places_a_minute_and_the_twenty_first_is_refused() {
        let mut bucket = PostBucket::per_minute(20);
        for _ in 0..20 {
            assert!(bucket.take(start()));
        }
        assert!(!bucket.take(start()));
    }

    #[test]
    fn a_place_is_free_again_exactly_after_the_window() {
        let mut bucket = PostBucket::per_minute(1);
        assert!(bucket.take(start()));
        assert!(!bucket.take(start() + TimeDelta::seconds(59)));
        assert!(bucket.take(start() + TimeDelta::seconds(60)));
    }

    #[test]
    fn a_refused_take_is_not_counted() {
        let mut bucket = PostBucket::per_minute(1);
        assert!(bucket.take(start()));
        assert!(!bucket.take(start() + TimeDelta::seconds(30)));
        assert!(bucket.take(start() + TimeDelta::seconds(60)));
    }

    #[test]
    fn places_slide_one_by_one() {
        let mut bucket = PostBucket::per_minute(2);
        assert!(bucket.take(start()));
        assert!(bucket.take(start() + TimeDelta::seconds(30)));
        assert!(!bucket.take(start() + TimeDelta::seconds(40)));
        assert!(bucket.take(start() + TimeDelta::seconds(60)));
        assert!(!bucket.take(start() + TimeDelta::seconds(61)));
        assert!(bucket.take(start() + TimeDelta::seconds(90)));
    }

    #[test]
    fn a_clock_that_goes_back_forgets_the_future_places() {
        let mut bucket = PostBucket::per_minute(1);
        assert!(bucket.take(start() + TimeDelta::seconds(100)));
        assert!(bucket.take(start()));
    }

    #[test]
    fn a_limit_of_zero_allows_nothing() {
        let mut bucket = PostBucket::new(0, Duration::from_secs(60));
        assert!(!bucket.take(start()));
    }
}
