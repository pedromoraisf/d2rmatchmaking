//! The drawn chat fixtures (game-name-reading GNR-07): `cargo run -p xtask -- draw-fixture chat` draws each frame of
//! `apps/agent/fixtures/chat/` and its sidecar (`<png>.json`, the lines with their boxes). The chat lines sit at the left of
//! the client at x 24, at the heights `ocr-real` measured on the maintainer's chat prints (1920×1033: y 656 and 770; 1920×1045:
//! y 592, 668 and 744), with the phrases it found there: "joined our world" and "left our world" (English), "entrou em nosso
//! mundo" and "saiu de nosso mundo" (Portuguese). The player names are made up ("Bob", "Eve"): no name of a real print is
//! ever drawn. Drawn with an openly licensed font; no game asset and no real print is ever committed.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use d2rmm_agent_domain::vision::Region;
use serde_json::json;

use crate::repo_root;
use crate::screen_fixture::render_lines_png;

/// One drawn chat frame: its file stem, the frame's height and its lines (text and box).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatFixture {
    pub file: String,
    pub height: u32,
    pub lines: Vec<(String, Region)>,
}

/// A chat line at the left edge, `y` px from the top, as wide as the longest measured line.
fn chat_line(text: &str, y: u32) -> (String, Region) {
    (
        text.to_string(),
        Region {
            x: 24,
            y,
            width: 530,
            height: 18,
        },
    )
}

fn frame(file: &str, height: u32, lines: Vec<(String, Region)>) -> ChatFixture {
    ChatFixture {
        file: file.to_string(),
        height,
        lines,
    }
}

/// Every chat fixture, in a fixed order.
pub fn chat_fixtures() -> Vec<ChatFixture> {
    vec![
        frame(
            "chat-joined",
            1033,
            vec![chat_line("Bob joined our world", 656)],
        ),
        frame(
            "chat-left",
            1033,
            vec![chat_line("Bob left our world", 656)],
        ),
        // One joined and one left line: the shape of the English print, whose class is `both`.
        frame(
            "chat-both",
            1033,
            vec![
                chat_line("Bob joined our world", 656),
                chat_line("Eve left our world", 770),
            ],
        ),
        // The same joined line in a later frame: another box, the same text, so it is the same line scrolled, not a new one.
        frame(
            "chat-joined-later",
            1033,
            vec![chat_line("Bob joined our world", 770)],
        ),
        frame(
            "chat-pt-joined",
            1045,
            vec![chat_line("Bob entrou em nosso mundo", 592)],
        ),
        frame(
            "chat-pt-left",
            1045,
            vec![
                chat_line("Bob saiu de nosso mundo", 668),
                chat_line("Eve entrou em nosso mundo", 744),
            ],
        ),
        // Chat lines that say nothing of a player joining or leaving.
        frame(
            "chat-no-words",
            1033,
            vec![
                chat_line("Bob: hello there", 656),
                chat_line("Eve: ready when you are", 770),
            ],
        ),
    ]
}

/// The directory of the chat fixtures, relative to the repository root.
pub fn chat_fixture_dir() -> PathBuf {
    repo_root().join("apps/agent/fixtures/chat")
}

/// The sidecar of a fixture: its height and its lines with their boxes, pretty-printed with a final newline.
pub fn chat_sidecar(fixture: &ChatFixture) -> String {
    let lines: Vec<_> = fixture
        .lines
        .iter()
        .map(|(text, area)| {
            json!({ "text": text, "x": area.x, "y": area.y, "width": area.width, "height": area.height })
        })
        .collect();
    let text = serde_json::to_string_pretty(&json!({ "height": fixture.height, "lines": lines }))
        .expect("a JSON object serialises");
    format!("{text}\n")
}

/// The PNG of a fixture, deterministic: the same font and lines give the same bytes.
pub fn render_chat_png(fixture: &ChatFixture) -> Result<Vec<u8>, Box<dyn Error>> {
    render_lines_png(fixture.height, &fixture.lines)
}

/// Writes every fixture and its sidecar into `chat_fixture_dir`.
pub fn draw_chat_fixtures() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let dir = chat_fixture_dir();
    fs::create_dir_all(&dir)?;
    let mut written = Vec::new();
    for fixture in chat_fixtures() {
        let image = dir.join(format!("{}.png", fixture.file));
        fs::write(&image, render_chat_png(&fixture)?)?;
        let sidecar = dir.join(format!("{}.png.json", fixture.file));
        fs::write(&sidecar, chat_sidecar(&fixture))?;
        written.push(image);
        written.push(sidecar);
    }
    Ok(written)
}
