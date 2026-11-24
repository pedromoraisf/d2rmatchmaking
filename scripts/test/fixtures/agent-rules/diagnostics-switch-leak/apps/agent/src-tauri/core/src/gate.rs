pub fn allowed(store: &FileDiagnosticsStore) -> bool {
    store.load()
}
