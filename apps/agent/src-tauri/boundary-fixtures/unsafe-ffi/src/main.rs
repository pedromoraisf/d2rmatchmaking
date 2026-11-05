//! Boundary fixture: an FFI call outside the two allowed adapters fails with unsafe_code. Never run.
#![deny(unsafe_code)]

unsafe extern "system" {
    fn GetCurrentProcessId() -> u32;
}

fn main() {
    // SAFETY: the fixture is only checked; the unsafe block is what must fail.
    let pid = unsafe { GetCurrentProcessId() };
    println!("{pid}");
}
