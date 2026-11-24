pub fn grab() {
    let _ = unsafe { GetDCEx(None, None, 0) };
}
