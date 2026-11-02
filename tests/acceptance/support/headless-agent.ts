// The headless agent of the trace scenario (OBS-24, AGS-33). The example in `apps/agent` runs the real agent core, the real
// HTTP gateway and the real span exporter, with a fixture screen. This helper starts it with `cargo run` (the first run
// builds it, later runs reuse the build), parses its stdout events and sends it `read` lines. The example never learns the
// acceptance stack's internals: it talks to the API it is given, like any agent.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: this file is in tests/acceptance/support. */
const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const AGENT_MANIFEST = path.join(repoRoot, 'apps', 'agent', 'src-tauri', 'Cargo.toml');
/** The fixture screen: a 1920x1080 frame (the only size the example reads, AD-096), with the game name as its sidecar. */
export const FIXTURE_SCREEN = path.join(repoRoot, 'apps', 'agent', 'fixtures', 'automap-game-name.png');

const WAIT_POLL_MS = 100;
const STOP_TIMEOUT_MS = 20_000;

/** One event the example printed: `code`, `paired`, `assignment` or `observed`, with its fields. */
export interface AgentEvent {
  readonly event: string;
  readonly [key: string]: unknown;
}

/** The events of the example's stdout, one JSON object per line. Other lines are not events and are skipped. */
export function parseEventLines(text: string): AgentEvent[] {
  return text.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return [];
    try {
      const value = JSON.parse(trimmed) as unknown;
      return typeof value === 'object' &&
        value !== null &&
        typeof (value as { event?: unknown }).event === 'string'
        ? [value as AgentEvent]
        : [];
    } catch {
      return [];
    }
  });
}

/** Writes the fixture screen into `dir` and its sidecar text (`<png>.txt`): the game name the screen shows. */
export function prepareFixture(dir: string, gameName: string): { png: string; sidecar: string } {
  const png = path.join(dir, 'automap-game-name.png');
  copyFileSync(FIXTURE_SCREEN, png);
  const sidecar = `${png}.txt`;
  writeFileSync(sidecar, `${gameName}\n`);
  return { png, sidecar };
}

/** The `cargo` that runs the example: the rustup toolchain lives in `~/.cargo/bin`, which the shell may not have. */
function cargoEnv(): Record<string, string> {
  return {
    PATH: `${path.join(homedir(), '.cargo', 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
    HOME: homedir(),
  };
}

export class HeadlessAgent {
  readonly #child: ChildProcess;
  readonly #events: AgentEvent[] = [];
  readonly #exited: Promise<number | null>;
  #pending = '';
  #stderr = '';
  #exitCode: number | null | undefined;

  private constructor(child: ChildProcess) {
    this.#child = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.#pending += chunk;
      const lines = this.#pending.split('\n');
      this.#pending = lines.pop() ?? '';
      this.#events.push(...parseEventLines(lines.join('\n')));
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-8_000);
    });
    this.#exited = new Promise((resolve) => {
      child.once('exit', (code) => {
        this.#exitCode = code;
        resolve(code);
      });
    });
  }

  /** Starts the example against `apiBase` with the fixture screen at `fixture`. Its events are read from then on. */
  static start(options: { apiBase: string; fixture: string }): HeadlessAgent {
    const child = spawn(
      'cargo',
      [
        'run',
        '--quiet',
        '--locked',
        '--manifest-path',
        AGENT_MANIFEST,
        '-p',
        'd2rmm-agent-adapters',
        '--example',
        'headless',
        '--features',
        'fixture-read',
        '--',
        '--api-base',
        options.apiBase,
        '--read-fixture',
        options.fixture,
      ],
      { cwd: repoRoot, env: cargoEnv(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return new HeadlessAgent(child);
  }

  /** Every event printed so far, in order. */
  get events(): readonly AgentEvent[] {
    return this.#events;
  }

  /** Waits until an event named `event` (that `matches`, when given) is printed, or fails after `timeoutMs`. */
  async waitFor(
    event: string,
    timeoutMs = 45_000,
    matches: (value: AgentEvent) => boolean = () => true,
  ): Promise<AgentEvent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.#events.find((item) => item.event === event && matches(item));
      if (found !== undefined) return found;
      if (this.#exitCode !== undefined) {
        throw new Error(
          `the headless agent exited with ${this.#exitCode} before "${event}"\n${this.#stderr}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    }
    throw new Error(`the headless agent printed no "${event}" event within ${timeoutMs} ms\n${this.#stderr}`);
  }

  /** Sends one `read` line: the example reads the fixture screen once and posts what it sees. */
  read(): void {
    this.#child.stdin?.write('read\n');
  }

  /**
   * Closes the example's input, so it runs its shutdown (the span exporter flushes, the stream closes), and waits for the
   * exit. A process that does not exit in time is killed with its group.
   */
  async stop(): Promise<void> {
    if (this.#exitCode !== undefined) return;
    this.#child.stdin?.end();
    const timer = setTimeout(() => {
      if (this.#child.pid !== undefined) process.kill(-this.#child.pid, 'SIGKILL');
    }, STOP_TIMEOUT_MS);
    await this.#exited;
    clearTimeout(timer);
  }
}
