//! Boundary fixture: the domain reads no clock (ADR 027, AHM-04). Never run.
fn main() {
    let _ = std::time::Instant::now();
}
