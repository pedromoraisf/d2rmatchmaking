// The window root (AGS-05, AGS-34): listens to the one `agent-state` event the app publishes, and sends the commands the
// window may send: "Get a new code" (design.md § State to UI) and the player's consent to capture (CHR-01, CHR-02).
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentView, PairingState, Translate } from '../shared/labels.ts';
import { ConsentView } from '../views/ConsentView.tsx';
import { PairingView } from '../views/PairingView.tsx';
import { DiagnosticsView } from '../views/DiagnosticsView.tsx';
import { StatusView } from '../views/StatusView.tsx';

const AGENT_STATE_EVENT = 'agent-state';
const GET_NEW_CODE_COMMAND = 'get_new_code';
const GET_CONSENT_COMMAND = 'get_consent';
const SET_CONSENT_COMMAND = 'set_consent';
// Shown until the core publishes its first state: the window is asking for a code.
const PAIRING_BEFORE_FIRST_STATE: PairingState = 'requesting';

interface AppProps {
  translate: Translate;
}

export function App({ translate }: AppProps) {
  const [view, setView] = useState<AgentView | null>(null);
  // No consent until the store answers: the window never shows a capture as allowed before it is.
  const [consent, setConsent] = useState(false);
  const [consentFailed, setConsentFailed] = useState(false);

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

  useEffect(() => {
    let disposed = false;
    void invoke<boolean>(GET_CONSENT_COMMAND).then((stored) => {
      if (!disposed) {
        setConsent(stored === true);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  const title = translate('app.title');
  const pairing: PairingState = view?.pairing ?? PAIRING_BEFORE_FIRST_STATE;
  const requestNewCode = () => {
    void invoke(GET_NEW_CODE_COMMAND);
  };
  const changeConsent = (next: boolean) => {
    setConsentFailed(false);
    invoke<boolean>(SET_CONSENT_COMMAND, { consent: next }).then(
      (stored) => setConsent(stored === true),
      () => setConsentFailed(true),
    );
  };

  return (
    <main>
      <h1>{title}</h1>
      <ConsentView consent={consent} failed={consentFailed} translate={translate} onChange={changeConsent} />
      <PairingView pairing={pairing} translate={translate} onNewCode={requestNewCode} />
      {view === null ? null : <StatusView view={view} translate={translate} />}
      {view === null ? null : <DiagnosticsView diagnostics={view.diagnostics} translate={translate} />}
    </main>
  );
}
