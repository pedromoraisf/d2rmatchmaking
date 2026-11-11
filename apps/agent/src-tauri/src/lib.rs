//! The agent's app crate as a library: the app shell (`main.rs` is the composition root that calls `app::run`) and the
//! maintainer's OCR check (`ocr_check`, `examples/ocr-check.rs`). Both the check and the `ocr_check` test read screenshots
//! with the same code, so the check is a library item the example and the test call (T-characters-reading).
#![deny(unsafe_code)]

pub mod adapters;
#[cfg(any(windows, test))]
pub mod app;
#[cfg(any(windows, test))]
pub mod config;
#[cfg(any(windows, test))]
pub mod fixture_read;
#[cfg(any(windows, test))]
pub mod language_pack;
pub mod ocr_check;
