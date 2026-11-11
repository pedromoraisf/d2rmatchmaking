//! The window capture (design.md § Agent, app crate `adapters/window_capture.rs`; CHR-03; ADR 010). It captures the client area
//! of the D2R game window only, in memory, and never the screen, another window or the desktop. The capture is a
//! `PrintWindow` of that one window with `PW_CLIENTONLY | PW_RENDERFULLCONTENT`; the pixels stay in this process (AGS-20).
//! The pure parts (the client size, the channel order) are compiled and tested everywhere; the Win32 calls exist on Windows
//! only. This file, `toolhelp.rs` and `windows_ocr.rs` are the only three that may allow `unsafe_code` (the policy of the
//! agent rules).
#![allow(unsafe_code)]

use d2rmm_agent_core::ports::Rgba;

/// A rectangle in screen pixels, as the Win32 `RECT` gives it: left and top inclusive, right and bottom exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// The size of a client area, or `None` when it has no area: a minimized window reports an empty client rectangle, and
/// nothing is captured from it (CHR-03, the edge case of a minimized game).
pub fn client_size(client: Rect) -> Option<(u32, u32)> {
    let width = u32::try_from(client.right.checked_sub(client.left)?).ok()?;
    let height = u32::try_from(client.bottom.checked_sub(client.top)?).ok()?;
    (width > 0 && height > 0).then_some((width, height))
}

/// An image from the 32-bit BGRA rows Windows returns, as RGBA with every pixel opaque. `None` when the rows do not hold
/// exactly `width × height` pixels.
pub fn rgba_from_bgra(width: u32, height: u32, bgra: &[u8]) -> Option<Rgba> {
    let expected = (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)?;
    if bgra.len() != expected {
        return None;
    }
    let mut pixels = Vec::with_capacity(expected);
    let (pixels_bgra, _remainder) = bgra.as_chunks::<4>();
    for pixel in pixels_bgra {
        pixels.extend_from_slice(&[pixel[2], pixel[1], pixel[0], u8::MAX]);
    }
    Some(Rgba {
        width,
        height,
        pixels,
    })
}

#[cfg(windows)]
pub use game::WindowFrames;

#[cfg(windows)]
mod game {
    use std::mem::size_of;

