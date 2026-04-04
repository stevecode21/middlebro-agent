import type { SourceContext, GateResult } from '../types.js';
import type { MiddlebroSession } from '../session.js';

export class ContextGate {
  constructor(private session: MiddlebroSession) {}

  check(content: string, opts: { from: SourceContext }): GateResult {
    return this.session.processGate('context', content, opts.from);
  }
}
