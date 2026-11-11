// The consent part of the window (CHR-01, CHR-02, CHR-14): what the agent captures, what it sends, what never leaves the PC,
// and the one control that allows or withdraws the capture. The control is a button, so a keyboard user reaches it with Tab.
import type { Translate } from '../shared/labels.ts';

interface ConsentViewProps {
  consent: boolean;
  failed: boolean;
  translate: Translate;
  onChange: (consent: boolean) => void;
}

export function ConsentView({ consent, failed, translate, onChange }: ConsentViewProps) {
  const heading = translate('consent.heading');
  const captured = translate('consent.captured');
  const sent = translate('consent.sent');
  const neverLeaves = translate('consent.neverLeaves');
  const state = consent ? translate('consent.allowed') : translate('consent.withdrawn');
  const control = consent ? translate('consent.withdraw') : translate('consent.allow');
  const notSaved = failed ? translate('consent.notSaved') : null;
  return (
    <section aria-labelledby="consent-heading">
      <h2 id="consent-heading">{heading}</h2>
      <p>{captured}</p>
      <p>{sent}</p>
      <p>{neverLeaves}</p>
      <p aria-live="polite">{state}</p>
      <button type="button" onClick={() => onChange(!consent)}>
        {control}
      </button>
      {notSaved === null ? null : <p role="alert">{notSaved}</p>}
    </section>
  );
}
