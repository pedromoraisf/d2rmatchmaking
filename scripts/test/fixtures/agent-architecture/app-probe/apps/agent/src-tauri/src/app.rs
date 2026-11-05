// Fixture: the app crate reaches the test probe, so the shipped binary could forge agent state.
use d2rmm_agent_core::Runtime;

pub fn build(runtime: Runtime) {
    let (_handle, _probe) = runtime.start_with_probe();
}
