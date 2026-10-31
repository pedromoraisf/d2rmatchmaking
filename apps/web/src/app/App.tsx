// Site root: reads the configuration, the signed-in player and the agent, then keeps them current from the stream.
import { useCallback, useEffect, useState } from 'react';
import type { AgentView, ConfigResponse, MeResponse } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import { PairingForm } from '../features/agents/PairingForm.tsx';
import { PresencePanel } from '../features/agents/PresencePanel.tsx';
import { SignInPanel } from '../features/identity/SignInPanel.tsx';
import { type ApiClient, createApiClient } from '../shared/api-client.ts';
import { openSiteStream, type StreamOpener } from '../shared/stream.ts';
import { Layout } from './Layout.tsx';
import { applyStreamEvent } from './site-state.ts';

export interface AppProps {
  client?: ApiClient;
  openStream?: StreamOpener;
}

interface Ready {
  status: 'ready';
  config: ConfigResponse;
  session: MeResponse | null;
  agent: AgentView | null;
  pairedNotice: boolean;
}

type Boot = { status: 'loading' } | { status: 'failed' } | Ready;

const defaultClient = createApiClient();
const defaultOpenStream: StreamOpener = (handlers) => openSiteStream(handlers);

async function readAgent(client: ApiClient): Promise<AgentView | null> {
  const agent = await client.myAgent();
  return agent.ok ? agent.value : null;
}

// A 401 on /v1/me is the signed-out view, not a failure (AWS-03, AWS-04).
async function loadBoot(client: ApiClient): Promise<Boot> {
  const config = await client.config();
  if (!config.ok) {
    return { status: 'failed' };
  }
  const me = await client.me();
  if (!me.ok) {
    return me.failure === 'unauthenticated'
      ? { status: 'ready', config: config.value, session: null, agent: null, pairedNotice: false }
      : { status: 'failed' };
  }
  return {
    status: 'ready',
    config: config.value,
    session: me.value,
    agent: await readAgent(client),
    pairedNotice: false,
  };
}

export function App({ client = defaultClient, openStream = defaultOpenStream }: AppProps) {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const signedIn = boot.status === 'ready' && boot.session !== null;

  const refreshAgent = useCallback(async () => {
    const agent = await readAgent(client);
    if (agent !== null) {
      setBoot((current) => (current.status === 'ready' ? { ...current, agent } : current));
    }
  }, [client]);

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

  // One stream per signed-in site. Every open re-reads the agent, so a presence event lost in a reconnect is not stale.
  useEffect(() => {
    if (!signedIn) {
      return undefined;
    }
    return openStream({
      onOpen: () => {
        void refreshAgent();
      },
      onEvent: (event) => {
        setBoot((current) => (current.status === 'ready' ? applyStreamEvent(current, event) : current));
      },
    });
  }, [signedIn, openStream, refreshAgent]);

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

  const { session, agent, pairedNotice } = boot;
  return (
    <Layout>
      <SignInPanel
        client={client}
        staging={boot.config.stagingEndpoints}
        session={session}
        onSignedIn={(next) => {
          setBoot((current) => (current.status === 'ready' ? { ...current, session: next } : current));
          void refreshAgent();
        }}
      />
      {session !== null && agent?.status === 'paired' ? <PresencePanel agent={agent} /> : null}
      {session !== null && (agent?.status === 'none' || pairedNotice) ? (
        <PairingForm
          client={client}
          paired={pairedNotice}
          onPaired={() => {
            setBoot((current) => (current.status === 'ready' ? { ...current, pairedNotice: true } : current));
            void refreshAgent();
          }}
        />
      ) : null}
    </Layout>
  );
}
