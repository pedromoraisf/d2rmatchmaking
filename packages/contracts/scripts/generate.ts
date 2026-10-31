// Writes the contract documents to packages/contracts/asyncapi.json and the agent JSON Schemas to
// packages/contracts/json-schema/. Run by `pnpm contracts:openapi`. openapi.json is written by the API from its routes
// (apps/api/src/main/openapi.ts), so the two generators never write the same file. The output is deterministic (no
// timestamps), so regenerating with no change leaves no diff (HF-04).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAsyncApiDocument, buildJsonSchemaFiles } from '../src/documents.ts';

const serialize = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;

writeFileSync(
  fileURLToPath(new URL('../asyncapi.json', import.meta.url)),
  serialize(buildAsyncApiDocument()),
);

const schemaDirectory = fileURLToPath(new URL('../json-schema/', import.meta.url));
mkdirSync(schemaDirectory, { recursive: true });
for (const [fileName, schema] of Object.entries(buildJsonSchemaFiles())) {
  writeFileSync(`${schemaDirectory}${fileName}`, serialize(schema));
}
