//! The adapters that make the ports real while they still live in core (AGS-12; design.md § Migration Steps, M1a). They move
//! to `d2rmm-agent-adapters` in M1b.

pub mod http;
pub mod sse_stream;
pub mod translate;
