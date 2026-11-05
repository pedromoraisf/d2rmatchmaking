//! Domain fixture: a file that reads the clock.
pub fn now() -> chrono::DateTime<chrono::Utc> {
    chrono::Utc::now()
}
