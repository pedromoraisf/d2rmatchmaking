import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createAgentI18n, translatorFor } from '../shared/i18n.ts';
import { TelemetryView, type TelemetryTier } from './TelemetryView.tsx';

const en = translatorFor(createAgentI18n('en'));
const ptBR = translatorFor(createAgentI18n('pt-BR'));
const production: TelemetryTier = 'production';
const full: TelemetryTier = 'full';

afterEach(() => {
  cleanup();
});

describe('telemetry view (OBT-14, OBT-15, OBT-17)', () => {
  it('says what the production tier carries: no names, no read text', () => {
    render(<TelemetryView enabled tier={production} failed={false} translate={en} onChange={vi.fn()} />);

    expect(screen.getByText(/never carry names or text read from the game/)).toBeTruthy();
    expect(screen.queryByText(/This detail exists in staging/)).toBeNull();
  });

  it('says what the full tier carries and that it exists on staging and preview builds only', () => {
    render(<TelemetryView enabled tier={full} failed={false} translate={en} onChange={vi.fn()} />);

    expect(screen.getByText(/character names and the text the agent read/)).toBeTruthy();
    expect(screen.getByText(/staging and preview builds only/)).toBeTruthy();
  });

  it('shows an error line instead of a notice, with the switch, when the tier is unknown (en, pt-BR)', () => {
    const onChange = vi.fn();
    render(<TelemetryView enabled tier={null} failed={false} translate={en} onChange={onChange} />);
    expect(screen.getByRole('alert').textContent).toContain('Could not read your diagnostics setting');
    fireEvent.click(screen.getByRole('switch', { name: 'Send diagnostics' }));
    expect(onChange).toHaveBeenCalledWith(false);
    cleanup();

    render(<TelemetryView enabled tier={null} failed={false} translate={ptBR} onChange={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível ler sua configuração');
    expect(screen.getByRole('switch', { name: 'Enviar diagnósticos' })).toBeTruthy();
  });

  it('shows the switch on and turns it off on a press', () => {
    const onChange = vi.fn();
    render(<TelemetryView enabled tier={production} failed={false} translate={en} onChange={onChange} />);

    const control = screen.getByRole('switch', { name: 'Send diagnostics' }) as HTMLInputElement;
    expect(control.checked).toBe(true);
    expect(screen.getByText('Diagnostics are on.')).toBeTruthy();
    fireEvent.click(control);

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows the switch off, and says the agent sends none and that matchmaking is unaffected', () => {
    const onChange = vi.fn();
    render(
      <TelemetryView enabled={false} tier={production} failed={false} translate={en} onChange={onChange} />,
    );

    const control = screen.getByRole('switch', { name: 'Send diagnostics' }) as HTMLInputElement;
    expect(control.checked).toBe(false);
    expect(screen.getByText('Diagnostics are off. The agent sends none.')).toBeTruthy();
    expect(screen.getByText(/Heartbeats and everything matchmaking needs are sent either way/)).toBeTruthy();
    fireEvent.click(control);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is reached with the keyboard', () => {
    render(<TelemetryView enabled tier={production} failed={false} translate={en} onChange={vi.fn()} />);

    const control = screen.getByRole('switch', { name: 'Send diagnostics' });
    control.focus();

    expect(document.activeElement).toBe(control);
  });

  it('shows the refusal to save as an alert', () => {
    render(<TelemetryView enabled tier={production} failed translate={en} onChange={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toBe('Could not save your choice. Try again.');
  });

  it('shows the Portuguese text in the pt-BR window', () => {
    render(<TelemetryView enabled tier={full} failed={false} translate={ptBR} onChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Diagnósticos' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Enviar diagnósticos' })).toBeTruthy();
    expect(screen.getByText(/apenas em versões de staging e de preview/)).toBeTruthy();
  });
});
