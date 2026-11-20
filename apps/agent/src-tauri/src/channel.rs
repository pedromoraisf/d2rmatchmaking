//! The agent's release channels (ADR 033, DLP-06): **preview** (per agent pull request), **staging** (every commit on
//! `main`) and **production** (release-please, ADR 015). Each has its own identifier and product name, so the three install
//! side by side, and only production has the updater on. `channels.json` is the one table: this module reads it at compile
//! time, and `scripts/delivery/agent-channel.mjs` reads it to write the build's `--config` override, so the two never drift.
//! The channel is fixed at compile time from `D2RMM_CHANNEL`; a build without it is production, as before this module.

use d2rmm_agent_core::ports::{UpdateChecker, UpdateOutcome};
use serde_json::Value;

const CHANNELS: &str = include_str!("../channels.json");

/// The three release channels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Preview,
    Staging,
    Production,
}

/// The `D2RMM_CHANNEL` of a build is none of the three channel names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the build channel is not preview, staging or production (D2RMM_CHANNEL)")]
pub struct UnknownChannel;

/// What a channel changes about the installed app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelConfig {
    pub identifier: String,
    pub product_name: String,
    /// Whether the app checks for and installs updates (production only).
    pub updater: bool,
}

impl Channel {
    pub const ALL: [Channel; 3] = [Channel::Preview, Channel::Staging, Channel::Production];

    /// The name used in `D2RMM_CHANNEL`, in `channels.json` and in the self-check line.
    pub fn name(self) -> &'static str {
        match self {
            Channel::Preview => "preview",
            Channel::Staging => "staging",
            Channel::Production => "production",
        }
    }

    /// The channel of a build: none given is production; anything but an exact channel name is refused, an empty value too.
    pub fn of(raw: Option<&str>) -> Result<Channel, UnknownChannel> {
        match raw {
            None => Ok(Channel::Production),
            Some(name) => Channel::ALL
                .into_iter()
                .find(|channel| channel.name() == name)
                .ok_or(UnknownChannel),
        }
    }

    /// The identifier, product name and updater switch of the channel, from `channels.json`.
    pub fn config(self) -> ChannelConfig {
        let table: Value = serde_json::from_str(CHANNELS).expect("channels.json is valid JSON");
        let entry = &table[self.name()];
        ChannelConfig {
            identifier: entry["identifier"]
                .as_str()
                .expect("every channel has an identifier")
                .to_string(),
            product_name: entry["productName"]
                .as_str()
                .expect("every channel has a product name")
                .to_string(),
            updater: entry["updater"]
                .as_bool()
                .expect("every channel says whether the updater is on"),
        }
    }
}

/// The channel fixed at compile time from `D2RMM_CHANNEL`.
#[cfg(windows)]
pub fn build_channel() -> Option<&'static str> {
    option_env!("D2RMM_CHANNEL")
}

/// The update port of a channel without an updater: it never looks for a release, so a preview or staging installer is
/// never replaced by a production one (the `releases/latest` rule, ADR 033).
#[derive(Debug, Clone, Copy)]
pub struct NoUpdater;

impl UpdateChecker for NoUpdater {
    async fn check(&self) -> UpdateOutcome {
        UpdateOutcome::UpToDate
    }
}

#[cfg(test)]
mod tests {
    use super::{CHANNELS, Channel, ChannelConfig, NoUpdater, UnknownChannel};
    use d2rmm_agent_core::ports::{UpdateChecker, UpdateOutcome};
    use serde_json::Value;

    #[test]
    fn a_build_without_a_channel_is_production() {
        assert_eq!(Channel::of(None), Ok(Channel::Production));
    }

    #[test]
    fn each_channel_name_selects_its_channel() {
        for channel in Channel::ALL {
            assert_eq!(Channel::of(Some(channel.name())), Ok(channel));
        }
        assert_eq!(Channel::of(Some("preview")), Ok(Channel::Preview));
        assert_eq!(Channel::of(Some("staging")), Ok(Channel::Staging));
        assert_eq!(Channel::of(Some("production")), Ok(Channel::Production));
    }

    #[test]
    fn anything_else_is_refused_even_an_empty_or_differently_cased_name() {
        for raw in [
            "",
            "Production",
            "STAGING",
            "prod",
            "preview ",
            "release",
            "main",
        ] {
            assert_eq!(Channel::of(Some(raw)), Err(UnknownChannel), "{raw:?}");
        }
    }

    #[test]
    fn the_three_channels_install_side_by_side() {
        let configs: Vec<ChannelConfig> = Channel::ALL.into_iter().map(Channel::config).collect();
        for (i, a) in configs.iter().enumerate() {
            for b in &configs[i + 1..] {
                assert_ne!(a.identifier, b.identifier);
                assert_ne!(a.product_name, b.product_name);
            }
        }
        assert_eq!(
            Channel::Preview.config().identifier,
            "com.d2rmm.agent.preview"
        );
        assert_eq!(
            Channel::Staging.config().identifier,
            "com.d2rmm.agent.staging"
        );
        assert_eq!(Channel::Production.config().identifier, "com.d2rmm.agent");
    }

    #[test]
    fn only_production_has_the_updater_on() {
        assert!(Channel::Production.config().updater);
        assert!(!Channel::Staging.config().updater);
        assert!(!Channel::Preview.config().updater);
    }

    #[test]
    fn production_is_what_tauri_conf_json_says_so_a_release_is_unchanged() {
        let conf: Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let production = Channel::Production.config();
        assert_eq!(conf["identifier"], production.identifier);
        assert_eq!(conf["productName"], production.product_name);
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], true);
    }

    #[test]
    fn the_table_names_exactly_the_three_channels() {
        let table: Value = serde_json::from_str(CHANNELS).expect("channels.json");
        let mut names: Vec<&str> = table
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        names.sort_unstable();
        assert_eq!(names, ["preview", "production", "staging"]);
    }

    #[test]
    fn a_channel_without_an_updater_never_finds_a_release() {
        let outcome = tauri::async_runtime::block_on(NoUpdater.check());
        assert_eq!(outcome, UpdateOutcome::UpToDate);
    }
}
