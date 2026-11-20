//! The `graphics-capture` method (capture-cascade CAP-01, CAP-04, CAP-09; ADR 010): the Windows Graphics Capture of the D2R game
//! window. The capture item is made from the game window's own handle, so no monitor and no other window can be in it; the
//! cursor is left out, and the frame is cropped to the client area before it leaves this file. The pixels stay in this process.
//! The pure parts (the client offset in a window frame, the row pitch) are compiled and tested everywhere; the Direct3D and
//! WinRT calls exist on Windows only. This file, `window_capture.rs`, `toolhelp.rs` and `windows_ocr.rs` are the only four that
//! may allow `unsafe_code` (the policy of the agent rules).
#![allow(unsafe_code)]

use crate::adapters::window_capture::Rect;

/// Where the client area starts inside a captured window frame: the client origin (screen pixels) minus the top left of the
/// window's visible bounds (screen pixels). `None` when the client would start left of or above the frame.
pub fn client_offset(bounds: Rect, client_origin: (i32, i32)) -> Option<(u32, u32)> {
    let x = u32::try_from(client_origin.0.checked_sub(bounds.left)?).ok()?;
    let y = u32::try_from(client_origin.1.checked_sub(bounds.top)?).ok()?;
    Some((x, y))
}

/// The rows of a mapped texture without the padding of its row pitch: `height` rows of `width × 4` bytes out of rows
/// `row_pitch` bytes apart. `None` when the pitch is shorter than a row or the bytes do not hold every row.
pub fn unpad_rows(mapped: &[u8], row_pitch: usize, width: u32, height: u32) -> Option<Vec<u8>> {
    let row = usize::try_from(width).ok()?.checked_mul(4)?;
    let rows = usize::try_from(height).ok()?;
    if row_pitch < row || rows.checked_mul(row)? > mapped.len() {
        return None;
    }
    let mut pixels = Vec::with_capacity(rows * row);
    for at in 0..rows {
        let start = at.checked_mul(row_pitch)?;
        pixels.extend_from_slice(mapped.get(start..start.checked_add(row)?)?);
    }
    Some(pixels)
}

#[cfg(windows)]
pub use capture::{GraphicsFrames, supported};

#[cfg(windows)]
mod capture {
    use std::sync::{Mutex, PoisonError};
    use std::time::{Duration, Instant};

    use d2rmm_agent_core::ports::{Miss, Rgba};
    use d2rmm_agent_domain::capture_geometry::{crop_rgba, crop_to_client};
    use windows::Graphics::Capture::{
        Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
    };
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::{HMODULE, HWND, POINT, RECT};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
        D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::System::WinRT::Direct3D11::{
        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
    };
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
    use windows::core::{Interface, factory};

    use super::{client_offset, unpad_rows};
    use crate::adapters::window_capture::{Rect, rgba_from_bgra};

    /// How long a new session waits for its first frame: Windows delivers a frame when the window draws.
    const FIRST_FRAME_WAIT: Duration = Duration::from_millis(250);
    const FRAME_POLL: Duration = Duration::from_millis(10);

    /// Whether this Windows can offer the Graphics Capture API at all (CAP-01: a PC that cannot is skipped silently).
    pub fn supported() -> bool {
        GraphicsCaptureSession::IsSupported().unwrap_or(false)
    }

