// The error sink of the platform (OBS-26): the outbox relay and the stream hub report their failures through it, so each
// line goes through the application logger with its trace fields and through the log export. The composition root
// passes the Fastify logger; the platform never writes to the console itself.
export interface ErrorLog {
  error(message: string): void;
}
