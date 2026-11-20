// The wire between a scenario's headless agents and the API (agent-trust, AGT-04, AGT-05). A scenario that asks for it
// has each headless agent talk to a recording proxy in front of the API: the scenario reads what each agent sent (the
// method, the path, the content type and the names of a JSON body's keys) and hands an agent a stream event the API
// never sent. Test support only: the API is untouched, and a scenario that does not ask for the wire talks to the API.
import { startRecordingProxy, type RecordingProxy } from './agent-proxy.ts';
import type { World } from './world.ts';

interface Wires {
  enabled: boolean;
  readonly proxies: Map<string, RecordingProxy>;
}

const wires = new WeakMap<World, Wires>();

function wiresOf(world: World): Wires {
  let found = wires.get(world);
  if (found === undefined) {
    found = { enabled: false, proxies: new Map() };
    wires.set(world, found);
  }
  return found;
}

/** The scenario's headless agents go through the recording proxy from now on. */
export function enableWire(world: World): void {
  wiresOf(world).enabled = true;
}

/** The API base the player's headless agent is given: the proxy's when the scenario enabled the wire, else the API's. */
export async function apiBaseFor(world: World, name: string): Promise<string> {
  const state = wiresOf(world);
  if (!state.enabled) return world.site.api;
  const proxy = await startRecordingProxy(world.site.api);
  state.proxies.set(name, proxy);
  return proxy.url;
}

/** The proxy in front of the player's headless agent. */
export function wireOf(world: World, name: string): RecordingProxy {
  const proxy = wiresOf(world).proxies.get(name);
  if (proxy === undefined) {
    throw new Error(`${name}'s headless agent does not go through the recording proxy in this scenario`);
  }
  return proxy;
}

/** Closes every proxy of the scenario. */
export async function closeWires(world: World): Promise<void> {
  const state = wires.get(world);
  if (state === undefined) return;
  await Promise.all([...state.proxies.values()].map((proxy) => proxy.close()));
  state.proxies.clear();
  state.enabled = false;
}
