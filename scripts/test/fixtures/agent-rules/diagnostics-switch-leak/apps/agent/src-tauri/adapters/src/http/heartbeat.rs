use crate::telemetry::DiagnosticsSwitch;

pub fn send(switch: &DiagnosticsSwitch) -> bool {
    switch.is_on()
}
