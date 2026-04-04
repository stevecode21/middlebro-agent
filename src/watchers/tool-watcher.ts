import { randomUUID } from 'crypto';
import type { WatcherStrategy, Gate, ObservationContext, Observation, Signal } from '../types.js';

// Dangerous argument patterns for common agent tools.
// Each entry targets a specific tool by name and checks its args.
interface ToolRule {
  tool: string | RegExp;
  argKey: string;
  pattern: RegExp;
  confidence: number;
  label: string;
}

const TOOL_RULES: ToolRule[] = [
  // Shell / exec tools
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /rm\s+(-[rf]+\s+)*[\/~]/, confidence: 0.95, label: 'recursive force delete' },
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /curl\s+[^|]*\|\s*(ba)?sh/, confidence: 0.95, label: 'curl pipe to shell' },
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /:\(\)\s*\{.*\}\s*;?\s*:/, confidence: 1.0, label: 'fork bomb' },
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /\bsudo\b/, confidence: 0.8, label: 'privilege escalation' },
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /\/etc\/shadow/, confidence: 0.95, label: 'shadow file access' },
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /~\/\.ssh\//, confidence: 0.9, label: 'SSH key access' },
  { tool: /exec|shell|bash|run_command|terminal/i, argKey: 'command', pattern: /~\/\.aws\//, confidence: 0.9, label: 'AWS credential access' },

  // File tools
  { tool: /write_file|file_write|create_file/i, argKey: 'path', pattern: /\/etc\/|\/usr\/|\/bin\/|\/sbin\//, confidence: 0.85, label: 'write to system directory' },
  { tool: /read_file|file_read/i, argKey: 'path', pattern: /~\/\.ssh\/|~\/\.aws\/|\.env$/, confidence: 0.9, label: 'credential file read' },

  // Browser / HTTP tools
  { tool: /browser|fetch|http_request|web_request/i, argKey: 'url', pattern: /(?:pastebin|hastebin|0x0\.st|transfer\.sh)/, confidence: 0.8, label: 'paste service exfil' },
];

export class ToolWatcher implements WatcherStrategy {
  readonly name = 'tool-watcher';
  readonly supportedGates: Gate[] = ['tool'];

  // ToolWatcher receives tool call as JSON-stringified args in `content`
  // Convention: content = JSON.stringify({ toolName, args })
  observe(content: string, ctx: ObservationContext): Observation | null {
    let parsed: { toolName: string; args: Record<string, string> };
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }

    const { toolName, args } = parsed;
    if (!toolName || !args) return null;

    const signals: Signal[] = [];

    for (const rule of TOOL_RULES) {
      const toolMatches =
        typeof rule.tool === 'string'
          ? toolName === rule.tool
          : rule.tool.test(toolName);

      if (!toolMatches) continue;

      const argValue = args[rule.argKey];
      if (!argValue) continue;

      if (rule.pattern.test(argValue)) {
        signals.push({
          type: 'prompt_injection', // tool abuse is surfaced as injection threat
          confidence: rule.confidence,
          evidence: `${toolName}.${rule.argKey}: ${rule.label}`,
        });
      }
    }

    if (signals.length === 0) return null;

    return {
      id: randomUUID(),
      gate: ctx.gate,
      watcher: this.name,
      source: ctx.source,
      signals,
      timestamp: Date.now(),
      turn: ctx.session.turnCount,
    };
  }
}
