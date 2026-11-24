# O1 request — the sensor additions T10 needs

For the orchestrator (capture-cascade O1). Paths and features only. Written from `node --test scripts/test/agent-source-rules.test.mjs`
run against the T10/T11 draft (`src/adapters/graphics_capture.rs`, `src/adapters/window_capture.rs`, `src/main.rs`,
`Cargo.toml`). The draft type-checks and passes `cargo clippy -D warnings` for `x86_64-pc-windows-msvc` (scratch crate over the
real files) and its Linux unit tests pass. No other rule of the file flags anything.

## 1. `WINDOWS_FEATURE_ALLOW_LIST` — twelve features, one line of why each

None of them reaches process memory, input, hooks or process handles: they are the capture item, the Direct3D 11 device that
reads one texture, and the window's visible bounds.

| Feature                               | Why                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Graphics`                            | `SizeInt32`, the size of the capture item (a type of Windows.Graphics)                             |
| `Graphics_Capture`                    | `GraphicsCaptureItem`, `Direct3D11CaptureFramePool`, `GraphicsCaptureSession`: the capture         |
| `Graphics_DirectX`                    | `DirectXPixelFormat`, the frame pool's pixel format (B8G8R8A8)                                     |
| `Graphics_DirectX_Direct3D11`         | `IDirect3DDevice`, the WinRT view of the device the frame pool needs                               |
| `Win32_Graphics_Direct3D`             | `D3D_DRIVER_TYPE_HARDWARE`, to create the device                                                   |
| `Win32_Graphics_Direct3D11`           | the device, its context and the staging texture that copies one frame to the CPU                   |
| `Win32_Graphics_Dxgi`                 | `IDXGIDevice`, to make the WinRT device from the D3D device                                        |
| `Win32_Graphics_Dxgi_Common`          | `D3D11_TEXTURE2D_DESC` is gated behind it (the texture's description)                              |
| `Win32_Graphics_Dwm`                  | `DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS)`: where the client area sits in the window frame     |
| `Win32_System_WinRT`                  | `RoInitialize` (the capture thread's apartment)                                                    |
| `Win32_System_WinRT_Direct3D11`       | `CreateDirect3D11DeviceFromDXGIDevice`, `IDirect3DDxgiInterfaceAccess` (frame surface to texture)  |
| `Win32_System_WinRT_Graphics_Capture` | `IGraphicsCaptureItemInterop::CreateForWindow`: the item is made from the game window's own handle |

`Win32_Graphics_Gdi` (for `ClientToScreen`), `Win32_UI_WindowsAndMessaging` and `Win32_Foundation` are on the list already.

## 2. `UNSAFE_ADAPTERS` — one new file

Add `'src/adapters/graphics_capture.rs'` with these `windows::` paths (the test matches an entry as the whole path, a prefix
before `::`, or a suffix after `::`; leaf names are used for the Win32 types, as `window_capture.rs` does):

```
'Graphics::Capture',
'Graphics::DirectX',
'HMODULE', 'HWND', 'POINT', 'RECT', 'E_FAIL',
'D3D_DRIVER_TYPE_HARDWARE',
'D3D11CreateDevice', 'D3D11_CPU_ACCESS_READ', 'D3D11_CREATE_DEVICE_BGRA_SUPPORT', 'D3D11_MAP_READ',
'D3D11_MAPPED_SUBRESOURCE', 'D3D11_SDK_VERSION', 'D3D11_TEXTURE2D_DESC', 'D3D11_USAGE_STAGING',
'ID3D11Device', 'ID3D11DeviceContext', 'ID3D11Texture2D',
'DWMWA_EXTENDED_FRAME_BOUNDS', 'DwmGetWindowAttribute',
'IDXGIDevice',
'ClientToScreen', 'GetClientRect',
'CreateDirect3D11DeviceFromDXGIDevice', 'IDirect3DDxgiInterfaceAccess', 'IGraphicsCaptureItemInterop',
'RO_INIT_MULTITHREADED', 'RoInitialize',
'core::Interface', 'core::factory', 'core::Result', 'core::Error',
```

`window_capture.rs` needs no new path (`PrintWindow` and the GDI calls are unchanged; `game_window` stays private).

## 3. Words in the file that say "three"

`the only three files that may allow unsafe_code`, the violation message `allows unsafe_code outside the three adapters`
and its expectation at the fixture line (`src/adapters/http.rs allows unsafe_code outside the three adapters`) become "four"
(five with `screen_crop.rs`, T14, only if the field matrix needs it). `graphics_capture.rs`'s own header already says four.

## 4. Nothing else

The `fixture-read`, CSP, `instrument` and capability rules do not flag the draft.
