// The resource every bootstrap exports with (OBS-32). Service identity only: no host and no process detector, so no
// machine name, address or instance id reaches the backend.
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';

export type ResourceInput = {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  agentVersion?: string;
};

/** The resource of one process. `agentVersion` is set by the desktop agent only. */
export function createResource(input: ResourceInput): Resource {
  const attributes: Record<string, string> = {
    'service.name': input.serviceName,
    'service.version': input.serviceVersion,
    'deployment.environment': input.environment,
  };
  if (input.agentVersion !== undefined) attributes['d2r.agent.version'] = input.agentVersion;
  return resourceFromAttributes(attributes);
}
