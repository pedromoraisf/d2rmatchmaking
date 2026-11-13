// Generates the permissions of the app's commands (allow-get-new-code, allow-get-consent, allow-set-consent) and the capability schema checks (AGS-01, AGS-04).
// Every command registered in `generate_handler!` must be listed here and allowed in capabilities/main.json.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["get_new_code", "get_consent", "set_consent"]),
    ))
    .expect("failed to run tauri-build");
}
