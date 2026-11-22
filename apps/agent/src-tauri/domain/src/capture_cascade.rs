//! The capture cascade's decision (capture-cascade CAP-01 to CAP-03, CAP-07; ADR 010): which way of capturing the game window
//! the agent uses, when it moves to the next one and when it looks at an earlier one again. Pure: no clock, no randomness, no
//! I/O. Looks are counted, not timed, so a test can drive hundreds of them in a loop.

use std::collections::VecDeque;

/// Unusable looks in a row before the cascade moves to the next method (CAP-02).
pub const DEMOTE_AFTER: u32 = 3;

/// Every this many looks, while a later method is in use, one earlier method is probed with a capture (CAP-03).
pub const PROBE_EVERY: u32 = 60;

/// The looks the read rate is taken over (CAP-07).
pub const RATE_WINDOW: usize = 60;

/// The three numbers that move the cascade: today's constants until the remote configuration says otherwise (remote-config
/// RCF-08). Each is clamped into its range by `remote_config::from_wire` before it gets here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CascadeParams {
    pub demote_after: u32,
    pub probe_every: u32,
    pub rate_window: usize,
}

impl Default for CascadeParams {
    fn default() -> Self {
        Self {
            demote_after: DEMOTE_AFTER,
            probe_every: PROBE_EVERY,
            rate_window: RATE_WINDOW,
        }
    }
}

/// One way to get the game window's pixels into the agent's memory. Each one returns the client area of the game window and
/// nothing else (CAP-04, ADR 010).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CaptureMethod {
    /// `PrintWindow` of the game window.
    PrintWindow,
    /// The Windows Graphics Capture of the game window.
    GraphicsCapture,
    /// A copy of the game's client rectangle from the screen, only while the game is the foreground window.
    ScreenCrop,
}

impl CaptureMethod {
    /// The methods in the order the cascade tries them (CAP-01).
    pub const ORDER: [Self; 3] = [Self::PrintWindow, Self::GraphicsCapture, Self::ScreenCrop];

    /// The fixed word a heartbeat and a span carry (CAP-07, CAP-08).
    pub const fn word(self) -> &'static str {
        match self {
            Self::PrintWindow => "print-window",
            Self::GraphicsCapture => "graphics-capture",
            Self::ScreenCrop => "screen-crop",
        }
    }
}

/// What one capture gave. A frame is `Blank` when `frame_content::summarize` says so, and `Failed` when the method gave none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Frame,
    Blank,
    Failed,
}

impl Outcome {
    /// Whether the frame can be read.
    pub const fn usable(self) -> bool {
        matches!(self, Self::Frame)
    }
}

/// What `Cascade::record` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// The current method stays.
    Stay,
    /// The current method was unusable too often; this one is next, and the same look tries it.
    Demoted(CaptureMethod),
}

/// The methods this PC offers, the one in use and the counters that move it.
#[derive(Debug, Clone)]
pub struct Cascade {
    methods: Vec<CaptureMethod>,
    current: usize,
    unusable_run: u32,
    looks: u32,
    probes: usize,
    recent: VecDeque<bool>,
    params: CascadeParams,
}

impl Cascade {
    /// A cascade over the methods the PC offers, in the cascade's order whatever order they come in; a method listed twice
    /// counts once. No method at all is a cascade that captures nothing.
    pub fn new(available: &[CaptureMethod]) -> Self {
        let methods = CaptureMethod::ORDER
            .into_iter()
            .filter(|method| available.contains(method))
            .collect();
        Self {
            methods,
            current: 0,
            unusable_run: 0,
            looks: 0,
            probes: 0,
            recent: VecDeque::with_capacity(RATE_WINDOW),
            params: CascadeParams::default(),
        }
    }

    /// Moves the cascade to new numbers from the next look. The counters keep their values, so a look in flight is not lost;
    /// a window that shrinks drops the oldest looks at once.
    pub fn set_params(&mut self, params: CascadeParams) {
        self.params = params;
        while self.recent.len() > params.rate_window {
            self.recent.pop_front();
        }
    }

    /// The method the next look captures with, or `None` when the PC offers none.
    pub fn current(&self) -> Option<CaptureMethod> {
        self.methods.get(self.current).copied()
    }

    /// The earlier method to capture with before this look's own capture, when a probe is due: every `PROBE_EVERY`-th look
    /// while a later method is in use. Each probe takes the next earlier method in turn.
    pub fn probe(&self) -> Option<CaptureMethod> {
        if self.current == 0
            || !self
                .looks
                .wrapping_add(1)
                .is_multiple_of(self.params.probe_every)
        {
            return None;
        }
        self.methods.get(self.probes % self.current).copied()
    }

