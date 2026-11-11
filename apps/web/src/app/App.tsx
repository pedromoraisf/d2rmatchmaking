// Site root: reads the configuration, the signed-in player, the agent and the room, then keeps them current from the
// stream. Every stream open and every action re-reads what it may have changed.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentView,
  CharacterView,
  ConfigResponse,
  MeResponse,
  QueueTicketView,
  ReadyCheckView,
  RoomView,
} from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import { AgentPill } from '../features/agents/AgentPill.tsx';
import { PairingForm } from '../features/agents/PairingForm.tsx';
import { PresencePanel } from '../features/agents/PresencePanel.tsx';
import { CharacterList } from '../features/identity/CharacterList.tsx';
import { SignInPanel } from '../features/identity/SignInPanel.tsx';
import { type RoomShown, RoomPanel } from '../features/lobby-room/RoomPanel.tsx';
import { QueuePanel } from '../features/matchmaking/QueuePanel.tsx';
import { ReadyCheckOverlay } from '../features/matchmaking/ReadyCheckOverlay.tsx';
import { SearchingPanel } from '../features/matchmaking/SearchingPanel.tsx';
import { StartTestMatchButton } from '../features/lobby-room/StartTestMatchButton.tsx';
import { type ApiClient, createApiClient } from '../shared/api-client.ts';
import { tracingFetcher } from '../shared/telemetry.ts';
import { openSiteStream, type StreamOpener } from '../shared/stream.ts';
import { Layout } from './Layout.tsx';
import { clearSignInFailure, signInFailedIn } from './sign-in-failure.ts';
import { applyStreamEvent, type SiteNotice } from './site-state.ts';

export interface AppProps {
  client?: ApiClient;
  openStream?: StreamOpener;
}

interface Ready {
  status: 'ready';
  config: ConfigResponse;
  session: MeResponse | null;
  agent: AgentView | null;
  room: RoomShown | null;
  characters: CharacterView[];
  pairedNotice: boolean;
  queue: QueueTicketView | null;
  queueNotice: SiteNotice;
  /** The open ready check the player is in; the site reads it from the stream only (RDY-01). */
  readyCheck: ReadyCheckView | null;
}

type Boot = { status: 'loading' } | { status: 'failed' } | Ready;

const defaultClient = createApiClient(tracingFetcher((url, init) => fetch(url, init)));
const defaultOpenStream: StreamOpener = (handlers) => openSiteStream(handlers);

function shownRoom(view: RoomView): RoomShown {
  return { roomId: view.roomId, gameName: view.expectedGameName, stage: view.stage };
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
      ? {
          status: 'ready',
          config: config.value,
          session: null,
          agent: null,
          room: null,
          characters: [],
          pairedNotice: false,
          queue: null,
          queueNotice: null,
          readyCheck: null,
        }
      : { status: 'failed' };
  }
  const [agent, room, characters, queue, readyCheck] = await Promise.all([
    client.myAgent(),
    client.myRoom(),
    client.myCharacters(),
    client.myQueueTicket(),
    client.myReadyCheck(),
  ]);
  return {
    status: 'ready',
    config: config.value,
    session: me.value,
    agent: agent.ok ? agent.value : null,
    room: room.ok ? shownRoom(room.value) : null,
    characters: characters.ok ? characters.value.characters : [],
    pairedNotice: false,
    queue: queue.ok ? queue.value.ticket : null,
    queueNotice: null,
    readyCheck: readyCheck.ok ? readyCheck.value : null,
  };
}

