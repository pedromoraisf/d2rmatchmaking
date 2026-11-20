// The hotkeys part of the window (AST-01): the two keys the agent registers, each with a field to change it. The window
// holds no rule: the core refuses a combination and the window shows the reason it names.
import { useState } from 'react';
import type { Hotkeys, Translate } from '../shared/labels.ts';

export type HotkeyAction = 'accept' | 'fill';

// The reasons the core gives for a refused combination; anything else reads as "could not save".
const REFUSALS = [
  'no-modifier',
  'needs-ctrl-or-alt',
  'reserved',
  'confirming-key',
  'unsupported-key',
  'same-as-other',
] as const;

export function refusalKey(reason: unknown): string {
  return typeof reason === 'string' && (REFUSALS as readonly string[]).includes(reason)
    ? `hotkeys.refused.${reason}`
    : 'hotkeys.refused.not-saved';
}

interface HotkeysViewProps {
  hotkeys: Hotkeys;
  translate: Translate;
  // Resolves when the core stored the combination; rejects with the reason code when it refused it.
  onChange: (action: HotkeyAction, combination: string) => Promise<void>;
}

interface RowProps {
  action: HotkeyAction;
  current: string;
  translate: Translate;
  onChange: HotkeysViewProps['onChange'];
}

function HotkeyRow({ action, current, translate, onChange }: RowProps) {
  const [draft, setDraft] = useState(current);
  const [message, setMessage] = useState<{ key: string; failed: boolean } | null>(null);
  const label = translate(`hotkeys.${action}`);
  const saveLabel = translate('hotkeys.save');
  const save = () => {
    onChange(action, draft).then(
      () => setMessage({ key: 'hotkeys.saved', failed: false }),
      (reason: unknown) => setMessage({ key: refusalKey(reason), failed: true }),
    );
  };
  return (
    <li>
      <label>
        {label}
        <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button type="button" onClick={save}>
        {saveLabel}
      </button>
      {message === null ? null : <p role={message.failed ? 'alert' : 'status'}>{translate(message.key)}</p>}
    </li>
  );
}

const ACCEPT: HotkeyAction = 'accept';
const FILL: HotkeyAction = 'fill';

export function HotkeysView({ hotkeys, translate, onChange }: HotkeysViewProps) {
  const heading = translate('hotkeys.heading');
  return (
    <section aria-labelledby="hotkeys-heading">
      <h2 id="hotkeys-heading">{heading}</h2>
      <ul>
        <HotkeyRow
          key={`accept-${hotkeys.accept}`}
          action={ACCEPT}
          current={hotkeys.accept}
          translate={translate}
          onChange={onChange}
        />
        <HotkeyRow
          key={`fill-${hotkeys.fill}`}
          action={FILL}
          current={hotkeys.fill}
          translate={translate}
          onChange={onChange}
        />
      </ul>
    </section>
  );
}
