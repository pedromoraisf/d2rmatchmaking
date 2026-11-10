// Preloaded with `node --import` by gate-startup.test.mjs: registers the trace hook for the gate's own imports.
import { register } from 'node:module';

register('./module-trace.mjs', import.meta.url);
