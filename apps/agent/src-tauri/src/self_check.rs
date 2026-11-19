//! `--self-check`: the startup steps that need no user and no window, run and reported, then the process exits (the guard
//! against an installer that cannot start). It checks the compile-time configuration, creates the OCR engine and, with
//! `--online`, asks the API's health endpoint. It never opens the window, the tray, capture or the hotkey, never reads the
//! stored token or consent, and reads nothing of the game (ADR 010).
//!
//! The release build is a GUI-subsystem executable: its stdout shows only when redirected (`app.exe --self-check > out.txt`
//! or a CI step's captured output). Run from a console without redirection it prints nothing; the exit code still tells.
//! The line is `{"ok":bool,"checks":[{"name":"config","ok":true},...]}`. It holds names and verdicts only: no URL, no secret.
#![cfg(any(windows, test))]

use d2rmm_agent_adapters::config::ApiBase;
use serde_json::json;

use crate::config;

/// What the arguments asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// Also ask the API's health endpoint.
    pub online: bool,
}

/// `Some` when `--self-check` is among the arguments (after the program name); `--online` adds the health probe.
pub fn parse_args(args: &[String]) -> Option<Options> {
    let rest = args.get(1..)?;
    if !rest.iter().any(|argument| argument == "--self-check") {
        return None;
    }
    Some(Options {
        online: rest.iter().any(|argument| argument == "--online"),
    })
}

/// One check and its verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub name: &'static str,
    pub ok: bool,
}

/// The verdict over every check: green only when all are, and at least one ran.
pub fn all_ok(checks: &[Check]) -> bool {
    !checks.is_empty() && checks.iter().all(|check| check.ok)
}

/// The single JSON line printed to stdout.
pub fn report_line(checks: &[Check]) -> String {
    json!({
        "ok": all_ok(checks),
        "checks": checks
            .iter()
            .map(|check| json!({ "name": check.name, "ok": check.ok }))
            .collect::<Vec<_>>(),
    })
    .to_string()
}

/// The process exit code of a verdict.
pub fn exit_code(checks: &[Check]) -> i32 {
    if all_ok(checks) { 0 } else { 1 }
}

/// Runs the checks. `ocr` and `health` are the real engine and probe in the app and fakes in tests; each returns the reason
/// it failed, which goes to `diagnostics` (stderr) and never to the JSON line. The health probe runs only with `--online`
/// and only against a valid base.
pub fn run(
    options: Options,
    raw_base: Option<&str>,
    release: bool,
    ocr: impl FnOnce() -> Result<(), String>,
    health: impl FnOnce(&ApiBase) -> Result<(), String>,
    mut diagnostics: impl FnMut(&str),
) -> Vec<Check> {
    let mut checks = Vec::new();
    let base = match config::api_base(raw_base, release) {
        Ok(base) => {
            checks.push(Check {
                name: "config",
                ok: true,
            });
            Some(base)
        }
        Err(error) => {
            diagnostics(&error.to_string());
            checks.push(Check {
                name: "config",
                ok: false,
            });
            None
        }
    };
    let ocr_ok = match ocr() {
        Ok(()) => true,
        Err(reason) => {
            diagnostics(&format!("ocr: {reason}"));
            false
        }
    };
    checks.push(Check {
        name: "ocr",
        ok: ocr_ok,
    });
    if options.online {
        let health_ok = match base.as_ref().map(health) {
            Some(Ok(())) => true,
            Some(Err(reason)) => {
                diagnostics(&format!("health: {reason}"));
                false
            }
            None => {
                diagnostics("health: skipped, the configuration is not valid");
                false
            }
        };
        checks.push(Check {
            name: "health",
            ok: health_ok,
        });
    }
    checks
}

