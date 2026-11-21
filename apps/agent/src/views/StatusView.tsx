// The status part of the window (AGS-11, AGS-14, AGS-26, AGS-27): the connection line once paired, the room line and
// the update line. Nothing is shown for an idle update.
import {
  connectivityLabel,
  copyLabel,
  hotkeyUnavailableLabels,
  offersCopyAgain,
  readyCheckLabel,
  revealLabel,
  roomLabel,
  translateLabel,
  updateLabel,
  type AgentView,
  type Label,
  type Translate,
} from '../shared/labels.ts';

interface StatusViewProps {
  view: AgentView;
  translate: Translate;
  // The player asks for the game name again (AST-12); the button shows only while a room is held.
  onCopyAgain?: () => void;
}

export function StatusView({ view, translate, onCopyAgain }: StatusViewProps) {
  const labels: Label[] = [];
  if (view.pairing === 'paired') {
    labels.push(connectivityLabel(view.connectivity));
  }
  const room = roomLabel(view.room);
  if (room !== null) {
    labels.push(room);
  }
  const reveal = revealLabel(view.room);
  if (reveal !== null) {
    labels.push(reveal);
  }
  const copy = copyLabel(view.room, view.lastCopy);
  if (copy !== null) {
    labels.push(copy);
  }
  labels.push(...hotkeyUnavailableLabels(view.hotkeyUnavailable, view.hotkeys));
  const update = updateLabel(view.update);
  if (update !== null) {
    labels.push(update);
  }
  const readyCheck = readyCheckLabel(view.readyCheckOpen, view.hotkeys);
  if (readyCheck !== null) {
    labels.push(readyCheck);
  }

  const copyAgain = translate('copy.again');
  return (
    <>
      <ul>
        {labels.map((label) => (
          <li key={label.key}>{translateLabel(translate, label)}</li>
        ))}
      </ul>
      {onCopyAgain !== undefined && offersCopyAgain(view.room) ? (
        <button type="button" onClick={onCopyAgain}>
          {copyAgain}
        </button>
      ) : null}
    </>
  );
}
