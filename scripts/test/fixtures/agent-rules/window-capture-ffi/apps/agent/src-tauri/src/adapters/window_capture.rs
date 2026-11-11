// Fixture for the window capture rule: these calls are not on the window_capture.rs allow-list.
use windows::Win32::Graphics::Gdi::{BitBlt, GetPixel};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, SendMessageW, SetWindowsHookExW};

pub fn calls() {
    let _ = (BitBlt, GetPixel, PostMessageW, SendMessageW, SetWindowsHookExW);
}