    /// Records what a probe gave. A usable one makes its method the current one; either way the next probe takes the next
    /// earlier method. Returns whether the cascade moved back.
    pub fn record_probe(&mut self, method: CaptureMethod, outcome: Outcome) -> bool {
        self.probes += 1;
        let Some(index) = self.methods.iter().position(|offered| *offered == method) else {
            return false;
        };
        if !outcome.usable() || index >= self.current {
            return false;
        }
        self.current = index;
        self.unusable_run = 0;
        true
    }

    /// Records what the look's own capture, with the current method, gave: it counts in the read rate and in the run of
    /// unusable looks, and the third unusable look in a row moves to the next method.
    pub fn record(&mut self, outcome: Outcome) -> Step {
        self.looks = self.looks.wrapping_add(1);
        while self.recent.len() >= self.params.rate_window.max(1) {
            self.recent.pop_front();
        }
        self.recent.push_back(outcome.usable());
        if outcome.usable() {
            self.unusable_run = 0;
            return Step::Stay;
        }
        self.unusable_run = self.unusable_run.saturating_add(1);
        if self.unusable_run < self.params.demote_after {
            return Step::Stay;
        }
        match self.methods.get(self.current + 1).copied() {
            Some(next) => {
                self.current += 1;
                self.unusable_run = 0;
                Step::Demoted(next)
            }
            None => Step::Stay,
        }
    }

    /// The share of the last `rate_window` looks that gave a usable frame, as a whole percent (0 with no look).
    pub fn read_rate_percent(&self) -> u8 {
        let looks = self.recent.len();
        if looks == 0 {
            return 0;
        }
        let usable = self.recent.iter().filter(|usable| **usable).count();
        u8::try_from(usable * 100 / looks).unwrap_or(100)
    }
}

#[cfg(test)]
mod tests {
    use super::{CaptureMethod, Cascade, DEMOTE_AFTER, Outcome, PROBE_EVERY, RATE_WINDOW, Step};
    use CaptureMethod::{GraphicsCapture, PrintWindow, ScreenCrop};

    #[test]
    fn the_constants_are_pinned() {
        assert_eq!(DEMOTE_AFTER, 3);
        assert_eq!(PROBE_EVERY, 60);
        assert_eq!(RATE_WINDOW, 60);
    }

    #[test]
    fn the_methods_have_fixed_words_in_a_fixed_order() {
        assert_eq!(
            CaptureMethod::ORDER,
            [PrintWindow, GraphicsCapture, ScreenCrop]
        );
        assert_eq!(PrintWindow.word(), "print-window");
        assert_eq!(GraphicsCapture.word(), "graphics-capture");
        assert_eq!(ScreenCrop.word(), "screen-crop");
    }

    #[test]
    fn only_a_frame_is_usable() {
        assert!(Outcome::Frame.usable());
        assert!(!Outcome::Blank.usable());
        assert!(!Outcome::Failed.usable());
    }

    #[test]
    fn the_cascade_starts_at_the_first_method_the_pc_offers_in_the_cascade_order() {
        let cascade = Cascade::new(&[ScreenCrop, GraphicsCapture, GraphicsCapture]);
        assert_eq!(cascade.current(), Some(GraphicsCapture));
        assert_eq!(Cascade::new(&[]).current(), None);
    }

    #[test]
    fn a_method_the_pc_cannot_offer_is_skipped() {
        let mut cascade = Cascade::new(&[PrintWindow, ScreenCrop]);
        for _ in 0..DEMOTE_AFTER {
            cascade.record(Outcome::Blank);
        }
        assert_eq!(cascade.current(), Some(ScreenCrop));
    }

