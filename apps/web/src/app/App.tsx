// Site root: reads the configuration and the signed-in player, then shows the loading, error or ready view.
// The feature panels are added to the ready view by the feature tasks.
import { useEffect, useState } from 'react';
import type { ConfigResponse, MeResponse } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import { type ApiClient, createApiClient } from '../shared/api-client.ts';
import { Layout } from './Layout.tsx';

export interface AppProps {
  client?: ApiClient;
}

type Boot =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; config: ConfigResponse; session: MeResponse | null };

const defaultClient = createApiClient();

// A 401 on /v1/me is the signed-out view, not a failure (AWS-03, AWS-04).
async function loadBoot(client: ApiClient): Promise<Boot> {
  const config = await client.config();
  if (!config.ok) {
    return { status: 'failed' };
  }
  const me = await client.me();
  if (me.ok) {
    return { status: 'ready', config: config.value, session: me.value };
  }
  return me.failure === 'unauthenticated'
    ? { status: 'ready', config: config.value, session: null }
    : { status: 'failed' };
}

export function App({ client = defaultClient }: AppProps) {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    void loadBoot(client).then((next) => {
      if (current) {
        setBoot(next);
      }
    });
    return () => {
      current = false;
    };
  }, [client]);

  if (boot.status === 'loading') {
    return (
      <Layout>
        <p>{t('app.loading')}</p>
      </Layout>
    );
  }
  if (boot.status === 'failed') {
    return (
      <Layout>
        <p role="alert">{t('app.error')}</p>
      </Layout>
    );
  }
  // The ready view gains the feature panels in the next tasks; until then it is the frame alone.
  return <Layout>{null}</Layout>;
}
