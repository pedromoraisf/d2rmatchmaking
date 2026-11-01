//! Boundary fixture: reading another process's memory through Toolhelp is disallowed. Never run.
use windows::Win32::System::Diagnostics::ToolHelp::Toolhelp32ReadProcessMemory;

fn main() {
    let mut read = 0usize;
    // SAFETY: the fixture is only checked; the disallowed call is what must fail.
    let _ = unsafe {
        Toolhelp32ReadProcessMemory(0, std::ptr::null(), std::ptr::null_mut(), 0, &mut read)
    };
}
