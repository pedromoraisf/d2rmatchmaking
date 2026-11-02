//! The HTTP stack of the agent (ADR 027, adapters): the client that calls the routes, the gateway that implements the
//! core's `ApiGateway` port over it, the translation between the contract and the messages, and the server-sent event
//! reader. The client builder lives here too; the app crate calls it.

pub mod api_client;
pub mod client;
pub mod gateway;
pub mod sse;
pub mod sse_stream;
pub mod translate;