    use d2rmm_agent_core::ports::{FrameSource, Rgba};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SelectObject,
    };
    use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PW_CLIENTONLY, PrintWindow};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClientRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        PW_RENDERFULLCONTENT,
    };
    use windows::core::BOOL;

    use super::{Rect, client_size, rgba_from_bgra};
    use crate::adapters::toolhelp::game_process_ids;

    /// The D2R game window, captured in memory when the screen loop asks for a frame.
    #[derive(Debug, Default, Clone, Copy)]
    pub struct WindowFrames;

    impl FrameSource for WindowFrames {
        fn capture(&self) -> Option<Rgba> {
            let window = game_window()?;
            // SAFETY: `window` is a window handle that `EnumWindows` returned a moment ago; the capture uses it only on this
            // call and frees every GDI object it creates before it returns.
            unsafe { client_frame(window) }
        }
    }

    /// The state `visit` fills while `EnumWindows` runs: the process ids of D2R and the first visible window of one of them.
    struct Search {
        pids: Vec<u32>,
        found: Option<HWND>,
    }

    /// The first visible top-level window of a D2R process, or `None` when D2R runs no window.
    fn game_window() -> Option<HWND> {
        let pids = game_process_ids();
        if pids.is_empty() {
            return None;
        }
        let mut search = Search { pids, found: None };
        let lparam = LPARAM(std::ptr::addr_of_mut!(search) as isize);
        // SAFETY: `visit` is called only during this call, and `search` lives until it returns; the callback reads the
        // `Search` through the pointer it was given and nothing else.
        let _ = unsafe { EnumWindows(Some(visit), lparam) };
        search.found
    }

    /// `EnumWindows` callback: keeps the first visible window that belongs to a D2R process, and stops there.
    unsafe extern "system" fn visit(window: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: `lparam` is the `&mut Search` that `game_window` passed, and no other reference to it is live during the call.
        let search = unsafe { &mut *(lparam.0 as *mut Search) };
        let mut pid = 0_u32;
        // SAFETY: `pid` is a valid u32 that the call writes.
        unsafe { GetWindowThreadProcessId(window, Some(std::ptr::addr_of_mut!(pid))) };
        // SAFETY: `window` is the handle `EnumWindows` passed to this callback.
        if search.pids.contains(&pid) && unsafe { IsWindowVisible(window) }.as_bool() {
            search.found = Some(window);
            return BOOL(0);
        }
        BOOL(1)
    }

    /// The client area of `window` as an RGBA frame, or `None` when the window is minimized, has no area, or the print fails.
    ///
    /// # Safety
    /// `window` must be a window handle that is valid at the time of the call.
    unsafe fn client_frame(window: HWND) -> Option<Rgba> {
        // SAFETY: `window` is valid (the caller's contract).
        if unsafe { IsIconic(window) }.as_bool() {
            return None;
        }
        let mut client = RECT::default();
        // SAFETY: `client` is a valid RECT that the call writes.
        unsafe { GetClientRect(window, std::ptr::addr_of_mut!(client)) }.ok()?;
        let (width, height) = client_size(Rect {
            left: client.left,
            top: client.top,
            right: client.right,
            bottom: client.bottom,
        })?;
        let width_px = i32::try_from(width).ok()?;
        let height_px = i32::try_from(height).ok()?;

        // SAFETY: GetDC(None) returns the screen device context; it is released below on every path.
        let screen = unsafe { GetDC(None) };
        // SAFETY: `screen` is a valid device context; the memory context and bitmap are deleted below.
        let memory = unsafe { CreateCompatibleDC(Some(screen)) };
        // SAFETY: as above, for a bitmap of the client size.
        let bitmap = unsafe { CreateCompatibleBitmap(screen, width_px, height_px) };
        // SAFETY: `memory` and `bitmap` are the objects created above; the previous object is restored below.
        let previous = unsafe { SelectObject(memory, HGDIOBJ::from(bitmap)) };

        // SAFETY: `window` is valid and `memory` is a device context with the bitmap selected; PW_CLIENTONLY limits the print
        // to the client area, so no frame of the window border or the desktop is drawn.
        let printed = unsafe {
            PrintWindow(
                window,
                memory,
                PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT | PW_CLIENTONLY.0),
            )
        }
        .as_bool();

        // A top-down 32-bit BGRA copy of the bitmap (a negative height asks for top-down rows).
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(size_of::<BITMAPINFOHEADER>()).unwrap_or(0),
                biWidth: width_px,
                biHeight: -height_px,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let byte_count = (width as usize) * (height as usize) * 4;
        let mut bgra = vec![0_u8; byte_count];
        // SAFETY: `bgra` holds `width × height × 4` bytes, the size of the 32-bit rows `info` describes; the bitmap is selected.
        let rows = unsafe {
            GetDIBits(
                memory,
                bitmap,
                0,
                height,
                Some(bgra.as_mut_ptr().cast()),
                std::ptr::addr_of_mut!(info),
                DIB_RGB_COLORS,
            )
        };

        // SAFETY: each object is freed exactly once, after the bitmap is deselected.
        unsafe {
            SelectObject(memory, previous);
            let _ = DeleteObject(HGDIOBJ::from(bitmap));
            let _ = DeleteDC(memory);
            ReleaseDC(None, screen);
        }

        if !printed || rows != height_px {
            return None;
        }
        rgba_from_bgra(width, height, &bgra)
    }
}

#[cfg(test)]
mod tests {
    use super::{Rect, client_size, rgba_from_bgra};

    #[test]
    fn the_client_size_is_the_client_rectangle() {
        let client = Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert_eq!(client_size(client), Some((1920, 1080)));
    }

    #[test]
    fn an_offset_client_rectangle_keeps_its_size() {
        let client = Rect {
            left: 8,
            top: 31,
            right: 1928,
            bottom: 1111,
        };
        assert_eq!(client_size(client), Some((1920, 1080)));
    }

    #[test]
    fn a_minimized_window_has_no_client_area_to_capture() {
        let empty = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let inverted = Rect {
            left: 10,
            top: 10,
            right: 5,
            bottom: 5,
        };
        assert_eq!(client_size(empty), None);
        assert_eq!(client_size(inverted), None);
    }

    #[test]
    fn bgra_becomes_rgba_with_every_pixel_opaque() {
        let bgra = [1, 2, 3, 0, 40, 50, 60, 0];
        let frame = rgba_from_bgra(2, 1, &bgra).expect("two pixels of four bytes each");
        assert_eq!(frame.pixels, vec![3, 2, 1, 255, 60, 50, 40, 255]);
        assert_eq!((frame.width, frame.height), (2, 1));
    }

    #[test]
    fn rows_of_the_wrong_length_are_refused() {
        assert_eq!(rgba_from_bgra(2, 2, &[0; 15]), None);
        assert_eq!(rgba_from_bgra(2, 2, &[0; 17]), None);
        assert!(rgba_from_bgra(2, 2, &[0; 16]).is_some());
    }

    #[test]
    fn a_size_that_overflows_is_refused_not_allocated() {
        assert_eq!(rgba_from_bgra(u32::MAX, u32::MAX, &[]), None);
    }
}
