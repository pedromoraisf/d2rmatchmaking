import { describe, expect, it } from 'vitest';
import { createResource } from './resource.ts';

describe('createResource', () => {
  it('carries service name, version and environment', () => {
    const resource = createResource({
      serviceName: 'd2rmm-api',
      serviceVersion: '1.4.2',
      environment: 'production',
    });

    // No host or process attribute: the resource holds exactly the three keys.
    expect(resource.attributes).toStrictEqual({
      'service.name': 'd2rmm-api',
      'service.version': '1.4.2',
      'deployment.environment': 'production',
    });
  });

  it('carries the agent version only for the agent', () => {
    const agent = createResource({
      serviceName: 'd2rmm-agent',
      serviceVersion: '0.9.0',
      environment: 'production',
      agentVersion: '0.9.0',
    });
    expect(agent.attributes['d2r.agent.version']).toBe('0.9.0');

    const api = createResource({
      serviceName: 'd2rmm-api',
      serviceVersion: '1.4.2',
      environment: 'production',
    });
    expect(api.attributes).not.toHaveProperty('d2r.agent.version');
  });
});
