//! The adapters the app supplies to the core: the Windows adapters (Credential Manager, toolhelp, OCR, updater, system clock
//! and ids) behind `#[cfg(windows)]`, since the agent ships for Windows alone (PRD). The HTTP stack lives in the adapters
//! crate (`d2rmm-agent-adapters`).

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