    /// One capture session of one window: the item, the Direct3D device, the frame pool of one buffer and the session. Closing
    /// is on `Drop`, so every path releases them (CAP-09).
    struct Session {
        window: isize,
        item_size: (i32, i32),
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        pool: Direct3D11CaptureFramePool,
        session: GraphicsCaptureSession,
        /// The last frame read, kept for a window that has not drawn since: Windows delivers a frame on change only.
        last: Option<Rgba>,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            let _ = self.session.Close();
            let _ = self.pool.Close();
        }
    }

    /// The game window's Graphics Capture, one session at a time, opened by the first look and closed by `release`, a
    /// demotion, a resize of the window or a window that is gone.
    #[derive(Default)]
    pub struct GraphicsFrames {
        session: Mutex<Option<Session>>,
    }

    impl GraphicsFrames {
        /// One frame of the client area of `window`, or why there is none.
        pub fn capture(&self, window: HWND) -> Result<Rgba, Miss> {
            // The capture API needs the thread to be in the multithreaded apartment; a thread that is already is left as it is.
            // SAFETY: `RoInitialize` takes no pointer; its error (another apartment already set) is not an error of the capture.
            let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
            let mut slot = self.session.lock().unwrap_or_else(PoisonError::into_inner);
            let handle = window.0 as isize;
            let stale = slot
                .as_ref()
                .is_some_and(|session| session.window != handle);
            if stale {
                *slot = None;
            }
            if slot.is_none() {
                *slot = Some(open(window).map_err(|_| Miss::Failed)?);
            }
            let session = slot.as_mut().ok_or(Miss::Failed)?;
            match session.look(window) {
                Ok(frame) => Ok(frame),
                Err(miss) => {
                    // A closed item, a resize or a lost device: the next look opens a new session.
                    *slot = None;
                    Err(miss)
                }
            }
        }

        /// Closes the session, if one is open (consent withdrawn, a demotion, the game gone).
        pub fn release(&self) {
            *self.session.lock().unwrap_or_else(PoisonError::into_inner) = None;
        }
    }

    /// Opens a session for `window`: the capture item of that window, a device, a one-buffer frame pool and the session, with
    /// the cursor off and, where Windows allows it, the border off (a border Windows requires stays: it shows that the window
    /// is captured).
    fn open(window: HWND) -> windows::core::Result<Session> {
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        // SAFETY: `window` is a window handle that the caller got from the window lookup a moment ago.
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window)? };
        let size = item.Size()?;

        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        // SAFETY: the out pointers are valid for the call; the hardware driver needs no adapter and no software module.
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }
        let (device, context) = device
            .zip(context)
            .ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
        let dxgi: IDXGIDevice = device.cast()?;
        // SAFETY: `dxgi` is the device made above.
        let winrt_device: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            size,
        )?;
        let session = pool.CreateCaptureSession(&item)?;
        session.SetIsCursorCaptureEnabled(false)?;
        // The capture border stays on wherever Windows draws it: it is the visible sign that the window is captured (NFR-05,
        // spec decision 4). Nothing here asks Windows to hide it.
        session.StartCapture()?;
        Ok(Session {
            window: window.0 as isize,
            item_size: (size.Width, size.Height),
            device,
            context,
            pool,
            session,
            last: None,
        })
    }

    impl Session {
        /// The latest frame of the window, cropped to its client area. A window that has not drawn since the last look gives the
        /// last frame again; a session that has never had a frame waits a moment for the first.
        fn look(&mut self, window: HWND) -> Result<Rgba, Miss> {
            let deadline = Instant::now() + FIRST_FRAME_WAIT;
            loop {
                if let Ok(frame) = self.pool.TryGetNextFrame() {
                    let content = frame.ContentSize().map_err(|_| Miss::Failed)?;
                    if (content.Width, content.Height) != self.item_size {
                        // The window changed size: this session's pool is the old size. Open a new one on the next look.
                        return Err(Miss::Failed);
                    }
                    let surface = frame.Surface().map_err(|_| Miss::Failed)?;
                    let access: IDirect3DDxgiInterfaceAccess =
                        surface.cast().map_err(|_| Miss::Failed)?;
                    // SAFETY: the surface of a capture frame is a Direct3D 11 texture; the interface is queried for exactly that.
                    let texture: ID3D11Texture2D =
                        unsafe { access.GetInterface() }.map_err(|_| Miss::Failed)?;
                    let image = self.read(&texture, window)?;
                    self.last = Some(image.clone());
                    return Ok(image);
                }
                if let Some(last) = &self.last {
                    return Ok(last.clone());
                }
                if Instant::now() >= deadline {
                    return Err(Miss::Failed);
                }
                std::thread::sleep(FRAME_POLL);
            }
        }

        /// Copies the texture to a staging texture, maps it, and returns the client area of `window` as RGBA.
        fn read(&self, texture: &ID3D11Texture2D, window: HWND) -> Result<Rgba, Miss> {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            // SAFETY: `desc` is a valid descriptor that the call fills.
            unsafe { texture.GetDesc(&mut desc) };
            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = 0;
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            desc.MiscFlags = 0;
            let mut staging: Option<ID3D11Texture2D> = None;
            // SAFETY: `desc` describes a staging copy of `texture`; the out pointer is valid for the call.
            unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut staging)) }
                .map_err(|_| Miss::Failed)?;
            let staging = staging.ok_or(Miss::Failed)?;
            // SAFETY: both textures belong to `self.device`, and the staging one has the size and format of the source.
            unsafe { self.context.CopyResource(&staging, texture) };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            // SAFETY: the staging texture allows CPU reads; `mapped` is valid for the call and unmapped below.
            unsafe {
                self.context
                    .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            }
            .map_err(|_| Miss::Failed)?;
            let pitch = mapped.RowPitch as usize;
            let length = pitch.checked_mul(desc.Height as usize).ok_or(Miss::Failed);
            let bytes = length.map(|length| {
                // SAFETY: a mapped staging texture holds `RowPitch × Height` readable bytes until `Unmap`.
                unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), length) }
            });
            let whole = bytes.and_then(|bytes| {
                unpad_rows(bytes, pitch, desc.Width, desc.Height).ok_or(Miss::Failed)
            });
            // SAFETY: the subresource was mapped above and is unmapped exactly once; `bytes` is not used after this.
            unsafe { self.context.Unmap(&staging, 0) };
            let whole = whole?;

            let (offset, client) = client_area_of(window).ok_or(Miss::Failed)?;
            let rect =
                crop_to_client((desc.Width, desc.Height), offset, client).ok_or(Miss::Failed)?;
            let cropped = crop_rgba(&whole, desc.Width, rect).ok_or(Miss::Failed)?;
            rgba_from_bgra(rect.width, rect.height, &cropped).ok_or(Miss::Failed)
        }
    }

    /// The client area of `window` inside a frame of its visible bounds: its offset and its size.
    fn client_area_of(window: HWND) -> Option<((u32, u32), (u32, u32))> {
        let mut bounds = RECT::default();
        // SAFETY: `bounds` is a RECT of the size the attribute asks for; the call fills it.
        unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                std::ptr::addr_of_mut!(bounds).cast(),
                u32::try_from(size_of::<RECT>()).ok()?,
            )
        }
        .ok()?;
        let mut origin = POINT { x: 0, y: 0 };
        // SAFETY: `origin` is a valid POINT that the call converts in place.
        unsafe { ClientToScreen(window, std::ptr::addr_of_mut!(origin)) }
            .ok()
            .ok()?;
        let mut client = RECT::default();
        // SAFETY: `client` is a valid RECT that the call fills.
        unsafe { GetClientRect(window, std::ptr::addr_of_mut!(client)) }.ok()?;
        let size = (
            u32::try_from(client.right.checked_sub(client.left)?).ok()?,
            u32::try_from(client.bottom.checked_sub(client.top)?).ok()?,
        );
        let offset = client_offset(
            Rect {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom,
            },
            (origin.x, origin.y),
        )?;
        Some((offset, size))
    }
}

