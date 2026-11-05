// The one error handler of the HTTP surface (design.md § Error Handling). It lives in the platform so the composition root and
// the relay's tests answer errors the same way.
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/** A database failure answers 503 `unavailable` (design.md § Error Handling). Driver errors carry a code or a pool message. */
export function isDatabaseFailure(error: FastifyError): boolean {
  const code: unknown = error.code;
  const driverCode = typeof code === 'string' && !code.startsWith('FST_');
  return driverCode || /pool|connect/i.test(error.message);
}

/** Maps every error to the contract's `{ error }` body. Messages are never sent: they can echo values (codes, names). */
export function answerError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const fields = [...new Set((error.validation ?? []).map((issue) => issue.instancePath.slice(1)))];
    return reply.code(400).send({ error: 'invalid-request', fields });
  }
  const status = error.statusCode ?? 500;
  if (status < 500) {
    const code =
      status === 413
        ? 'payload-too-large'
        : status === 415
          ? 'unsupported-media-type'
          : status === 429
            ? 'rate-limited'
            : 'invalid-request';
    return reply.code(status).send({ error: code });
  }
  request.log.warn({ errorName: error.name, errorCode: error.code }, 'request failed');
  if (isDatabaseFailure(error)) {
    return reply.code(503).send({ error: 'unavailable' });
  }
  return reply.code(500).send({ error: 'internal' });
}
