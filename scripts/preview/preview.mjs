// Pure helpers of the API preview workflow (ADR 030): find the Render preview service of a pull request, and validate
// a preview API origin before a site build bakes it in. The CLI at the bottom is what preview-api.yml calls.
import { fileURLToPath } from 'node:url';

export const BASE_SERVICE = 'd2rmm-api';
const PREVIEW_ORIGIN = /^https:\/\/d2rmm-api-pr-[0-9]+\.onrender\.com$/;

/**
 * The preview service of pull request `n` in a Render list-services answer (array of `{ service }` entries or of bare
 * services), or undefined. A preview is matched by its parent service name and its own name, never by name alone.
 */
export function pickPreviewService(services, n) {
  if (!Array.isArray(services) || !Number.isInteger(n) || n < 1) return undefined;
  const name = `${BASE_SERVICE}-pr-${n}`;
  return services
    .map((entry) => entry?.service ?? entry)
    .find(
      (service) => service?.name === name && service?.serviceDetails?.parentServer?.name === BASE_SERVICE,
    );
}

/** The origin when it is exactly `https://d2rmm-api-pr-<digits>.onrender.com`, else undefined. */
export function validPreviewOrigin(value) {
  return typeof value === 'string' && PREVIEW_ORIGIN.test(value) ? value : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `find <n>`: reads a list-services page on stdin, prints "<id> <origin>" of the preview, or nothing when absent.
  const [command, arg] = process.argv.slice(2);
  if (command !== 'find') {
    process.stderr.write('usage: preview.mjs find <pull request number> < list-services.json\n');
    process.exit(2);
  }
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const service = pickPreviewService(JSON.parse(text), Number(arg));
  const origin = validPreviewOrigin(service?.serviceDetails?.url);
  if (service && origin) process.stdout.write(`${service.id} ${origin}\n`);
}
