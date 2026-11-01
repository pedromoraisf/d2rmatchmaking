//! The committed reference image is what `draw-fixture` renders, byte for byte (AGS-16, AD-047).

use xtask::fixture::{fixture_path, render_png};

#[test]
fn fixture_is_reproducible() {
    let committed = std::fs::read(fixture_path())
        .expect("the reference image is committed; `cargo run -p xtask -- draw-fixture` writes it");
    let rendered = render_png().expect("the reference image renders");
    assert_eq!(
        committed.len(),
        rendered.len(),
        "the committed image and the rendered one differ in size"
    );
    assert!(
        committed == rendered,
        "apps/agent/fixtures/automap-game-name.png is not what draw-fixture renders"
    );
}
