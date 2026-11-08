// The rule modules that gate.mjs loads only for the calls that need them (GPR-21), passed to the rules as
// `ctx.modules`. The tests load them once here, so each fake context carries the same set the gate passes.
import * as ratchet from '../../../scripts/lib/ratchet.mjs';
import * as acceptance from '../../../scripts/lib/acceptance.mjs';
import * as mutationScope from '../../../scripts/lib/mutation-scope.mjs';
import * as modelPolicy from '../../../scripts/lib/model-policy.mjs';

export const RULE_MODULES = { ratchet, acceptance, mutationScope, modelPolicy };
