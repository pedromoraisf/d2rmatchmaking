// A fixture for scripts/test/telemetry-tier-source.test.mjs: a component that puts the BattleTag on a span itself.
export function mark(span: { setAttribute(key: string, value: string): void }, battletag: string): void {
  span.setAttribute('d2r.account.battletag', battletag);
}
