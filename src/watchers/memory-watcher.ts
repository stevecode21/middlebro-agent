import { randomUUID } from 'crypto';
import type {
  WatcherStrategy,
  Gate,
  ObservationContext,
  Observation,
  Signal,
} from '../types.js';

// Patterns targeting persistent agent state — instructions designed to survive across sessions.
// Ported and extended from ClawMoat's memory-poison scanner.
const MEMORY_PATTERNS: Array<{ re: RegExp; confidence: number }> = [
  // Explicit memory file manipulation
  {
    re: /(?:add|write|append|update|modify)\s+(?:this\s+)?(?:to|in)\s+(?:your\s+)?(?:memory|MEMORY\.md)/i,
    confidence: 0.95,
  },

  // Persistent behavior instructions
  {
    re: /\b(?:always|forever|permanently|from\s+now\s+on)\s+(?:remember|keep|maintain|follow|ignore|never)/i,
    confidence: 0.9,
  },
  {
    re: /\bnever\s+(?:again\s+)?(?:mention|say|tell|reveal|share)\b/i,
    confidence: 0.85,
  },

  // Time-bomb patterns — instructions that activate later
  {
    re: /(?:next\s+time|when\s+you\s+(?:next\s+)?see|the\s+next\s+(?:time|message|request))\s+.{0,60}(?:do|execute|run|say|respond)/i,
    confidence: 0.85,
  },
  {
    re: /(?:if|when)\s+(?:anyone|the\s+user|someone)\s+asks?\s+(?:about|for)\s+.{0,60}(?:say|tell|respond|deny|claim)/i,
    confidence: 0.8,
  },

  // Identity/personality override
  {
    re: /\b(?:update|change|modify|replace)\s+(?:your\s+)?(?:personality|identity|core\s+values?|rules?|guidelines?)/i,
    confidence: 0.9,
  },

  // Config file targeting
  {
    re: /\b(?:edit|modify|update|overwrite)\s+(?:the\s+)?(?:AGENTS?|TOOLS?|HEARTBEAT|CLAUDE|system\s+prompt)\.(?:md|txt|json)/i,
    confidence: 0.9,
  },
];

export class MemoryWatcher implements WatcherStrategy {
  readonly name = 'memory-watcher';
  readonly supportedGates: Gate[] = ['memory', 'context'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const signals: Signal[] = [];

    for (const { re, confidence } of MEMORY_PATTERNS) {
      const match = re.exec(content);
      if (match) {
        signals.push({
          type: 'memory_poison',
          confidence,
          evidence: match[0].slice(0, 80),
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
