// The pairing part of the window (AGS-05, AGS-34, AGS-35): the code with its minutes left, or the one line that says
// why no code is shown, and "Get a new code" only where the core offers it.
import {
  offersNewCode,
  pairingLabel,
  translateLabel,
  type PairingState,
  type Translate,
} from '../shared/labels.ts';

interface PairingViewProps {
  pairing: PairingState;
  translate: Translate;
  onNewCode: () => void;
}

export function PairingView({ pairing, translate, onNewCode }: PairingViewProps) {
  if (typeof pairing === 'object') {
    const { code, minutesLeft } = pairing.showingCode;
    const heading = translate('pairing.codeLabel');
    const hint = translate('pairing.codeHint');
    const expires = translate('pairing.expiresIn', { minutes: minutesLeft });
    return (
      <section aria-live="polite">
        <h2>{heading}</h2>
        <p className="pairing-code">{code}</p>
        <p>{hint}</p>
        <p>{expires}</p>
      </section>
    );
  }

  const label = pairingLabel(pairing);
  const text = label === null ? null : translateLabel(translate, label);
  const newCode = offersNewCode(pairing) ? translate('pairing.newCode') : null;
  return (
    <section aria-live="polite">
      {text === null ? null : <p>{text}</p>}
      {newCode === null ? null : (
        <button type="button" onClick={onNewCode}>
          {newCode}
        </button>
      )}
    </section>
  );
}
