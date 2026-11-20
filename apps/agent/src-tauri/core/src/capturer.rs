//! The capture cascade at work (capture-cascade CAP-01 to CAP-09; ADR 010). The `Capturer` is a `FrameSource` over the
//! methods the PC offers: it asks the domain `Cascade` which method to capture with, drops a frame that is blank, of the
//! wrong size or missing, moves to the next method when the current one fails, and probes an earlier one now and then. A
//! frame leaves it only when it is usable, so the screen reader never sees a blank one. The frame never leaves the process.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Mutex, MutexGuard, PoisonError};

use d2rmm_agent_domain::capture_cascade::{CaptureMethod, Cascade, Outcome, Step};
use d2rmm_agent_domain::frame_content::summarize;

use crate::ports::{CaptureStatus, FrameSource, MethodSource, Rgba};

/// The fixed words of `capture.outcome` on an `agent.vision.capture` span (CAP-08).
const OUTCOME_FRAME: &str = "frame";
const OUTCOME_BLANK: &str = "blank";
const OUTCOME_FAILED: &str = "failed";
const OUTCOME_SKIPPED: &str = "skipped";
/// The fixed word of `capture.method` when no method captured (CAP-07).
const NO_METHOD: &str = "none";

/// What the last look it was asked for came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Last {
    /// Nothing asked yet.
    Idle,
    /// A usable frame of this method.
    Frame(CaptureMethod),
    /// No method gave a usable frame.
    Unusable,
    /// The capture was not allowed (no consent, no game, no client area) and nothing was captured.
    Skipped,
}

struct State {
    cascade: Cascade,
    last: Last,
}

/// A frame source that runs the cascade over `methods`.
pub struct Capturer<M> {
    methods: M,
    state: Mutex<State>,
}

