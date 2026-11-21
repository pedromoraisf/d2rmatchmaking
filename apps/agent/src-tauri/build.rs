// Generates the permissions of the app's commands (allow-get-new-code, allow-get-consent, allow-set-consent, allow-set-hotkey, allow-copy-again) and the capability schema checks (AGS-01, AGS-04).
// Every command registered in `generate_handler!` must be listed here and allowed in capabilities/main.json.
//
// The API base (`D2RMM_API_BASE`) is read with `option_env!` in config.rs. A build without it compiles but cannot start, and
// no signal tells this script that Tauri is bundling: `tauri build` sets TAURI_ENV_* only for its before-build hooks (a probe
// of the build script's environment under `tauri build` saw only TAURI_CLI_VERBOSITY and TAURI_UPDATER_PLUGIN_CONFIG, and
// `--self-check` in ci.yml and release-agent.yml is the guard instead). Cargo is told to rebuild when the variable changes.
fn main() {
    println!("cargo:rerun-if-env-changed=D2RMM_API_BASE");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_new_code",
            "get_consent",
            "set_consent",
            "set_hotkey",
            "copy_again",
        ]),
    ))
    .expect("failed to run tauri-build");
}
