// The staging-only "Start test match" action (AWS-19). The room arrives on the stream; onStarted re-reads it at once.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiClient } from '../../shared/api-client.ts';
import { tracedAction } from '../../shared/telemetry.ts';

export interface StartTestMatchButtonProps {
  client: ApiClient;
  onStarted: () => void;
}

export function StartTestMatchButton({ client, onStarted }: StartTestMatchButtonProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  async function start() {
    const result = await tracedAction('web.action.start-test-match', () => client.matchFormed());
    if (result.ok) {
      setFailed(false);
      onStarted();
    } else {
      setFailed(true);
    }
  }

  return (
    <div>
      <button type="button" className="btn" onClick={() => void start()}>
        {t('testMatch.start')}
      </button>
      {failed ? <p role="alert">{t('app.error')}</p> : null}
    </div>
  );
}
