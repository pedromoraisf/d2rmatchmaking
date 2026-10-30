// Writes the contract documents to packages/contracts/{openapi,asyncapi}.json. Run by `pnpm contracts:openapi`.
// The output is deterministic (no timestamps), so regenerating with no change leaves no diff (HF-04).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAsyncApiDocument, buildOpenApiDocument } from '../src/documents.ts';

const serialize = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;

writeFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), serialize(buildOpenApiDocument()));
writeFileSync(
  fileURLToPath(new URL('../asyncapi.json', import.meta.url)),
  serialize(buildAsyncApiDocument()),
);
