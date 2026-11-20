pub enum StreamItem {
    RoomAssigned(Assignment),
    ReadyCheckStarted(ReadyCheckOpen),
    ReadyCheckResolved(ReadyCheckEnd),
    RoomEnded(RoomEnd),
    Ended(EndReason),
    RunCommand(String),
}
