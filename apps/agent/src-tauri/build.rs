// Generates the permissions of the app's commands (allow-get-new-code) and the capability schema checks (AGS-01, AGS-04).
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["get_new_code"])),
    )
    .expect("failed to run tauri-build");
}
