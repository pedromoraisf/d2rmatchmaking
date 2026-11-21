// Fixture for the clipboard rule (AST-14): the core never writes the clipboard itself, only through its port.
pub fn copy(app: &tauri::AppHandle) {
    let _ = app.clipboard().write_text("mmbaalh-12");
}
