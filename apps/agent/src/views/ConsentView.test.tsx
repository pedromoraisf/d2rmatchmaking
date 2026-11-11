import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createAgentI18n, translatorFor } from '../shared/i18n.ts';
import { ConsentView } from './ConsentView.tsx';

const en = translatorFor(createAgentI18n('en'));
const ptBR = translatorFor(createAgentI18n('pt-BR'));

afterEach(() => {
  cleanup();
});

describe('consent view', () => {
  it('says what is captured, what is sent and what never leaves the PC', () => {
    render(<ConsentView consent={false} failed={false} translate={en} onChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Screen capture' })).toBeTruthy();
    expect(screen.getByText(/captures only the Diablo II: Resurrected game window/)).toBeTruthy();
    expect(screen.getByText(/sends the characters on the character selection screen/)).toBeTruthy();
    expect(screen.getByText(/never leave this PC/)).toBeTruthy();
  });

  it('offers to allow the capture while none is given, and says nothing is read', () => {
    render(<ConsentView consent={false} failed={false} translate={en} onChange={vi.fn()} />);

    expect(screen.getByText('Capture is off. The agent reads nothing.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow capture' })).toBeTruthy();
  });

  it('allows the capture when the button is pressed', () => {
    const onChange = vi.fn();
    render(<ConsentView consent={false} failed={false} translate={en} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow capture' }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('withdraws the consent when the button is pressed after it was given', () => {
    const onChange = vi.fn();
    render(<ConsentView consent failed={false} translate={en} onChange={onChange} />);

    expect(screen.getByText('Capture is allowed on this PC.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('is reached with the keyboard: the control is a focusable button', () => {
    render(<ConsentView consent={false} failed={false} translate={en} onChange={vi.fn()} />);

    const control = screen.getByRole('button', { name: 'Allow capture' });
    control.focus();

    expect(document.activeElement).toBe(control);
  });

  it('shows the refusal to save as an alert', () => {
    render(<ConsentView consent={false} failed translate={en} onChange={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toBe('Could not save your choice. Try again.');
  });

  it('shows the Portuguese text in the pt-BR window', () => {
    render(<ConsentView consent={false} failed={false} translate={ptBR} onChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Captura de tela' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Permitir captura' })).toBeTruthy();
  });
});
