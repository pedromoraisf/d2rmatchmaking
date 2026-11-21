//! The capture cascade at work (capture-cascade CAP-01 to CAP-09; ADR 010). The `Capturer` is a `FrameSource` over the
//! methods the PC offers: it asks the domain `Cascade` which method to capture with, drops a frame that is blank, of the
//! wrong size or missing, moves to the next method when the current one fails, and probes an earlier one now and then. A
//! frame leaves it only when it is usable, so the screen reader never sees a blank one. The frame never leaves the process.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Mutex, MutexGuard, PoisonError};

use d2rmm_agent_domain::capture_cascade::{CaptureMethod, Cascade, CascadeParams, Outcome, Step};
use d2rmm_agent_domain::frame_content::{FrameContent, summarize};

use crate::ports::{CaptureStatus, FrameSource, MethodSource, Miss, Rgba};

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
    /// What the last usable frame holds, measured once when it was accepted.
    content: Option<FrameContent>,
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
                content: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// One capture with `method`, as an outcome and its usable frame, or `None` when there is no game window to capture. A
    /// method that panics, a frame of the wrong size and a blank frame are all unusable; the frame is dropped here, never
    /// passed on (CAP-02, CAP-04, CAP-09).
    fn attempt(&self, method: CaptureMethod) -> Option<(Outcome, Option<(Rgba, FrameContent)>)> {
        let span = tracing::info_span!(
            "agent.vision.capture",
            "capture.method" = method.word(),
            "capture.outcome" = tracing::field::Empty,
        );
        let taken = {
            let _entered = span.enter();
            catch_unwind(AssertUnwindSafe(|| self.methods.capture_with(method)))
                .unwrap_or(Err(Miss::Failed))
        };
        let (outcome, frame) = match taken {
            Err(Miss::NoWindow) => {
                span.record("capture.outcome", OUTCOME_SKIPPED);
                return None;
            }
            Err(Miss::Failed) => (Outcome::Failed, None),
            Ok(frame) if !self.holds_the_client(&frame) => (Outcome::Failed, None),
            Ok(frame) => {
                let content = summarize(&frame.pixels);
                if content.blank {
                    (Outcome::Blank, None)
                } else {
                    (Outcome::Frame, Some((frame, content)))
                }
            }
        };
        let outcome_text = outcome_word(outcome);
        span.record("capture.outcome", outcome_text);
        Some((outcome, frame))
    }

    /// Whether the frame is the size of the game's client area (CAP-04, CAP-06). A source that cannot say the client's size
    /// gives no way to check the frame, so the frame is refused: the check fails closed.
    fn holds_the_client(&self, frame: &Rgba) -> bool {
        self.methods
            .client_size()
            .is_some_and(|client| client == (frame.width, frame.height))
    }
}

impl<M: MethodSource + Send + Sync> FrameSource for Capturer<M> {
    fn capture(&self) -> Option<Rgba> {
        let mut state = self.lock();
        if let Some(method) = state.cascade.probe() {
            let Some((outcome, frame)) = self.attempt(method) else {
                return self.no_window(&mut state);
            };
            if state.cascade.record_probe(method, outcome) {
                state.cascade.record(Outcome::Frame);
                state.last = Last::Frame(method);
                // The earlier method works again: close the sessions of the later one.
                self.methods.release();
                return frame.map(|(frame, content)| {
                    state.content = Some(content);
                    frame
                });
            }
        }
        // One capture with the current method; a demotion tries the next method in the same look (CAP-02).
        let mut result = None;
        for _ in 0..CaptureMethod::ORDER.len() {
            let Some(method) = state.cascade.current() else {
                break;
            };
            let Some((outcome, frame)) = self.attempt(method) else {
                return self.no_window(&mut state);
            };
            let step = state.cascade.record(outcome);
            if let Some((frame, content)) = frame {
                state.last = Last::Frame(method);
                state.content = Some(content);
                result = Some(frame);
                break;
            }
            match step {
                Step::Stay => break,
                Step::Demoted(_) => self.methods.release(),
            }
        }
        if result.is_none() {
            state.last = Last::Unusable;
            state.content = None;
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
            content: match state.last {
                Last::Frame(_) => state.content,
                _ => None,
            },
        }
    }

