//! The committed Party fixtures are what `draw-fixture party` renders, byte for byte, and their sidecars hold the panel's
//! texts (AGN-02, AGN-04).

use std::fs;

use xtask::fixture::{PARTY_FIXTURES, party_fixture_dir, party_sidecar, render_party_png};

#[test]
fn party_fixtures_are_reproducible() {
    for fixture in &PARTY_FIXTURES {
        let committed = fs::read(party_fixture_dir().join(fixture.file)).unwrap_or_else(|_| {
            panic!(
                "{} is committed; `cargo run -p xtask -- draw-fixture party` writes it",
                fixture.file
            )
        });
        let rendered = render_party_png(fixture.field).expect("the Party fixture renders");
        assert!(
            committed == rendered,
            "{} is not what draw-fixture party renders",
            fixture.file
        );
    }
}

#[test]
fn party_sidecars_hold_the_panel_texts() {
    for fixture in &PARTY_FIXTURES {
        let sidecar = format!("{}.json", fixture.file);
        let committed = fs::read_to_string(party_fixture_dir().join(&sidecar))
            .unwrap_or_else(|_| panic!("{sidecar} is committed"));
        assert_eq!(
            committed,
            party_sidecar(fixture.field),
            "{sidecar} holds the region texts"
        );
    }
}

#[test]
fn the_fixtures_cover_revealed_masked_and_another_name() {
    let fields: Vec<&str> = PARTY_FIXTURES.iter().map(|fixture| fixture.field).collect();
    assert_eq!(fields, ["mmbaalh-12", "xxxxxxxxx", "mmbaalh-999"]);
}
