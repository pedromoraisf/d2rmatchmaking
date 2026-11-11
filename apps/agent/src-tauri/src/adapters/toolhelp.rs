//! The toolhelp process source (design.md § Heartbeat and process; AGS-10). It lists the process names of one snapshot
//! of the system's process table. It opens no process handle and reads no process memory (ADR 010, AD-055): the only
//! calls are the snapshot, its enumeration and the close of the snapshot's own handle.
#![allow(unsafe_code)]

use d2rmm_agent_core::ports::ProcessSource;
use d2rmm_agent_domain::timings::GAME_PROCESS;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};

/// The names of the processes running now, read from one toolhelp snapshot per call.
#[derive(Debug, Default, Clone, Copy)]
pub struct ToolhelpProcessSource;

impl ProcessSource for ToolhelpProcessSource {
    fn names(&self) -> Vec<String> {
        snapshot_entries()
            .unwrap_or_default()
            .into_iter()
            .map(|(name, _)| name)
            .collect()
    }
}

/// The process ids of the running D2R executables, from one snapshot. Ids only: no handle is opened (AD-055).
pub fn game_process_ids() -> Vec<u32> {
    snapshot_entries()
        .unwrap_or_default()
        .into_iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case(GAME_PROCESS))
        .map(|(_, pid)| pid)
        .collect()
}

/// One snapshot of the process table, as (executable name, process id): taken, read and closed here, so no path leaks the
/// handle.
fn snapshot_entries() -> Option<Vec<(String, u32)>> {
    // SAFETY: TH32CS_SNAPPROCESS takes no pointer; the returned handle is closed below on every path.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
    let entries = enumerate(snapshot);
    // SAFETY: `snapshot` is the valid handle returned above and is closed exactly once.
    let _ = unsafe { CloseHandle(snapshot) };
    Some(entries)
}

fn enumerate(snapshot: HANDLE) -> Vec<(String, u32)> {
    let mut entries = Vec::new();
    // SAFETY: PROCESSENTRY32W is plain old data; all-zero is a valid value, and dwSize is set before the first call.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(0);
    // SAFETY: `snapshot` is a live snapshot handle and `entry` is a valid, writable PROCESSENTRY32W.
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_err() {
        return entries;
    }
    loop {
        entries.push((exe_name(&entry), entry.th32ProcessID));
        // SAFETY: as for Process32FirstW; the snapshot and the entry are unchanged.
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
            return entries;
        }
    }
}

/// The executable name in an entry, up to its terminating NUL.
fn exe_name(entry: &PROCESSENTRY32W) -> String {
    let end = entry
        .szExeFile
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(entry.szExeFile.len());
    String::from_utf16_lossy(&entry.szExeFile[..end])
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::ports::ProcessSource;

    use super::ToolhelpProcessSource;

    /// The test binary is a process, so its own file name is in the snapshot.
    #[test]
    fn toolhelp_lists_the_current_process() {
        let own = std::env::current_exe()
            .expect("the test binary has a path")
            .file_name()
            .expect("the test binary has a file name")
            .to_string_lossy()
            .into_owned();
        let names = ToolhelpProcessSource.names();
        assert!(
            names.iter().any(|name| name.eq_ignore_ascii_case(&own)),
            "{own} is not in the snapshot of {} processes",
            names.len()
        );
    }
}
