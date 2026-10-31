import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { PairingForm } from './PairingForm.tsx';

afterEach(cleanup);

function renderForm(status: number, onPaired = vi.fn()) {
  const { fetch, calls } = routeFetch({ 'POST /api/v1/agents/pair': () => jsonResponse(status) });
  renderInLanguage(<PairingForm client={createApiClient(fetch)} paired={false} onPaired={onPaired} />);
  return { onPaired, calls };
}

async function enterCode(code: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Pairing code'), code);
  await user.click(screen.getByRole('button', { name: 'Pair agent' }));
}

describe('PairingForm', () => {
  it('is shown with the code field and the pair action when no agent is paired', () => {
    renderForm(200);
    expect(screen.getByLabelText('Pairing code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair agent' })).toBeTruthy();
  });

  it('reports the agent paired once the API accepts the code', async () => {
    const { onPaired, calls } = renderForm(200);
    await enterCode('123456');
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledOnce());
    expect(calls[0]?.init.body).toBe('{"code":"123456"}');
  });

  it('shows the invalid-code message for a 400 and does not pair', async () => {
    const { onPaired } = renderForm(400);
    await enterCode('000000');
    expect((await screen.findByRole('alert')).textContent).toBe('This code is invalid or has expired.');
    expect(onPaired).not.toHaveBeenCalled();
  });

  it('shows the too-many-attempts message for a 429', async () => {
    renderForm(429);
    await enterCode('000000');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Try again in a few minutes.',
    );
  });

  it('shows "Agent paired" in place of the form once the parent marks it paired', () => {
    renderInLanguage(<PairingForm client={createApiClient()} paired onPaired={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Agent paired');
    expect(screen.queryByLabelText('Pairing code')).toBeNull();
  });
});
