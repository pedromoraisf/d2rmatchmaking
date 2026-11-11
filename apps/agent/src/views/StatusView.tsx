// The status part of the window (AGS-11, AGS-14, AGS-26, AGS-27): the connection line once paired, the room line and
// the update line. Nothing is shown for an idle update.
import {
  connectivityLabel,
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
}

export function StatusView({ view, translate }: StatusViewProps) {
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
  const update = updateLabel(view.update);
  if (update !== null) {
    labels.push(update);
  }
  const readyCheck = readyCheckLabel(view.readyCheckOpen);
  if (readyCheck !== null) {
    labels.push(readyCheck);
  }

  return (
    <ul>
      {labels.map((label) => (
        <li key={label.key}>{translateLabel(translate, label)}</li>
      ))}
    </ul>
  );
}
