//! The adapters the app supplies to the core: the HTTP client wherever the app or its tests build, and the Windows adapters
//! (Credential Manager, toolhelp, OCR, updater, system clock and ids) behind `#[cfg(windows)]`, since the agent ships for
//! Windows alone (PRD).

#[cfg(any(windows, test))]
pub mod http;

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
