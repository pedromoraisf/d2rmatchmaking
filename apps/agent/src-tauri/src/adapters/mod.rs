//! The adapters the app supplies to the core: the Windows adapters (Credential Manager, toolhelp, OCR, updater, system clock
//! and ids) behind `#[cfg(windows)]`, since the agent ships for Windows alone (PRD). The HTTP stack lives in the adapters
//! crate (`d2rmm-agent-adapters`).

// The consent file and the window capture are compiled where the app uses them and in the tests (the pure parts run on
// every platform); the Win32 calls are cfg(windows) inside the capture.
#[cfg(any(windows, test))]
pub mod consent_store;

#[cfg(any(windows, test))]
pub mod window_capture;

// The OCR pixels are copied on every platform, so their rule is tested everywhere; the engine is Windows only.
#[cfg(any(windows, test))]
pub mod ocr_pixels;

#[cfg(windows)]
pub mod system;

#[cfg(windows)]
pub mod token_store;

#[cfg(windows)]
pub mod toolhelp;

#[cfg(windows)]
pub mod windows_ocr;

#[cfg(windows)]
pub mod updater;
