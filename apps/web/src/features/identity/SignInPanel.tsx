// Sign-in: the Battle.net link (IDB-01, offered only when the API has the credentials, IDB-06), the test sign-in on staging
// (AD-029), the message after a refused Battle.net sign-in (IDB-04), and sign-out (IDB-05).
import { type FormEvent, useState } from 'react';
import type { MeResponse } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient, ApiFailure } from '../../shared/api-client.ts';

/** Where the Battle.net sign-in starts: the Pages proxy forwards `/api/*` to the API (ADR 012). */
export const BNET_LOGIN_PATH = '/api/v1/auth/bnet/login';

export interface SignInPanelProps {
  client: ApiClient;
  staging: boolean;
  bnetSignIn: boolean;
  /** The callback left `?signin=failed` in the address: the last Battle.net sign-in did not finish. */
  bnetFailed: boolean;
  session: MeResponse | null;
  onSignedIn: (session: MeResponse) => void;
  onSignedOut: () => void;
}

export function SignInPanel({
  client,
  staging,
  bnetSignIn,
  bnetFailed,
  session,
  onSignedIn,
  onSignedOut,
}: SignInPanelProps) {
  const { t } = useTranslation();
  const [playerName, setPlayerName] = useState('');
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function signOut() {
    setSigningOut(true);
    const result = await client.signOut();
    setSigningOut(false);
    // A 401 means the session is already gone: the site is signed out either way.
    if (result.ok || result.failure === 'unauthenticated') {
      setSignOutFailed(false);
      onSignedOut();
    } else {
      setSignOutFailed(true);
    }
  }

  if (session !== null) {
    return (
      <section className="bnet">
        <p>{t('signIn.signedInAs', { name: session.displayName })}</p>
        {/* A refused Battle.net callback leaves the earlier session in place: the player still sees why (IDB-04). */}
        {bnetFailed ? <p role="alert">{t('signIn.bnetFailed')}</p> : null}
        <button type="button" className="btn quiet" disabled={signingOut} onClick={() => void signOut()}>
          {t('signIn.signOut')}
        </button>
        {signOutFailed ? <p role="alert">{t('app.error')}</p> : null}
      </section>
    );
  }
  if (!staging && !bnetSignIn && !bnetFailed) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const login = await client.testLogin(playerName);
    if (!login.ok) {
      setFailure(login.failure);
      return;
    }
    const me = await client.me();
    if (me.ok) {
      setFailure(null);
      onSignedIn(me.value);
    } else {
      setFailure(me.failure);
    }
  }

  return (
    <section className="sign-in">
      {bnetSignIn ? (
        <p>
          <a className="btn" href={BNET_LOGIN_PATH}>
            {t('signIn.bnetLink')}
          </a>
        </p>
      ) : null}
      {bnetFailed ? <p role="alert">{t('signIn.bnetFailed')}</p> : null}
      {staging ? (
        <>
          <h2>{t('signIn.heading')}</h2>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              {t('signIn.playerName')}
              <input
                name="playerName"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
              />
            </label>
            <button type="submit" className="btn">
              {t('signIn.submit')}
            </button>
          </form>
          {failure !== null ? (
            <p role="alert">{failure === 'invalid' ? t('signIn.invalidName') : t('app.error')}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