#[cfg(test)]
mod tests {
    use super::{Check, Options, all_ok, exit_code, parse_args, report_line, run};

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|item| item.to_string()).collect()
    }

    fn offline() -> Options {
        Options { online: false }
    }

    fn check(name: &'static str, ok: bool) -> Check {
        Check { name, ok }
    }

    #[test]
    fn the_flag_selects_the_mode() {
        assert_eq!(parse_args(&args(&["agent.exe"])), None);
        assert_eq!(
            parse_args(&args(&["agent.exe", "--self-check"])),
            Some(offline())
        );
        assert_eq!(
            parse_args(&args(&["agent.exe", "--self-check", "--online"])),
            Some(Options { online: true })
        );
        assert_eq!(
            parse_args(&args(&["agent.exe", "--online"])),
            None,
            "--online alone is not a self-check"
        );
        assert_eq!(
            parse_args(&args(&["--self-check"])),
            None,
            "the program name is not an argument"
        );
    }

    #[test]
    fn a_good_build_passes_every_check() {
        let mut notes = Vec::new();
        let checks = run(
            offline(),
            Some("https://api.example.test"),
            true,
            || Ok(()),
            |_| panic!("offline never probes"),
            |note| notes.push(note.to_string()),
        );
        let line: serde_json::Value = serde_json::from_str(&report_line(&checks)).expect("json");
        assert_eq!(
            line,
            serde_json::json!({
                "ok": true,
                "checks": [{"name": "config", "ok": true}, {"name": "ocr", "ok": true}]
            })
        );
        assert_eq!(exit_code(&checks), 0);
        assert!(notes.is_empty());
    }

    #[test]
    fn a_missing_api_base_fails_the_config_check() {
        let checks = run(offline(), None, true, || Ok(()), |_| Ok(()), |_| {});
        assert_eq!(checks[0], check("config", false));
        assert!(!all_ok(&checks));
        assert_eq!(exit_code(&checks), 1);
        let line: serde_json::Value = serde_json::from_str(&report_line(&checks)).expect("json");
        assert_eq!(line["ok"], serde_json::json!(false));
    }

    #[test]
    fn plain_http_fails_a_release_but_loopback_passes_a_debug_build() {
        let base = Some("http://127.0.0.1:8080");
        let release = run(offline(), base, true, || Ok(()), |_| Ok(()), |_| {});
        assert!(!release[0].ok);
        let debug = run(offline(), base, false, || Ok(()), |_| Ok(()), |_| {});
        assert!(debug[0].ok);
    }

    #[test]
    fn a_missing_ocr_engine_fails_and_the_reason_stays_off_the_json_line() {
        let mut notes = Vec::new();
        let checks = run(
            offline(),
            Some("https://api.example.test"),
            true,
            || Err("EngineUnavailable".to_string()),
            |_| Ok(()),
            |note| notes.push(note.to_string()),
        );
        assert_eq!(exit_code(&checks), 1);
        assert_eq!(notes, vec!["ocr: EngineUnavailable".to_string()]);
        let line = report_line(&checks);
        assert!(!line.contains("EngineUnavailable") && !line.contains("example.test"));
    }

    #[test]
    fn online_adds_the_health_probe_against_the_valid_base() {
        let mut probed = None;
        let checks = run(
            Options { online: true },
            Some("https://api.example.test"),
            true,
            || Ok(()),
            |base| {
                probed = base.url().host_str().map(str::to_string);
                Ok(())
            },
            |_| {},
        );
        assert_eq!(probed.as_deref(), Some("api.example.test"));
        assert_eq!(checks.last(), Some(&check("health", true)));
        assert_eq!(exit_code(&checks), 0);

        let down = run(
            Options { online: true },
            Some("https://api.example.test"),
            true,
            || Ok(()),
            |_| Err("unreachable".to_string()),
            |_| {},
        );
        assert_eq!(down.last(), Some(&check("health", false)));
        assert_eq!(exit_code(&down), 1);
    }

    #[test]
    fn online_with_a_bad_base_does_not_probe_and_fails() {
        let checks = run(
            Options { online: true },
            None,
            true,
            || Ok(()),
            |_| panic!("no probe without a valid base"),
            |_| {},
        );
        assert_eq!(checks.last(), Some(&check("health", false)));
    }

    #[test]
    fn no_checks_is_not_a_pass() {
        assert!(!all_ok(&[]));
    }
}
