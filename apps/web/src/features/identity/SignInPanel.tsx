// Sign-in with a test account (AD-029): offered only when the API runs with staging endpoints (AWS-01 to AWS-04).
import { type FormEvent, useState } from 'react';
import type { MeResponse } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient, ApiFailure } from '../../shared/api-client.ts';

export interface SignInPanelProps {
  client: ApiClient;
  staging: boolean;
  session: MeResponse | null;
  onSignedIn: (session: MeResponse) => void;
}

export function SignInPanel({ client, staging, session, onSignedIn }: SignInPanelProps) {
  const { t } = useTranslation();
  const [playerName, setPlayerName] = useState('');
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  if (session !== null) {
    return <p>{t('signIn.signedInAs', { name: session.displayName })}</p>;
  }
  if (!staging) {
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
    <section>
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
        <button type="submit">{t('signIn.submit')}</button>
      </form>
      {failure !== null ? (
        <p role="alert">{failure === 'invalid' ? t('signIn.invalidName') : t('app.error')}</p>
      ) : null}
    </section>
  );
}
