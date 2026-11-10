// The Battle.net OAuth edge when the client id or secret is not configured (IDB-06). The login and callback routes answer
// 404 before they reach it, so it is never asked for a URL or an exchange in production; a call here is a wiring bug.
import { err, type Result } from '../../../../shared-kernel/index.ts';
import type { BattleNetIdentity, BattleNetOAuth } from '../../application/ports.ts';

export class UnconfiguredBattleNetOAuth implements BattleNetOAuth {
  authorizeUrl(): string {
    throw new Error('Battle.net sign-in is not configured: the login route must answer 404 first');
  }

  async exchange(): Promise<Result<BattleNetIdentity, 'exchange-failed' | 'userinfo-failed'>> {
    return err('exchange-failed');
  }
}
