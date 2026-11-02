//! The agent's span queue (OBS-18, AD-096). A bounded FIFO that drops its oldest entry when it is full, so the newest
//! spans survive a relay outage. Pure: the `DropOldestProcessor` of `export.rs` holds one behind a lock.

use std::collections::VecDeque;

/// Spans the agent keeps waiting for export.
pub const SPAN_QUEUE_CAPACITY: usize = 2048;

/// A FIFO of at most `capacity` entries. A push at capacity drops the oldest entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedQueue<T> {
    items: VecDeque<T>,
    capacity: usize,
}

impl<T> BoundedQueue<T> {
    /// Creates an empty queue. A capacity of zero is a programming error.
    pub fn new(capacity: usize) -> Self {
        assert!(
            capacity > 0,
            "a bounded queue needs a capacity of at least one"
        );
        Self {
            items: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// Appends `item`. At capacity the oldest entry is removed and returned.
    pub fn push(&mut self, item: T) -> Option<T> {
        let dropped = if self.items.len() >= self.capacity {
            self.items.pop_front()
        } else {
            None
        };
        self.items.push_back(item);
        dropped
    }

    /// Removes up to `max` entries, the oldest first.
    pub fn drain(&mut self, max: usize) -> Vec<T> {
        let count = max.min(self.items.len());
        self.items.drain(..count).collect()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::{BoundedQueue, SPAN_QUEUE_CAPACITY};

    #[test]
    fn a_full_queue_of_2048_drops_the_oldest_span() {
        let mut queue = BoundedQueue::new(SPAN_QUEUE_CAPACITY);
        for span in 0..SPAN_QUEUE_CAPACITY {
            assert_eq!(queue.push(span), None, "no drop below capacity");
        }
        assert_eq!(queue.len(), 2048);

        let dropped = queue.push(SPAN_QUEUE_CAPACITY);

        assert_eq!(dropped, Some(0), "the 2049th push drops the oldest span");
        assert_eq!(queue.len(), 2048, "the queue stays at capacity");
        assert_eq!(queue.drain(1), vec![1], "the oldest survivor is span 1");
    }

    #[test]
    fn drain_returns_the_oldest_first() {
        let mut queue = BoundedQueue::new(8);
        for span in 1..=5 {
            queue.push(span);
        }

        assert_eq!(queue.drain(3), vec![1, 2, 3], "the oldest three, in order");
        assert_eq!(queue.drain(10), vec![4, 5], "the rest, in order");
        assert!(queue.is_empty(), "drain removes what it returns");
        assert_eq!(
            queue.drain(1),
            Vec::<i32>::new(),
            "an empty queue drains nothing"
        );
    }
}
