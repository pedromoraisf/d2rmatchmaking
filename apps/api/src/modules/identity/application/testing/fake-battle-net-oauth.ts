import { err, ok, type Result } from '../../../../shared-kernel/index.ts';
import type { BattleNetIdentity, BattleNetOAuth } from '../ports.ts';

export type BattleNetExchangeFailure = 'exchange-failed' | 'userinfo-failed';

/** Scriptable BattleNetOAuth: answers the scripted exchange result and records each exchange it was asked for. */
export class FakeBattleNetOAuth implements BattleNetOAuth {
  /** The result of the next and every later exchange. */
  exchangeResult: Result<BattleNetIdentity, BattleNetExchangeFailure> = ok({
    sub: 'sub-default',
    battletag: 'Default#0001',
  });
  readonly exchanges: Array<{
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }> = [];
  readonly authorizeRequests: Array<{
    readonly state: string;
    readonly codeChallenge: string;
    readonly redirectUri: string;
  }> = [];

  /** Scripts the exchange to sign in this identity. */
  willSignIn(sub: string, battletag: string): void {
    this.exchangeResult = ok({ sub, battletag });
  }

  /** Scripts the exchange to fail with the given reason. */
  willFail(reason: BattleNetExchangeFailure): void {
    this.exchangeResult = err(reason);
  }

  authorizeUrl(input: {
    readonly state: string;
    readonly codeChallenge: string;
    readonly redirectUri: string;
  }): string {
    this.authorizeRequests.push({ ...input });
    const query = new URLSearchParams({
      client_id: 'fake-client',
      redirect_uri: input.redirectUri,
      scope: 'openid',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://fake.battle.net/authorize?${query.toString()}`;
  }

  async exchange(input: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }): Promise<Result<BattleNetIdentity, BattleNetExchangeFailure>> {
    this.exchanges.push({ ...input });
    return this.exchangeResult;
  }
}
