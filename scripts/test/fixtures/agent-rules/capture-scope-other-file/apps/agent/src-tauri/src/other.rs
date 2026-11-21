// Fixture: capture calls in a file that is not a capture adapter. The capture scope rule must reject them.
fn grab(id: DisplayId, window: HWND) {
    let _display = GraphicsCaptureItem::TryCreateFromDisplayId(id);
    let _dc = unsafe { GetDCEx(window, None, DCX_WINDOW) };
    let _dc2 = unsafe { GetDC(Some(window)) };
    let _item = unsafe { interop.CreateForWindow(window) };
}