#[cfg(test)]
mod tests {
    use super::{client_offset, unpad_rows};
    use crate::adapters::window_capture::Rect;

    fn bounds(left: i32, top: i32) -> Rect {
        Rect {
            left,
            top,
            right: left + 1920,
            bottom: top + 1111,
        }
    }

    #[test]
    fn a_windowed_client_starts_below_the_title_bar() {
        // The visible window starts at (100, 50); its client area at (100, 81): a 31 px title bar.
        assert_eq!(client_offset(bounds(100, 50), (100, 81)), Some((0, 31)));
    }

    #[test]
    fn a_client_with_a_side_border_keeps_the_border_offset() {
        assert_eq!(client_offset(bounds(100, 50), (108, 81)), Some((8, 31)));
    }

    #[test]
    fn a_borderless_client_starts_at_the_frame_origin() {
        assert_eq!(client_offset(bounds(0, 0), (0, 0)), Some((0, 0)));
        assert_eq!(client_offset(bounds(-1920, 0), (-1920, 0)), Some((0, 0)));
    }

    #[test]
    fn a_client_left_of_or_above_the_frame_has_no_offset() {
        assert_eq!(client_offset(bounds(100, 50), (99, 81)), None);
        assert_eq!(client_offset(bounds(100, 50), (100, 49)), None);
        let far = Rect {
            left: i32::MAX,
            top: 0,
            right: i32::MAX,
            bottom: 1,
        };
        assert_eq!(
            client_offset(far, (i32::MIN, 0)),
            None,
            "an overflow is no offset"
        );
    }

    #[test]
    fn padding_at_the_end_of_each_row_is_dropped() {
        // Two rows of two pixels (8 bytes) with a pitch of 12: four bytes of padding after each row.
        let mapped = [
            1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, //
            9, 10, 11, 12, 13, 14, 15, 16, 0, 0, 0, 0,
        ];
        assert_eq!(
            unpad_rows(&mapped, 12, 2, 2),
            Some(vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
        );
    }

    #[test]
    fn the_last_row_needs_no_padding_after_it() {
        let mapped = [1, 2, 3, 4, 0, 0, 5, 6, 7, 8];
        assert_eq!(
            unpad_rows(&mapped, 6, 1, 2),
            Some(vec![1, 2, 3, 4, 5, 6, 7, 8])
        );
    }

    #[test]
    fn a_pitch_shorter_than_a_row_or_too_few_bytes_is_refused() {
        assert_eq!(unpad_rows(&[0; 16], 7, 2, 2), None);
        assert_eq!(unpad_rows(&[0; 15], 8, 2, 2), None);
        assert_eq!(unpad_rows(&[0; 16], 8, 2, 3), None);
        assert_eq!(unpad_rows(&[], 8, u32::MAX, u32::MAX), None);
    }
}