impl<M: MethodSource> Capturer<M> {
    pub fn new(methods: M) -> Self {
        let cascade = Cascade::new(&methods.methods());
        Self {
            methods,
            state: Mutex::new(State {
                cascade,
                last: Last::Idle,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// One capture with `method`, as an outcome and its usable frame. A method that panics, a frame of the wrong size and a
    /// blank frame are all unusable; the frame is dropped here, never passed on (CAP-02, CAP-04, CAP-09).
    fn attempt(&self, method: CaptureMethod) -> (Outcome, Option<Rgba>) {
        let span = tracing::info_span!(
            "agent.vision.capture",
            "capture.method" = method.word(),
            "capture.outcome" = tracing::field::Empty,
        );
        let taken = {
            let _entered = span.enter();
            catch_unwind(AssertUnwindSafe(|| self.methods.capture_with(method))).unwrap_or(None)
        };
        let (outcome, frame) = match taken {
            None => (Outcome::Failed, None),
            Some(frame) if !self.holds_the_client(&frame) => (Outcome::Failed, None),
            Some(frame) if summarize(&frame.pixels).blank => (Outcome::Blank, None),
            Some(frame) => (Outcome::Frame, Some(frame)),
        };
        span.record("capture.outcome", outcome_word(outcome));
        (outcome, frame)
    }

    /// Whether the frame is the size of the game's client area, when the platform says it (CAP-04, CAP-06).
    fn holds_the_client(&self, frame: &Rgba) -> bool {
        self.methods
            .client_size()
            .is_none_or(|client| client == (frame.width, frame.height))
    }
}

impl<M: MethodSource + Send + Sync> FrameSource for Capturer<M> {
    fn capture(&self) -> Option<Rgba> {
        let mut state = self.lock();
        if let Some(method) = state.cascade.probe() {
            let (outcome, frame) = self.attempt(method);
            if state.cascade.record_probe(method, outcome) {
                state.cascade.record(Outcome::Frame);
                state.last = Last::Frame(method);
                // The earlier method works again: close the sessions of the later one.
                self.methods.release();
                return frame;
            }
        }
        // One capture with the current method; a demotion tries the next method in the same look (CAP-02).
        let mut result = None;
        for _ in 0..CaptureMethod::ORDER.len() {
            let Some(method) = state.cascade.current() else {
                break;
            };
            let (outcome, frame) = self.attempt(method);
            let step = state.cascade.record(outcome);
            if frame.is_some() {
                state.last = Last::Frame(method);
                result = frame;
                break;
            }
            match step {
                Step::Stay => break,
                Step::Demoted(_) => self.methods.release(),
            }
        }
        if result.is_none() {
            state.last = Last::Unusable;
        }
        result
    }

    fn window_size(&self) -> Option<(u32, u32)> {
        self.methods.window_size()
    }

    fn status(&self) -> CaptureStatus {
        let state = self.lock();
        CaptureStatus {
            method: match state.last {
                Last::Frame(method) => Some(method),
                _ => None,
            },
            read_rate_percent: state.cascade.read_rate_percent(),
            unusable: state.last == Last::Unusable,
        }
    }

    fn release(&self) {
        let mut state = self.lock();
        if state.last == Last::Skipped {
            return;
        }
        state.last = Last::Skipped;
        // One span when the capture stops, not one per second of a game that is not running (the sampler's shared budget).
        let span = tracing::info_span!(
            "agent.vision.capture",
            "capture.method" = NO_METHOD,
            "capture.outcome" = OUTCOME_SKIPPED,
        );
        let _entered = span.enter();
        self.methods.release();
    }
}

const fn outcome_word(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Frame => OUTCOME_FRAME,
        Outcome::Blank => OUTCOME_BLANK,
        Outcome::Failed => OUTCOME_FAILED,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::capture_cascade::{CaptureMethod, DEMOTE_AFTER};

    use super::Capturer;
    use crate::ports::{CaptureStatus, FrameSource, MethodSource, Rgba};
    use CaptureMethod::{GraphicsCapture, PrintWindow, ScreenCrop};

    /// What a scripted method returns.
    #[derive(Clone, Copy)]
    enum Say {
        Good,
        Black,
        Nothing,
        Panic,
        Size(u32, u32),
    }

    /// Methods that answer as scripted and count every call.
    struct Scripted {
        offered: Vec<CaptureMethod>,
        says: Mutex<HashMap<CaptureMethod, Say>>,
        calls: Mutex<Vec<CaptureMethod>>,
        releases: AtomicUsize,
        client: Option<(u32, u32)>,
    }

    impl Scripted {
        fn new(offered: &[CaptureMethod]) -> Arc<Self> {
            Arc::new(Self {
                offered: offered.to_vec(),
                says: Mutex::new(HashMap::new()),
                calls: Mutex::new(Vec::new()),
                releases: AtomicUsize::new(0),
                client: Some((8, 8)),
            })
        }

        fn say(&self, method: CaptureMethod, say: Say) {
            self.says.lock().expect("says").insert(method, say);
        }

        fn calls_of(&self, method: CaptureMethod) -> usize {
            self.calls
                .lock()
                .expect("calls")
                .iter()
                .filter(|called| **called == method)
                .count()
        }

        fn total_calls(&self) -> usize {
            self.calls.lock().expect("calls").len()
        }
    }

    impl MethodSource for Arc<Scripted> {
        fn methods(&self) -> Vec<CaptureMethod> {
            self.offered.clone()
        }

        fn capture_with(&self, method: CaptureMethod) -> Option<Rgba> {
            self.calls.lock().expect("calls").push(method);
            let say = self
                .says
                .lock()
                .expect("says")
                .get(&method)
                .copied()
                .unwrap_or(Say::Nothing);
            match say {
                Say::Good => Some(drawn(8, 8)),
                Say::Black => Some(black(8, 8)),
                Say::Nothing => None,
                Say::Panic => panic!("a method that panics"),
                Say::Size(width, height) => Some(drawn(width, height)),
            }
        }

        fn client_size(&self) -> Option<(u32, u32)> {
            self.client
        }

        fn release(&self) {
            self.releases.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// A frame with something drawn on it: a gradient, so it is neither uniform nor black.
    fn drawn(width: u32, height: u32) -> Rgba {
        let mut pixels = Vec::new();
        for at in 0..(width * height) {
            let value = u8::try_from(40 + at % 150).expect("a byte");
            pixels.extend_from_slice(&[value, value, value, 255]);
        }
        Rgba {
            width,
            height,
            pixels,
        }
    }

    fn black(width: u32, height: u32) -> Rgba {
        Rgba {
            width,
            height,
            pixels: vec![0; (width * height * 4) as usize],
        }
    }

    fn capturer(script: &Arc<Scripted>) -> Capturer<Arc<Scripted>> {
        Capturer::new(Arc::clone(script))
    }

    #[test]
    fn the_first_method_that_works_is_the_only_one_asked() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture, ScreenCrop]);
        script.say(PrintWindow, Say::Good);
        let capturer = capturer(&script);

        assert!(capturer.capture().is_some());

        assert_eq!(script.total_calls(), 1);
        assert_eq!(script.calls_of(PrintWindow), 1);
        assert_eq!(
            capturer.status(),
            CaptureStatus {
                method: Some(PrintWindow),
                read_rate_percent: 100,
                unusable: false
            }
        );
    }

    #[test]
    fn a_black_first_method_gives_no_frame_twice_then_the_next_method_in_the_same_look() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);

        for _ in 1..DEMOTE_AFTER {
            assert!(
                capturer.capture().is_none(),
                "a blank frame is never passed on"
            );
            assert!(capturer.status().unusable);
        }
        assert_eq!(
            script.calls_of(GraphicsCapture),
            0,
            "not before the third look"
        );

        assert!(
            capturer.capture().is_some(),
            "the third look tries the next method"
        );
        assert_eq!(script.calls_of(PrintWindow), 3);
        assert_eq!(script.calls_of(GraphicsCapture), 1);
        assert_eq!(capturer.status().method, Some(GraphicsCapture));
        assert_eq!(
            script.releases.load(Ordering::SeqCst),
            1,
            "the demotion closes sessions"
        );
    }

    #[test]
    fn when_every_method_is_black_there_is_no_frame_and_no_method() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Black);
        let capturer = capturer(&script);

