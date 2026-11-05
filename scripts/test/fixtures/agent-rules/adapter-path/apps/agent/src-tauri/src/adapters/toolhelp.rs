// Fixture for the adapter path rule: OpenProcess is not on the toolhelp.rs allow-list.
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

#[allow(unsafe_code)]
pub fn open(pid: u32) -> HANDLE {
    let _ = (CloseHandle, PROCESS_QUERY_LIMITED_INFORMATION);
    unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).unwrap_or_default() }
}
