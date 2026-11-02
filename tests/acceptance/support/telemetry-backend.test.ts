import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageFromCompose, startTelemetryBackend } from './telemetry-backend.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const composeText = readFileSync(
  path.resolve(here, '..', '..', '..', 'infra', 'observability', 'compose.yaml'),
  'utf8',
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('telemetry backend', () => {
  it('runs the image that the compose file pins, by tag and digest', () => {
    expect(imageFromCompose(composeText)).toMatch(/^grafana\/otel-lgtm:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/u);
  });

  it('fails naming Docker when the socket is absent', async () => {
    vi.stubEnv('DOCKER_HOST', 'unix:///nonexistent-d2rmm-docker/docker.sock');
    await expect(startTelemetryBackend()).rejects.toThrow(/^Docker is not running/u);
  });
});
