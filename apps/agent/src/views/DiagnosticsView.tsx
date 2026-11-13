// The local read diagnostics (collapsed by default): what the last look at the game window read. Counts, the frame size and
// reason codes only; nothing here is sent anywhere, and no name or game text is shown (NFR-04, rule 5).
import { diagnosticsLabels, translateLabel, type Diagnostics, type Translate } from '../shared/labels.ts';

interface DiagnosticsViewProps {
  diagnostics: Diagnostics | null;
  translate: Translate;
}

export function DiagnosticsView({ diagnostics, translate }: DiagnosticsViewProps) {
  if (diagnostics === null) {
    return null;
  }
  const heading = translate('diagnostics.heading');
  return (
    <details>
      <summary>{heading}</summary>
      <ul>
        {diagnosticsLabels(diagnostics).map((label, index) => (
          <li key={`${label.key}-${index}`}>{translateLabel(translate, label)}</li>
        ))}
      </ul>
    </details>
  );
}
