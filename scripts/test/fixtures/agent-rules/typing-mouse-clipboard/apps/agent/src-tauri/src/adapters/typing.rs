// Fixture for the typing adapter rule: no mouse, hardware or clipboard input, and no send without Unicode.
#![allow(unsafe_code)]
use windows::Win32::System::DataExchange::SetClipboardData;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT_HARDWARE, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEINPUT, SendInput,
};

pub fn click() {
    let _ = (INPUT_MOUSE, MOUSEINPUT::default(), MOUSEEVENTF_LEFTDOWN, INPUT_HARDWARE, SendInput, SetClipboardData);
}
