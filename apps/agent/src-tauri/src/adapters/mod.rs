//! The adapters the app supplies to the core: the HTTP client everywhere, and the Windows adapters (Credential Manager,
//! toolhelp, OCR) behind `#[cfg(windows)]`, since the agent ships for Windows alone (PRD).

#[allow(dead_code)] // wired into main by T27
pub mod http;

#[cfg(windows)]
#[allow(dead_code)] // wired into main by T27
pub mod token_store;