    fn release(&self) {
        let mut state = self.lock();
        self.stop(&mut state);
    }

    fn configure(&self, params: CascadeParams) {
        self.lock().cascade.set_params(params);
    }
}

impl<M: MethodSource> Capturer<M> {
    /// There is no game window: nothing was captured, and no method failed (CAP-05).
    fn no_window(&self, state: &mut State) -> Option<Rgba> {
        self.stop(state);
        None
    }

    /// Ends the capture: the sessions close, once, and the status says nothing is being captured.
    fn stop(&self, state: &mut State) {
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
    use crate::ports::{CaptureStatus, FrameSource, MethodSource, Miss, Rgba};
    use CaptureMethod::{GraphicsCapture, PrintWindow, ScreenCrop};
    use d2rmm_agent_domain::frame_content::summarize;

    /// What a scripted method returns.
    #[derive(Clone, Copy)]
    enum Say {
        Good,
        Black,
        Nothing,
        NoWindow,
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

        fn capture_with(&self, method: CaptureMethod) -> Result<Rgba, Miss> {
            self.calls.lock().expect("calls").push(method);
            let say = self
                .says
                .lock()
                .expect("says")
                .get(&method)
                .copied()
                .unwrap_or(Say::Nothing);
            match say {
                Say::Good => Ok(drawn(8, 8)),
                Say::Black => Ok(black(8, 8)),
                Say::Nothing => Err(Miss::Failed),
                Say::NoWindow => Err(Miss::NoWindow),
                Say::Panic => panic!("a method that panics"),
                Say::Size(width, height) => Ok(drawn(width, height)),
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

    /// Every `agent.vision.capture` span's fields, as text, in creation order.
    type SpanFields = Vec<(String, String)>;

    #[derive(Default)]
    struct Spans {
        recorded: Mutex<Vec<(String, SpanFields)>>,
    }

    struct Writer<'a>(&'a mut Vec<(String, String)>);

    impl tracing::field::Visit for Writer<'_> {
        fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
            self.0.push((field.name().to_string(), value.to_string()));
        }

        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            self.0
                .push((field.name().to_string(), format!("{value:?}")));
        }
    }

    impl tracing::Subscriber for Spans {
        fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
            true
        }

        fn new_span(&self, attrs: &tracing::span::Attributes<'_>) -> tracing::Id {
            let mut fields = Vec::new();
            attrs.record(&mut Writer(&mut fields));
            let mut recorded = self.recorded.lock().expect("spans");
            recorded.push((attrs.metadata().name().to_string(), fields));
            tracing::Id::from_u64(recorded.len() as u64)
        }

        fn record(&self, span: &tracing::Id, values: &tracing::span::Record<'_>) {
            let mut recorded = self.recorded.lock().expect("spans");
            if let Some((_, fields)) = recorded.get_mut(span.into_u64() as usize - 1) {
                values.record(&mut Writer(fields));
            }
        }

        fn record_follows_from(&self, _span: &tracing::Id, _follows: &tracing::Id) {}

        fn event(&self, _event: &tracing::Event<'_>) {}

        fn enter(&self, _span: &tracing::Id) {}

        fn exit(&self, _span: &tracing::Id) {}
    }