        for _ in 0..20 {
            assert!(capturer.capture().is_none());
        }

        let status = capturer.status();
        assert_eq!(status.method, None);
        assert_eq!(status.read_rate_percent, 0);
        assert!(status.unusable);
    }

    #[test]
    fn a_method_the_pc_does_not_offer_is_never_asked() {
        let script = Scripted::new(&[PrintWindow, ScreenCrop]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Good);
        script.say(ScreenCrop, Say::Good);
        let capturer = capturer(&script);

        for _ in 0..DEMOTE_AFTER {
            capturer.capture();
        }

        assert_eq!(script.calls_of(GraphicsCapture), 0);
        assert_eq!(capturer.status().method, Some(ScreenCrop));
    }

    #[test]
    fn a_pc_that_offers_no_method_captures_nothing() {
        let script = Scripted::new(&[]);
        let capturer = capturer(&script);
        assert!(capturer.capture().is_none());
        assert_eq!(script.total_calls(), 0);
    }

    #[test]
    fn a_method_that_panics_is_a_failed_capture_and_not_a_crash() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Panic);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);

        for _ in 0..DEMOTE_AFTER {
            capturer.capture();
        }

        assert_eq!(capturer.status().method, Some(GraphicsCapture));
    }

    #[test]
    fn a_frame_that_is_not_the_size_of_the_client_is_refused() {
        let script = Scripted::new(&[PrintWindow]);
        script.say(PrintWindow, Say::Size(8, 9));
        let capturer = capturer(&script);
        assert!(capturer.capture().is_none());
        script.say(PrintWindow, Say::Size(8, 8));
        assert!(capturer.capture().is_some());
    }

    #[test]
    fn a_dark_but_drawn_frame_is_a_frame() {
        struct Dark;
        impl MethodSource for Dark {
            fn methods(&self) -> Vec<CaptureMethod> {
                vec![PrintWindow]
            }
            fn capture_with(&self, _method: CaptureMethod) -> Option<Rgba> {
                let mut pixels = Vec::new();
                for at in 0..64_u32 {
                    let value = if at % 2 == 0 { 6 } else { 26 };
                    pixels.extend_from_slice(&[value, value, value, 255]);
                }
                Some(Rgba {
                    width: 8,
                    height: 8,
                    pixels,
                })
            }
        }
        assert!(Capturer::new(Dark).capture().is_some());
    }

    #[test]
    fn releasing_closes_the_sessions_once_and_calls_nothing_else() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Good);
        let capturer = capturer(&script);
        capturer.capture();

        capturer.release();
        capturer.release();
        capturer.release();

        assert_eq!(script.releases.load(Ordering::SeqCst), 1, "idempotent");
        assert_eq!(script.total_calls(), 1, "release captures nothing");
        assert_eq!(capturer.status().method, None);
        assert!(!capturer.status().unusable, "skipped is not unusable");
    }

    #[test]
    fn a_capture_after_a_release_asks_the_current_method_again() {
        let script = Scripted::new(&[PrintWindow]);
        script.say(PrintWindow, Say::Good);
        let capturer = capturer(&script);
        capturer.capture();
        capturer.release();
        assert!(capturer.capture().is_some());
        assert_eq!(capturer.status().method, Some(PrintWindow));
    }

    #[test]
    fn six_hundred_steady_looks_make_six_hundred_captures_of_one_method() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture, ScreenCrop]);
        script.say(PrintWindow, Say::Good);
        let capturer = capturer(&script);

        for _ in 0..600 {
            assert!(capturer.capture().is_some());
        }

        assert_eq!(script.calls_of(PrintWindow), 600);
        assert_eq!(
            script.calls_of(GraphicsCapture) + script.calls_of(ScreenCrop),
            0
        );
        assert_eq!(script.total_calls(), 600);
    }

    #[test]
    fn six_hundred_looks_on_the_second_method_add_ten_probes_of_the_first() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);

        let mut frames = 0;
        for _ in 0..600 {
            if capturer.capture().is_some() {
                frames += 1;
            }
        }

        assert_eq!(
            frames, 598,
            "the two blank looks before the demotion give none"
        );
        assert_eq!(script.calls_of(GraphicsCapture), 598);
        assert_eq!(
            script.calls_of(PrintWindow),
            3 + 10,
            "three looks to demote, then one probe in sixty"
        );
    }

    #[test]
    fn a_probe_that_works_returns_to_the_first_method_and_closes_the_other() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);
        for _ in 0..(DEMOTE_AFTER + 5) {
            capturer.capture();
        }
        assert_eq!(capturer.status().method, Some(GraphicsCapture));
        let releases = script.releases.load(Ordering::SeqCst);

        script.say(PrintWindow, Say::Good);
        for _ in 0..60 {
            capturer.capture();
        }

        assert_eq!(capturer.status().method, Some(PrintWindow));
        assert!(
            script.releases.load(Ordering::SeqCst) > releases,
            "the later sessions close"
        );
        let graphics = script.calls_of(GraphicsCapture);
        for _ in 0..10 {
            capturer.capture();
        }
        assert_eq!(
            script.calls_of(GraphicsCapture),
            graphics,
            "no second capture in steady state"
        );
    }

    #[test]
    fn an_unusable_probe_hands_its_look_to_the_current_method() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Nothing);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);
        let mut frames = 0;
        for _ in 0..180 {
            if capturer.capture().is_some() {
                frames += 1;
            }
        }
        // Only the two looks before the demotion are lost: a probe look still returns the current method's frame.
        assert_eq!(frames, 178);
    }
}
