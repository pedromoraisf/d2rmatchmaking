// Fixture: a core test that mocks a type instead of using an in-memory fake.
use mockall::automock;

#[automock]
pub trait ApiGateway {
    fn heartbeat(&self) -> bool;
}