    #[test]
    fn each_capture_is_one_span_with_a_fixed_method_and_outcome_and_nothing_else() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);
        let spans = Arc::new(Spans::default());
        let guard = tracing::subscriber::set_default(Arc::clone(&spans));
        tracing::callsite::rebuild_interest_cache();

        for _ in 0..DEMOTE_AFTER {
            capturer.capture();
        }
        capturer.release();
        capturer.release();
        drop(guard);

        let recorded = spans.recorded.lock().expect("spans");
        let seen: Vec<(String, String)> = recorded
            .iter()
            .map(|(name, fields)| {
                assert_eq!(name, "agent.vision.capture");
                let get = |key: &str| {
                    fields
                        .iter()
                        .rev()
                        .find(|(field, _)| field == key)
                        .map(|(_, value)| value.clone())
                        .unwrap_or_default()
                };
                let keys: Vec<&str> = fields.iter().map(|(field, _)| field.as_str()).collect();
                assert!(
                    keys.iter()
                        .all(|key| ["capture.method", "capture.outcome"].contains(key)),
                    "only the two fixed fields: {keys:?}"
                );
                (get("capture.method"), get("capture.outcome"))
            })
            .collect();
        let pair = |method: &str, outcome: &str| (method.to_string(), outcome.to_string());
        assert_eq!(
            seen,
            vec![
                pair("print-window", "blank"),
                pair("print-window", "blank"),
                pair("print-window", "blank"),
                pair("graphics-capture", "frame"),
                pair("none", "skipped"),
            ],
            "one span per capture, and one skipped span however many releases"
        );
    }

    #[test]
    fn the_first_method_that_works_is_the_only_one_asked() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture, ScreenCrop]);
        script.say(PrintWindow, Say::Good);
        let capturer = capturer(&script);

        assert!(capturer.capture().is_some());

        assert_eq!(script.total_calls(), 1);
        assert_eq!(script.calls_of(PrintWindow), 1);
        let status = capturer.status();
        assert_eq!(
            CaptureStatus {
                content: None,
                ..status
            },
            CaptureStatus {
                method: Some(PrintWindow),
                read_rate_percent: 100,
                unusable: false,
                content: None,
            }
        );
        // The measure of the accepted frame comes with the status, so the loop does not take it again.
        let content = status.content.expect("a usable frame is measured");
        assert!(!content.blank);
        assert_eq!(content, summarize(&drawn(8, 8).pixels));
        // No frame, no measure.
        script.say(PrintWindow, Say::Black);
        for _ in 0..3 {
            capturer.capture();
        }
        assert_eq!(capturer.status().content, None);
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
    fn a_missing_window_is_not_a_failure_of_the_method() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::NoWindow);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);

        for _ in 0..(DEMOTE_AFTER * 4) {
            assert!(capturer.capture().is_none());
        }

        assert_eq!(
            script.calls_of(GraphicsCapture),
            0,
            "a minimized game demotes nothing"
        );
        let status = capturer.status();
        assert_eq!((status.method, status.unusable), (None, false));

        script.say(PrintWindow, Say::Good);
        assert!(capturer.capture().is_some());
        assert_eq!(capturer.status().method, Some(PrintWindow));
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
    fn a_source_that_cannot_say_the_client_size_gives_no_frame() {
        let mut script = Scripted::new(&[PrintWindow]);
        script.say(PrintWindow, Say::Good);
        // The scripted source reports a client size; one that reports none leaves the frame unchecked, so it is refused.
        Arc::get_mut(&mut script).expect("the only owner").client = None;
        let capturer = capturer(&script);

        assert!(capturer.capture().is_none(), "fails closed");
        assert!(capturer.status().unusable);
    }

    #[test]
    fn a_dark_but_drawn_frame_is_a_frame() {
        struct Dark;
        impl MethodSource for Dark {
            fn methods(&self) -> Vec<CaptureMethod> {
                vec![PrintWindow]
            }
            fn client_size(&self) -> Option<(u32, u32)> {
                Some((8, 8))
            }
            fn capture_with(&self, _method: CaptureMethod) -> Result<Rgba, Miss> {
                let mut pixels = Vec::new();
                for at in 0..64_u32 {
                    let value = if at % 2 == 0 { 6 } else { 26 };
                    pixels.extend_from_slice(&[value, value, value, 255]);
                }
                Ok(Rgba {
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

    use d2rmm_agent_domain::capture_cascade::CascadeParams;

    /// The extremes of each range of the configuration, and the defaults between them.
    const DEMOTE_AFTERS: [u32; 3] = [1, 3, 10];
    const PROBE_EVERYS: [u32; 4] = [60, 61, 300, 600];
    const RATE_WINDOWS: [usize; 3] = [10, 60, 600];

    /// RCF-09, CAP-03: whatever the cascade's numbers, 600 looks on the first method make exactly 600 captures of it, one per
    /// look, and none of any other method.
    #[test]
    fn at_every_extreme_six_hundred_steady_looks_make_six_hundred_captures() {
        for demote_after in DEMOTE_AFTERS {
            for probe_every in PROBE_EVERYS {
                for rate_window in RATE_WINDOWS {
                    let script = Scripted::new(&[PrintWindow, GraphicsCapture, ScreenCrop]);
                    script.say(PrintWindow, Say::Good);
                    let capturer = capturer(&script);
                    capturer.configure(CascadeParams {
                        demote_after,
                        probe_every,
                        rate_window,
                    });

                    for _ in 0..600 {
                        assert!(capturer.capture().is_some());
                    }

                    assert_eq!(script.calls_of(PrintWindow), 600);
                    assert_eq!(script.total_calls(), 600);
                    assert_eq!(capturer.status().read_rate_percent, 100);
                }
            }
        }
    }

    /// RCF-09: with the first method black, a look makes one capture, plus one probe on every `probe_every`-th look, and the
    /// demotion looks at the start. Never more than two captures in a look once the demotion is over, never a frame the reader
    /// would read twice, and the total is bounded by today's: 611 at the fastest probe the range allows (60).
    #[test]
    fn at_every_extreme_six_hundred_looks_on_the_second_method_stay_within_the_bound() {
        for demote_after in DEMOTE_AFTERS {
            for probe_every in PROBE_EVERYS {
                let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
                script.say(PrintWindow, Say::Black);
                script.say(GraphicsCapture, Say::Good);
                let capturer = capturer(&script);
                capturer.configure(CascadeParams {
                    demote_after,
                    probe_every,
                    rate_window: 60,
                });

                let mut frames = 0;
                let mut before = 0;
                for look in 1..=600_u32 {
                    if capturer.capture().is_some() {
                        frames += 1;
                    }
                    let made = script.total_calls() - before;
                    before = script.total_calls();
                    if look > demote_after {
                        assert!(made <= 2, "look {look} made {made} captures");
                    }
                }

                // A probe falls on each multiple of `probe_every` after the look that demoted.
                let probes =
                    600 / probe_every as usize - demote_after as usize / probe_every as usize;
                assert_eq!(
                    script.calls_of(PrintWindow),
                    demote_after as usize + probes,
                    "the looks to demote, then one probe every {probe_every}"
                );
                assert_eq!(frames, 600 - (demote_after as usize - 1));
                // Today's default (3 and 60) makes 611: 598 of the second method, 3 + 10 of the first. Nothing in the range makes more.
                assert!(
                    script.total_calls() <= 611,
                    "{} captures",
                    script.total_calls()
                );
                assert!(frames <= 600, "one frame to read per look at most");
            }
        }
    }

    #[test]
    fn the_numbers_move_a_capturer_that_has_already_looked() {
        let script = Scripted::new(&[PrintWindow, GraphicsCapture]);
        script.say(PrintWindow, Say::Black);
        script.say(GraphicsCapture, Say::Good);
        let capturer = capturer(&script);
        capturer.capture();
        capturer.capture();
        capturer.configure(CascadeParams {
            demote_after: 3,
            probe_every: 60,
            rate_window: 60,
        });
        // The third blank look demotes, as it would have by default.
        capturer.capture();
        assert_eq!(capturer.status().method, Some(GraphicsCapture));
        // Looks 4 to 60 make one capture each; look 60 adds a probe of the first method.
        let before = script.total_calls();
        for _ in 4..=60 {
            capturer.capture();
        }
        assert_eq!(script.total_calls() - before, 58);
    }
}
