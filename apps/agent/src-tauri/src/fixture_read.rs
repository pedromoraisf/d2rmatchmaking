//! The F0 fixture-read trigger (AGS-33, AD-057). With the Cargo feature `fixture-read`, `--read-fixture <png>` decodes the
//! PNG and reads it once, when the agent first shows a held room. Without the feature the flag is rejected with exit code
//! 2 before Tauri starts, so a released agent never reads an image. `release-agent.yml` never enables the feature.

use std::path::PathBuf;

/// The command-line flag of the fixture read.
pub const FLAG: &str = "--read-fixture";
/// The exit code of a rejected flag (AGS-33).
pub const REJECTED_EXIT_CODE: i32 = 2;

/// Reads `--read-fixture <png>` from the arguments: `Ok(None)` without the flag, `Ok(Some(path))` in a build with the
/// feature, and `Err(2)` when the flag is given without the feature or without a path.
pub fn parse_args(args: &[String]) -> Result<Option<PathBuf>, i32> {
    let Some(at) = args.iter().position(|arg| arg == FLAG) else {
        return Ok(None);
    };
    if !cfg!(feature = "fixture-read") {
        return Err(REJECTED_EXIT_CODE);
    }
    args.get(at + 1)
        .map(|path| Some(PathBuf::from(path)))
        .ok_or(REJECTED_EXIT_CODE)
}

#[cfg(feature = "fixture-read")]
mod enabled {
    use std::path::Path;

    use d2rmm_agent_core::ports::Rgba;

    /// Fires once: on the first view that shows a held room.
    #[derive(Debug, Default)]
    pub struct OnceWhenHeld {
        done: bool,
    }

    impl OnceWhenHeld {
        /// True exactly once, the first time `room_held` is true.
        pub fn should_read(&mut self, room_held: bool) -> bool {
            if self.done || !room_held {
                return false;
            }
            self.done = true;
            true
        }
    }

    /// Decodes a PNG into the RGBA8 frame the vision step reads.
    pub fn decode_png(path: &Path) -> Result<Rgba, String> {
        let image = image::open(path)
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?
            .into_rgba8();
        let (width, height) = image.dimensions();
        Ok(Rgba {
            width,
            height,
            pixels: image.into_raw(),
        })
    }

    /// The state sink of a fixture build. It holds the decoded frame and the runtime handle, which the app attaches
    /// once the runtime has started; a view published before that does not use up the one read.
    #[cfg(windows)]
    mod sink {
        use std::sync::{Arc, Mutex, OnceLock};

        use d2rmm_agent_adapters::http::gateway::HttpGateway;
        use d2rmm_agent_core::ports::{Rgba, StateSink};
        use d2rmm_agent_core::runtime::Handle;
        use d2rmm_agent_core::view::AgentView;

        use super::OnceWhenHeld;

        pub struct FixtureSink {
            frame: Rgba,
            handle: OnceLock<Arc<Handle<HttpGateway>>>,
            once: Mutex<OnceWhenHeld>,
        }

        impl FixtureSink {
            pub fn new(frame: Rgba) -> Self {
                Self {
                    frame,
                    handle: OnceLock::new(),
                    once: Mutex::new(OnceWhenHeld::default()),
                }
            }

            /// Gives the sink the handle of the started runtime. The first attachment wins.
            pub fn attach(&self, handle: Arc<Handle<HttpGateway>>) {
                let _ = self.handle.set(handle);
            }
        }

        impl StateSink for FixtureSink {
            fn publish(&self, view: AgentView) {
                let Some(handle) = self.handle.get() else {
                    return;
                };
                let held = view.room.is_some();
                if let Ok(mut once) = self.once.lock()
                    && once.should_read(held)
                {
                    handle.read_once(self.frame.clone());
                }
            }
        }
    }

    #[cfg(windows)]
    pub use sink::FixtureSink;

    #[cfg(test)]
    mod tests {
        use std::path::Path;

        use super::{OnceWhenHeld, decode_png};

        /// The committed F0 reference image (AD-047) decodes to the 1920×1080 frame, and the trigger reads once.
        #[test]
        fn fixture_read_reads_once_with_assignment() {
            let fixture = Path::new(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../fixtures/automap-game-name.png"
            ));
            let frame = decode_png(fixture).expect("the reference image decodes");
            assert_eq!((frame.width, frame.height), (1920, 1080));

            // Views without a room, then with one, then with one again: one read, at the first held room.
            let mut once = OnceWhenHeld::default();
            let reads: Vec<bool> = [false, true, true]
                .into_iter()
                .map(|held| once.should_read(held))
                .collect();
            assert_eq!(reads, [false, true, false]);
        }
    }
}

#[cfg(all(feature = "fixture-read", windows))]
pub use enabled::{FixtureSink, decode_png};

#[cfg(test)]
mod tests {
    use super::parse_args;

    /// A released build (no feature) rejects the flag with exit code 2, before Tauri starts (AGS-33).
    #[cfg(not(feature = "fixture-read"))]
    #[test]
    fn flag_rejected_without_feature() {
        let args = [
            "d2rmm-agent".to_string(),
            "--read-fixture".to_string(),
            "x".to_string(),
        ];
        assert_eq!(parse_args(&args), Err(2));
    }

    /// Without the flag nothing is read; the flag is honoured only in a fixture build.
    #[test]
    fn no_flag_reads_nothing() {
        assert_eq!(parse_args(&["d2rmm-agent".to_string()]), Ok(None));
    }
}
