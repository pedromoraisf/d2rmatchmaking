// The window root (AGS-05, AGS-34): listens to the one `agent-state` event the app publishes, and sends the one command
// the window may send, "Get a new code" (design.md § State to UI).
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentView, PairingState, Translate } from '../shared/labels.ts';
import { PairingView } from '../views/PairingView.tsx';
import { StatusView } from '../views/StatusView.tsx';

const AGENT_STATE_EVENT = 'agent-state';
const GET_NEW_CODE_COMMAND = 'get_new_code';
// Shown until the core publishes its first state: the window is asking for a code.
const PAIRING_BEFORE_FIRST_STATE: PairingState = 'requesting';

interface AppProps {
  translate: Translate;
}

export function App({ translate }: AppProps) {
  const [view, setView] = useState<AgentView | null>(null);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<AgentView>(AGENT_STATE_EVENT, (event) => {
      setView(event.payload);
    }).then((stop) => {
      if (disposed) {
        stop();
      } else {
        stopListening = stop;
      }
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  const title = translate('app.title');
  const pairing: PairingState = view?.pairing ?? PAIRING_BEFORE_FIRST_STATE;
  const requestNewCode = () => {
    void invoke(GET_NEW_CODE_COMMAND);
  };

  return (
    <main>
      <h1>{title}</h1>
      <PairingView pairing={pairing} translate={translate} onNewCode={requestNewCode} />
      {view === null ? null : <StatusView view={view} translate={translate} />}
    </main>
  );
}
