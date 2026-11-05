import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWebTelemetry } from '@d2rmm/telemetry/web';
import { createApiClient } from '../../shared/api-client.ts';
import { tracingFetcher } from '../../shared/telemetry.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { StartTestMatchButton } from './StartTestMatchButton.tsx';

afterEach(cleanup);

describe('StartTestMatchButton', () => {
  it('posts a test match on click and reports that it started', async () => {
    const { fetch, calls } = routeFetch({ 'POST /api/v1/staging/match-formed': () => jsonResponse(202) });
    const onStarted = vi.fn();
    renderInLanguage(<StartTestMatchButton client={createApiClient(fetch)} onStarted={onStarted} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start test match' }));
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
    expect(calls.map((call) => call.url)).toStrictEqual(['/api/v1/staging/match-formed']);
  });

  it('shows the error message and does not report a started match when the API refuses', async () => {
    const { fetch } = routeFetch({ 'POST /api/v1/staging/match-formed': () => jsonResponse(500) });
    const onStarted = vi.fn();
    renderInLanguage(<StartTestMatchButton client={createApiClient(fetch)} onStarted={onStarted} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start test match' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('the start test match click sends a traceparent', async () => {
    // Every trace is sampled out: the request still carries the context of its span, and nothing is exported.
    startWebTelemetry({
      enabled: true,
      ratio: '0',
      relayPath: '/api/v1/telemetry/traces',
      serviceVersion: 'test',
      environment: 'test',
    });
    const { fetch, calls } = routeFetch({ 'POST /api/v1/staging/match-formed': () => jsonResponse(202) });
    renderInLanguage(
      <StartTestMatchButton client={createApiClient(tracingFetcher(fetch))} onStarted={vi.fn()} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start test match' }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(new Headers(calls[0]?.init.headers).get('traceparent')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });
});
