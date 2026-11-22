// The window root (AGS-05, AGS-34): listens to the one `agent-state` event the app publishes, and sends the commands the
// window may send: "Get a new code" (design.md § State to UI) and the player's consent to capture (CHR-01, CHR-02).
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentView, PairingState, Translate } from '../shared/labels.ts';
import { ConsentView } from '../views/ConsentView.tsx';
import { TelemetryView, type TelemetryTier } from '../views/TelemetryView.tsx';
import { PairingView } from '../views/PairingView.tsx';
import { DiagnosticsView } from '../views/DiagnosticsView.tsx';
import { HotkeysView, type HotkeyAction } from '../views/HotkeysView.tsx';
import { StatusView } from '../views/StatusView.tsx';

const AGENT_STATE_EVENT = 'agent-state';
const GET_NEW_CODE_COMMAND = 'get_new_code';
const GET_CONSENT_COMMAND = 'get_consent';
const SET_CONSENT_COMMAND = 'set_consent';
const SET_HOTKEY_COMMAND = 'set_hotkey';
const GET_DIAGNOSTICS_COMMAND = 'get_diagnostics';
const SET_DIAGNOSTICS_COMMAND = 'set_diagnostics';
// Shown until the core publishes its first state: the window is asking for a code.
const NO_PRESS = 'none';
const PAIRING_BEFORE_FIRST_STATE: PairingState = 'requesting';
const DIAGNOSTICS_UNREADABLE: DiagnosticsAnswer = { enabled: true, tier: null };

interface DiagnosticsAnswer {
  enabled: boolean;
  // `null`: the window could not read the setting, so it shows the switch as on (the default) with an error line.
  tier: TelemetryTier | null;
}

// The answer is used only when it has the expected shape; anything else shows the switch as on, with an error line.
function isDiagnosticsAnswer(value: unknown): value is DiagnosticsAnswer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { enabled, tier } = value as Record<string, unknown>;
  return typeof enabled === 'boolean' && (tier === 'full' || tier === 'production');
}

interface AppProps {
  translate: Translate;
}

export function App({ translate }: AppProps) {
  const [view, setView] = useState<AgentView | null>(null);
  // No consent until the store answers: the window never shows a capture as allowed before it is.
  const [consent, setConsent] = useState(false);
  const [consentFailed, setConsentFailed] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsAnswer | null>(null);
  const [diagnosticsFailed, setDiagnosticsFailed] = useState(false);

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

  useEffect(() => {
    let disposed = false;
    // The opt-out never disappears: a failed or unexpected answer leaves the switch on screen (OBT-14, OBT-15).
    invoke<unknown>(GET_DIAGNOSTICS_COMMAND).then(
      (stored) => {
        if (!disposed) {
          setDiagnostics(isDiagnosticsAnswer(stored) ? stored : DIAGNOSTICS_UNREADABLE);
        }
      },
      () => {
        if (!disposed) {
          setDiagnostics(DIAGNOSTICS_UNREADABLE);
        }
      },
    );
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

  const changeDiagnostics = (enabled: boolean) => {
    setDiagnosticsFailed(false);
    invoke<boolean>(SET_DIAGNOSTICS_COMMAND, { enabled }).then(
      (stored) =>
        setDiagnostics((current) => (current === null ? current : { ...current, enabled: stored === true })),
      () => setDiagnosticsFailed(true),
    );
  };

  // The core stores the combination or refuses it with a reason code, which the view shows (AST-01).
  const changeHotkey = async (action: HotkeyAction, combination: string) => {
    await invoke(SET_HOTKEY_COMMAND, { action, combination });
  };

  return (
    <main>
      <h1>{title}</h1>
      <ConsentView consent={consent} failed={consentFailed} translate={translate} onChange={changeConsent} />
      {diagnostics === null ? null : (
        <TelemetryView
          enabled={diagnostics.enabled}
          tier={diagnostics.tier}
          failed={diagnosticsFailed}
          translate={translate}
          onChange={changeDiagnostics}
        />
      )}
      <PairingView pairing={pairing} translate={translate} onNewCode={requestNewCode} />
      {view === null ? null : <StatusView view={view} translate={translate} />}
      {view === null ? null : (
        <HotkeysView hotkeys={view.hotkeys} translate={translate} onChange={changeHotkey} />
      )}
      {view === null ? null : (
        <DiagnosticsView
          diagnostics={view.diagnostics}
          capture={view.capture}
          configVersion={view.configVersion}
          lastPress={view.lastPress ?? NO_PRESS}
          translate={translate}
        />
      )}
    </main>
  );
}
