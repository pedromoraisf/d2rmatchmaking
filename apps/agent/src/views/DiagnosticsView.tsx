// The local read diagnostics (collapsed by default): what the last look at the game window read. Counts, the frame size and
// reason codes only; nothing here is sent anywhere, and no name or game text is shown (NFR-04, rule 5).
import {
  captureLabels,
  diagnosticsLabels,
  lastPressLabel,
  translateLabel,
  type CaptureDiagnostics,
  type Diagnostics,
  type HotkeyPress,
  type Translate,
} from '../shared/labels.ts';

interface DiagnosticsViewProps {
  diagnostics: Diagnostics | null;
  capture?: CaptureDiagnostics | undefined;
  // The last hotkey press the agent received. Passed by the app; the section then always shows, so it can say none came.
  lastPress?: HotkeyPress | 'none';
  translate: Translate;
}

export function DiagnosticsView({ diagnostics, capture, lastPress, translate }: DiagnosticsViewProps) {
  // A game that runs and gives no frame has no read to show, but the capture still has something to say (CAP-02).
  if (diagnostics === null && capture === undefined && lastPress === undefined) {
    return null;
  }
  const heading = translate('diagnostics.heading');
  const labels = [
    ...(diagnostics === null ? [] : diagnosticsLabels(diagnostics)),
    ...(capture === undefined ? [] : captureLabels(capture)),
    ...(lastPress === undefined ? [] : [lastPressLabel(lastPress === 'none' ? undefined : lastPress)]),
  ];
  return (
    <details>
      <summary>{heading}</summary>
      <ul>
        {labels.map((label, index) => (
          <li key={`${label.key}-${index}`}>{translateLabel(translate, label)}</li>
        ))}
      </ul>
    </details>
  );
}