export function App({ client = defaultClient, openStream = defaultOpenStream }: AppProps) {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const signedIn = boot.status === 'ready' && boot.session !== null;

  // The Battle.net callback's failure flag is read once, on the first render, and then removed from the address bar.
  const [signInFailed] = useState(() => signInFailedIn(window.location.search));
  useEffect(() => {
    clearSignInFailure(window.location, window.history);
  }, []);

  // Stream events applied so far. A read that an event overtook may answer older than that event, so its answer is
  // ignored and the site reads again.
  const streamEvents = useRef(0);

  // The characters are read again on every `characters.updated` (CHR-12). Only the latest read may update the list, so
  // a slow answer to an older read never shows over a newer one. A failed read keeps what is on screen.
  const characterReads = useRef(0);
  const refreshCharacters = useCallback(async () => {
    characterReads.current += 1;
    const read = characterReads.current;
    const listed = await client.myCharacters();
    if (read === characterReads.current && listed.ok) {
      setBoot((current) =>
        current.status === 'ready' ? { ...current, characters: listed.value.characters } : current,
      );
    }
  }, [client]);

  // The player's waiting ticket is read again after every queue change (QUE-15). A failed read keeps what is on screen.
  const refreshQueue = useCallback(async () => {
    const read = await client.myQueueTicket();
    if (read.ok) {
      setBoot((current) =>
        current.status === 'ready' ? { ...current, queue: read.value.ticket, queueNotice: null } : current,
      );
    }
  }, [client]);

  // Re-reads the agent, the room and the queue. A failed read keeps what is on screen; "no room" (404) clears it.
  const refreshSite = useCallback(async () => {
    void refreshCharacters();
    let overtaken = true;
    while (overtaken) {
      const seen = streamEvents.current;
      const [agent, room, queue, readyCheck] = await Promise.all([
        client.myAgent(),
        client.myRoom(),
        client.myQueueTicket(),
        client.myReadyCheck(),
      ]);
      overtaken = streamEvents.current !== seen;
      if (!overtaken) {
        setBoot((current) =>
          current.status === 'ready'
            ? {
                ...current,
                agent: agent.ok ? agent.value : current.agent,
                room: room.ok ? shownRoom(room.value) : room.failure === 'not-found' ? null : current.room,
                queue: queue.ok ? queue.value.ticket : current.queue,
                // The open check is read again on every load and stream reopen (RDY-11); a failed read keeps what is shown.
                readyCheck: readyCheck.ok ? readyCheck.value : current.readyCheck,
              }
            : current,
        );
      }
    }
  }, [client, refreshCharacters]);

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

  // One stream per signed-in site. Every open re-reads the state, so an event lost in a reconnect is never stale.
  useEffect(() => {
    if (!signedIn) {
      return undefined;
    }
    return openStream({
      onOpen: () => {
        void refreshSite();
      },
      onEvent: (event) => {
        streamEvents.current += 1;
        setBoot((current) => (current.status === 'ready' ? applyStreamEvent(current, event) : current));
        if (event.type === 'characters.updated') {
          void refreshCharacters();
        }
      },
    });
  }, [signedIn, openStream, refreshSite, refreshCharacters]);

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

  const { session, agent, room, pairedNotice, queue, queueNotice, readyCheck } = boot;
  // The agent panel (presence, or the pairing form) is the status column; the header shows the agent's state and the
  // account. Characters, queues and rooms are the main column.
  const showPresence = session !== null && agent?.status === 'paired';
  const showPairing = session !== null && (agent?.status === 'none' || pairedNotice);
  return (
    <Layout
      agent={session !== null ? <AgentPill agent={agent} /> : null}
      account={
        <SignInPanel
          client={client}
          staging={boot.config.stagingEndpoints}
          bnetSignIn={boot.config.bnetSignIn}
          bnetFailed={signInFailed}
          session={session}
          onSignedIn={(next) => {
            setBoot((current) => (current.status === 'ready' ? { ...current, session: next } : current));
            void refreshSite();
          }}
          onSignedOut={() => {
            // Signed out: nothing of the player's stays on screen, and the stream closes with the signed-in state.
            setBoot((current) =>
              current.status === 'ready'
                ? { ...current, session: null, agent: null, room: null, pairedNotice: false }
                : current,
            );
          }}
        />
      }
      status={
        showPresence || showPairing ? (
          <>
            {showPresence ? (
              <PresencePanel
                client={client}
                agent={agent}
                onRevoked={() => {
                  // The agent is cut off: the site reads it again, and the answer ("no agent") shows the pairing form. A
                  // failed read keeps what is on screen, as every read does.
                  setBoot((current) =>
                    current.status === 'ready' ? { ...current, pairedNotice: false } : current,
                  );
                  void refreshSite();
                }}
              />
            ) : null}
            {showPairing ? (
              <PairingForm
                client={client}
                paired={pairedNotice}
                onPaired={() => {
                  setBoot((current) =>
                    current.status === 'ready' ? { ...current, pairedNotice: true } : current,
                  );
                  void refreshSite();
                }}
              />
            ) : null}
          </>
        ) : null
      }
    >
      {session !== null && readyCheck !== null ? (
        <ReadyCheckOverlay key={readyCheck.id} readyCheck={readyCheck} client={client} />
      ) : null}
      {session !== null && room !== null ? <RoomPanel room={room} /> : null}
      {session !== null && queue !== null ? (
        <SearchingPanel
          ticket={queue}
          client={client}
          onLeft={() => {
            setBoot((current) =>
              current.status === 'ready' ? { ...current, queue: null, queueNotice: null } : current,
            );
          }}
        />
      ) : null}
      {session !== null && queue === null ? (
        <QueuePanel
          characters={boot.characters}
          client={client}
          notice={queueNotice}
          onJoined={(ticket) => {
            setBoot((current) =>
              current.status === 'ready' ? { ...current, queue: ticket, queueNotice: null } : current,
            );
            void refreshQueue();
          }}
        />
      ) : null}
      {session !== null ? (
        <CharacterList
          characters={boot.characters}
          client={client}
          onDeclared={() => void refreshCharacters()}
        />
      ) : null}
      {session !== null && boot.config.stagingEndpoints ? (
        <StartTestMatchButton client={client} onStarted={() => void refreshSite()} />
      ) : null}
    </Layout>
  );
}
