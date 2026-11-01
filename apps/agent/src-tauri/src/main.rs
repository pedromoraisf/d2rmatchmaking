//! App entry: the Tauri shell around the agent core. Behaviour lives in d2rmm-agent-core; this crate wires the window
//! and, from T20 on, the runtime.
#![deny(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adapters;
mod config;
#[allow(dead_code)] // wired into main by T27
mod fixture_read;

use tauri::{Url, WebviewWindowBuilder};

/// The label of the one window declared in tauri.conf.json. It is created in `setup` so its navigation is restricted.
const MAIN_WINDOW: &str = "main";

/// The window may navigate only to the bundled app (AGS-04): the custom protocol of each platform.
fn is_app_url(url: &Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    )
}

/// Asks the runtime for a new pairing code. The runtime is wired in T27; until then the command does nothing.
#[tauri::command]
fn get_new_code() {}

/// The generated Tauri context. `generate_context!` is expanded once: a second expansion in the same test binary
/// defines the embedded Info.plist symbol twice on macOS.
fn app_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

/// Logs the location of a panic and never its payload, which can carry secrets (AGS-09).
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| match info.location() {
        Some(location) => eprintln!("agent panicked at {}:{}", location.file(), location.line()),
        None => eprintln!("agent panicked"),
    }));
}

fn main() {
    install_panic_hook();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_new_code])
        .setup(|app| {
            let window = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == MAIN_WINDOW)
                .ok_or("tauri.conf.json declares no main window")?;
            WebviewWindowBuilder::from_config(&*app, window)?
                .on_navigation(is_app_url)
                .build()?;
            Ok(())
        })
        .run(app_context())
        .expect("error while running the agent");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comes_from_package_json() {
        let context = app_context();
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("package.json is JSON");
        assert_eq!(
            context.package_info().version.to_string(),
            package["version"]
                .as_str()
                .expect("package.json has a version"),
        );
    }

    #[test]
    fn runtime_config_carries_the_package_version() {
        let context = app_context();
        let version = context.package_info().version.to_string();
        let base =
            config::api_base(Some("https://api.example.test"), true).expect("https is accepted");
        let core_config = config::core_config(&version, base);
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("package.json is JSON");
        assert_eq!(
            core_config.version,
            package["version"]
                .as_str()
                .expect("package.json has a version"),
        );
    }

    #[test]
    fn navigation_stays_in_the_app() {
        assert!(is_app_url(
            &Url::parse("tauri://localhost/index.html").expect("url")
        ));
        assert!(is_app_url(
            &Url::parse("http://tauri.localhost/").expect("url")
        ));
        assert!(!is_app_url(
            &Url::parse("https://example.com/").expect("url")
        ));
    }
}
