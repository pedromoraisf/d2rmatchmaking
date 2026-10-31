// Pairing: the player types the 6-digit code the agent shows (FR-03). The form is replaced by "Agent paired" once the
// API binds the agent (AWS-06, AWS-08); rate limits and bad codes have their own messages (AWS-07, AWS-08).
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiClient, ApiFailure } from '../../shared/api-client.ts';

export interface PairingFormProps {
  client: ApiClient;
  paired: boolean;
  onPaired: () => void;
}

export function PairingForm({ client, paired, onPaired }: PairingFormProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  if (paired) {
    return <p role="status">{t('pairing.paired')}</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await client.pair(code);
    if (result.ok) {
      setFailure(null);
      onPaired();
    } else {
      setFailure(result.failure);
    }
  }

  return (
    <section>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {t('pairing.codeLabel')}
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button type="submit">{t('pairing.submit')}</button>
      </form>
      {failure !== null ? <p role="alert">{pairingMessage(failure, t)}</p> : null}
    </section>
  );
}

function pairingMessage(failure: ApiFailure, t: (key: string) => string): string {
  switch (failure) {
    case 'invalid':
      return t('pairing.invalidCode');
    case 'rate-limited':
      return t('pairing.tooManyAttempts');
    default:
      return t('app.error');
  }
}