    #[test]
    fn two_unusable_looks_do_not_demote_and_the_third_does() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        assert_eq!(cascade.record(Outcome::Blank), Step::Stay);
        assert_eq!(cascade.record(Outcome::Failed), Step::Stay);
        assert_eq!(cascade.current(), Some(PrintWindow));
        assert_eq!(
            cascade.record(Outcome::Blank),
            Step::Demoted(GraphicsCapture)
        );
        assert_eq!(cascade.current(), Some(GraphicsCapture));
    }

    #[test]
    fn a_usable_look_resets_the_run_of_unusable_ones() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        cascade.record(Outcome::Blank);
        cascade.record(Outcome::Blank);
        cascade.record(Outcome::Frame);
        assert_eq!(cascade.record(Outcome::Blank), Step::Stay);
        assert_eq!(cascade.record(Outcome::Blank), Step::Stay);
        assert_eq!(cascade.current(), Some(PrintWindow));
    }

    #[test]
    fn the_last_method_stays_when_it_is_unusable_too() {
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        for _ in 0..(DEMOTE_AFTER * 4) {
            cascade.record(Outcome::Failed);
        }
        assert_eq!(cascade.current(), Some(GraphicsCapture));
        assert_eq!(cascade.read_rate_percent(), 0);
    }

    #[test]
    fn the_first_method_is_never_probed() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        for _ in 0..(PROBE_EVERY * 3) {
            assert_eq!(cascade.probe(), None);
            cascade.record(Outcome::Frame);
        }
    }

    #[test]
    fn a_later_method_is_probed_on_every_sixtieth_look_only() {
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        for _ in 0..DEMOTE_AFTER {
            cascade.record(Outcome::Blank);
        }
        let mut probed = Vec::new();
        for look in 1..=(PROBE_EVERY * 3) {
            if cascade.probe().is_some() {
                probed.push(look);
            }
            cascade.record(Outcome::Frame);
        }
        // The three unusable looks above count: the probe falls on looks 60, 120 and 180 overall.
        let looks_before = DEMOTE_AFTER;
        assert_eq!(
            probed,
            vec![
                PROBE_EVERY - looks_before,
                PROBE_EVERY * 2 - looks_before,
                PROBE_EVERY * 3 - looks_before
            ]
        );
    }

    #[test]
    fn a_usable_probe_moves_the_cascade_back_and_an_unusable_one_does_not() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        for _ in 0..(DEMOTE_AFTER * 2) {
            cascade.record(Outcome::Blank);
        }
        assert_eq!(cascade.current(), Some(ScreenCrop));
        while cascade.probe().is_none() {
            cascade.record(Outcome::Frame);
        }
        let first = cascade.probe().expect("a probe is due");
        assert_eq!(first, PrintWindow);
        assert!(!cascade.record_probe(first, Outcome::Blank));
        assert_eq!(cascade.current(), Some(ScreenCrop));
        // The next probe takes the next earlier method.
        while cascade.probe().is_none() {
            cascade.record(Outcome::Frame);
        }
        let second = cascade.probe().expect("a probe is due");
        assert_eq!(second, GraphicsCapture);
        assert!(cascade.record_probe(second, Outcome::Frame));
        assert_eq!(cascade.current(), Some(GraphicsCapture));
    }

    #[test]
    fn a_probe_of_the_current_or_a_later_method_never_moves_the_cascade() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        for _ in 0..DEMOTE_AFTER {
            cascade.record(Outcome::Blank);
        }
        assert!(!cascade.record_probe(GraphicsCapture, Outcome::Frame));
        assert!(!cascade.record_probe(ScreenCrop, Outcome::Frame));
        assert_eq!(cascade.current(), Some(GraphicsCapture));
    }

    #[test]
    fn the_read_rate_is_the_usable_share_of_the_last_sixty_looks() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        assert_eq!(cascade.read_rate_percent(), 0);
        cascade.record(Outcome::Frame);
        assert_eq!(cascade.read_rate_percent(), 100);
        cascade.record(Outcome::Blank);
        assert_eq!(cascade.read_rate_percent(), 50);
        for _ in 0..RATE_WINDOW {
            cascade.record(Outcome::Frame);
        }
        assert_eq!(cascade.read_rate_percent(), 100, "old looks fall out");
    }

    #[test]
    fn six_hundred_steady_looks_make_six_hundred_captures_and_no_probe() {
        let mut cascade = Cascade::new(&CaptureMethod::ORDER);
        let (mut captures, mut probes) = (0_u32, 0_u32);
        for _ in 0..600 {
            if cascade.probe().is_some() {
                probes += 1;
                captures += 1;
            }
            captures += 1;
            cascade.record(Outcome::Frame);
        }
        assert_eq!((captures, probes), (600, 0));
    }

    #[test]
    fn six_hundred_looks_on_a_later_method_add_ten_probe_captures() {
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        let (mut captures, mut probes) = (0_u32, 0_u32);
        // Three blank looks of the first method, then the second method works for the rest.
        for _ in 0..DEMOTE_AFTER {
            cascade.record(Outcome::Blank);
        }
        for _ in 0..600 {
            if let Some(method) = cascade.probe() {
                probes += 1;
                captures += 1;
                cascade.record_probe(method, Outcome::Blank);
            }
            captures += 1;
            cascade.record(Outcome::Frame);
        }
        assert_eq!(probes, 10);
        assert_eq!(captures, 610);
        assert_eq!(cascade.current(), Some(GraphicsCapture));
    }

    use super::CascadeParams;

    #[test]
    fn the_default_parameters_are_the_pinned_constants() {
        assert_eq!(
            CascadeParams::default(),
            CascadeParams {
                demote_after: 3,
                probe_every: 60,
                rate_window: 60
            }
        );
    }

    fn with(demote_after: u32, probe_every: u32, rate_window: usize) -> Cascade {
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        cascade.set_params(CascadeParams {
            demote_after,
            probe_every,
            rate_window,
        });
        cascade
    }

    /// The demotion follows the configured run of unusable looks, at each end of its range.
    #[test]
    fn the_demotion_follows_the_configured_run() {
        for demote_after in [1_u32, 2, 3, 10] {
            let mut cascade = with(demote_after, 60, 60);
            for _ in 1..demote_after {
                assert_eq!(cascade.record(Outcome::Blank), Step::Stay);
            }
            assert_eq!(
                cascade.record(Outcome::Blank),
                Step::Demoted(GraphicsCapture),
                "after {demote_after}"
            );
        }
    }

    /// Looks 1 to 600 on the second method: a probe on every `probe_every`-th look and no other, at each end of its range.
    #[test]
    fn the_probe_follows_the_configured_cadence() {
        for probe_every in [10_u32, 11, 30, 60, 600] {
            let mut cascade = with(1, probe_every, 60);
            cascade.record(Outcome::Blank);
            let mut probes = Vec::new();
            for look in 2..=601_u32 {
                if cascade.probe().is_some() {
                    probes.push(look);
                }
                cascade.record(Outcome::Frame);
            }
            let expected: Vec<u32> = (1..=601_u32 / probe_every)
                .map(|n| n * probe_every)
                .filter(|look| *look >= 2)
                .collect();
            assert_eq!(probes, expected, "every {probe_every}");
            assert!(probes.len() <= 60, "at most one look in ten probes");
        }
    }

    #[test]
    fn the_read_rate_follows_the_configured_window() {
        for window in [10_usize, 11, 60, 600] {
            let mut cascade = with(3, 60, window);
            for _ in 0..window {
                cascade.record(Outcome::Frame);
            }
            assert_eq!(cascade.read_rate_percent(), 100);
            // One usable look in `window` falls out for each unusable one that comes in.
            for _ in 0..(window / 2) {
                cascade.record(Outcome::Blank);
            }
            let unusable = window / 2;
            let expected = u8::try_from((window - unusable) * 100 / window).expect("a percent");
            assert_eq!(cascade.read_rate_percent(), expected, "window {window}");
        }
    }

    #[test]
    fn a_window_that_shrinks_drops_the_oldest_looks_at_once() {
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        for _ in 0..60 {
            cascade.record(Outcome::Frame);
        }
        for _ in 0..10 {
            cascade.record(Outcome::Blank);
        }
        assert_eq!(cascade.read_rate_percent(), 83);
        cascade.set_params(CascadeParams {
            rate_window: 10,
            ..CascadeParams::default()
        });
        assert_eq!(
            cascade.read_rate_percent(),
            0,
            "the ten blank looks are all that is left"
        );
    }

    #[test]
    fn a_window_as_long_as_the_looks_taken_drops_none_of_them() {
        // The boundary of `set_params`: four blank looks then a frame, a window of exactly five keeps all five (20 %).
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        for _ in 0..4 {
            cascade.record(Outcome::Blank);
        }
        cascade.record(Outcome::Frame);
        cascade.set_params(CascadeParams {
            rate_window: 5,
            demote_after: 100,
            ..CascadeParams::default()
        });
        assert_eq!(cascade.read_rate_percent(), 20);
    }

    #[test]
    fn a_window_that_grows_keeps_the_looks_it_has() {
        let mut cascade = Cascade::new(&[PrintWindow, GraphicsCapture]);
        for _ in 0..60 {
            cascade.record(Outcome::Frame);
        }
        cascade.set_params(CascadeParams {
            rate_window: 600,
            ..CascadeParams::default()
        });
        cascade.record(Outcome::Blank);
        assert_eq!(
            cascade.read_rate_percent(),
            98,
            "sixty usable looks and one blank"
        );
    }

    #[test]
    fn new_numbers_keep_the_counters_a_look_in_flight_built() {
        let mut cascade = with(10, 60, 60);
        for _ in 0..2 {
            cascade.record(Outcome::Blank);
        }
        cascade.set_params(CascadeParams {
            demote_after: 3,
            ..CascadeParams::default()
        });
        assert_eq!(
            cascade.record(Outcome::Blank),
            Step::Demoted(GraphicsCapture)
        );
    }
}
