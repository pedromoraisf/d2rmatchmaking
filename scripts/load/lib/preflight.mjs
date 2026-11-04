// Names Docker or the image in a failure (LB-18; design.md § Error Handling Strategy). Pure: a failure in, a kind and a
// message out. The texts are the ones the `docker` CLI prints; an unknown text is reported as a Docker failure with the
// original text, redacted.

import { redact } from './redact.mjs';

const UNRECOGNISED_TEXT_LIMIT = 500;

const MISSING = [/command not found/i, /not found: docker/i, /spawn docker ENOENT/i];
const DOWN = [
  /Cannot connect to the Docker daemon/i,
  /Is the docker daemon running/i,
  /docker daemon is not running/i,
  /error during connect/i,
  /Docker Desktop is not running/i,
];
const IMAGE = [
  /pull access denied/i,
  /manifest unknown/i,
  /manifest for \S+ not found/i,
  /repository does not exist/i,
  /unable to pull/i,
  /error pulling image/i,
  /failed to resolve reference/i,
  /failed to solve/i,
  /failed to build/i,
  /build failed/i,
  /no such image/i,
];

function textOf(error) {
  if (typeof error === 'string') {
    return error;
  }
  if (error !== null && typeof error === 'object') {
    return [error.message, error.stderr].filter((part) => typeof part === 'string').join('\n');
  }
  return '';
}

/** The image reference the failure names: an `image` property the caller set, or the reference in the CLI text. */
function imageOf(error, text) {
  if (typeof error?.image === 'string' && error.image !== '') {
    return error.image;
  }
  const match = /(?:pull access denied for|manifest for) ([^\s,"]+)/i.exec(text);
  return match ? match[1] : null;
}

/**
 * The kind of a failed `docker` call and the message to print.
 * @param {unknown} error an Error, a CLI text, or an object with `message`, `stderr` and an optional `image`
 * @returns {{ kind: 'docker-missing' | 'docker-down' | 'image', message: string }}
 */
export function classifyDockerFailure(error) {
  const text = textOf(error);
  if (error?.code === 'ENOENT' || MISSING.some((pattern) => pattern.test(text))) {
    return {
      kind: 'docker-missing',
      message: 'Docker is not installed or not on PATH: install Docker, start it and run the load again',
    };
  }
  if (DOWN.some((pattern) => pattern.test(text))) {
    return {
      kind: 'docker-down',
      message: 'Docker is not running: the daemon did not answer; start Docker and run the load again',
    };
  }
  if (IMAGE.some((pattern) => pattern.test(text))) {
    const reference = imageOf(error, text);
    const named = reference === null ? 'the image' : `the image ${reference}`;
    return {
      kind: 'image',
      message: `${named} could not be built or pulled: check the image and the network, then run the load again`,
    };
  }
  // Redacted first, then cut: a secret that straddles the cut is never written partly. The end of a CLI text holds the
  // reason (its pull or build progress comes first), so the end is kept.
  const original = redact(text).slice(-UNRECOGNISED_TEXT_LIMIT);
  return {
    kind: 'docker-down',
    message: `Docker failed with an error the run does not recognise: ${original}`,
  };
}
