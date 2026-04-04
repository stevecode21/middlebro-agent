import type { GateResult } from '../types.js';
import type { MiddlebroSession } from '../session.js';

export class ToolGate {
  constructor(private session: MiddlebroSession) {}

  check(toolName: string, args: Record<string, unknown>): GateResult {
    // Serialize tool call so watchers receive a consistent string
    const content = JSON.stringify({ toolName, args });
    return this.session.processGate('tool', content, 'tool_output');
  }
}
