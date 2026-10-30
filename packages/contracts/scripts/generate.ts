// Writes the contract documents to packages/contracts/{openapi,asyncapi}.json and the agent JSON Schemas to
// packages/contracts/json-schema/. Run by `pnpm contracts:openapi`. The output is deterministic (no timestamps), so
// regenerating with no change leaves no diff (HF-04).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAsyncApiDocument, buildJsonSchemaFiles, buildOpenApiDocument } from '../src/documents.ts';

const serialize = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;

writeFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), serialize(buildOpenApiDocument()));
writeFileSync(
  fileURLToPath(new URL('../asyncapi.json', import.meta.url)),
  serialize(buildAsyncApiDocument()),
);

const schemaDirectory = fileURLToPath(new URL('../json-schema/', import.meta.url));
mkdirSync(schemaDirectory, { recursive: true });
for (const [fileName, schema] of Object.entries(buildJsonSchemaFiles())) {
  writeFileSync(`${schemaDirectory}${fileName}`, serialize(schema));
}
