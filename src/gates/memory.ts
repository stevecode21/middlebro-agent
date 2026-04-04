import type { GateResult } from '../types.js';
import type { MiddlebroSession } from '../session.js';

export class MemoryGate {
  constructor(private session: MiddlebroSession) {}

  check(content: string): GateResult {
    return this.session.processGate('memory', content, 'user_message');
  }
}
