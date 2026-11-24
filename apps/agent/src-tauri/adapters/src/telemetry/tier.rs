//! The telemetry tier of the agent (OBT-01, OBT-02, OBT-05; ADR 037). The tier is fixed at compile time by the build
//! channel: `preview` and `staging` builds export the full tier, `production`, no channel and any other value export the
//! production tier. The app crate passes the channel string; nothing here reads the environment.

/// How much detail the agent's spans carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TelemetryTier {
    /// Staging and preview builds: names and read text too, every trace sampled.
    Full,
    /// Production builds: ids, game data and timings, never a name or a read text.
    Production,
}

impl TelemetryTier {
    /// The value of the `d2r.telemetry.tier` resource attribute.
    pub fn name(self) -> &'static str {
        match self {
            TelemetryTier::Full => "full",
            TelemetryTier::Production => "production",
        }
    }
}

/// The tier of a build channel. Only `preview` and `staging` are full; a missing or unknown channel is production, so a
/// typo can never widen what leaves the machine (OBT-01).
pub fn tier_of(channel: Option<&str>) -> TelemetryTier {
    match channel {
        Some("preview" | "staging") => TelemetryTier::Full,
        _ => TelemetryTier::Production,
    }
}

/// The sampling ratio of a tier: every trace in the full tier, the production ratio otherwise (OBT-05).
pub fn ratio_of(tier: TelemetryTier, production_ratio: f64) -> f64 {
    match tier {
        TelemetryTier::Full => 1.0,
        TelemetryTier::Production => production_ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::{TelemetryTier, ratio_of, tier_of};

    #[test]
    fn preview_and_staging_are_full() {
        assert_eq!(tier_of(Some("preview")), TelemetryTier::Full);
        assert_eq!(tier_of(Some("staging")), TelemetryTier::Full);
    }

    #[test]
    fn production_none_and_unknown_channels_are_production() {
        for channel in [
            Some("production"),
            None,
            Some(""),
            Some("Staging"),
            Some("staging "),
            Some("full"),
            Some("development"),
        ] {
            assert_eq!(tier_of(channel), TelemetryTier::Production, "{channel:?}");
        }
    }

    #[test]
    fn the_tier_names_are_the_resource_values() {
        assert_eq!(TelemetryTier::Full.name(), "full");
        assert_eq!(TelemetryTier::Production.name(), "production");
    }

    #[test]
    fn the_full_tier_samples_everything_and_production_keeps_its_ratio() {
        assert_eq!(ratio_of(TelemetryTier::Full, 0.1), 1.0);
        assert_eq!(ratio_of(TelemetryTier::Production, 0.1), 0.1);
    }
}
