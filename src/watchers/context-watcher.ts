import { randomUUID } from 'crypto';
import type {
  WatcherStrategy,
  Gate,
  ObservationContext,
  Observation,
  Signal,
} from '../types.js';

// Patterns covering direct prompt injection, indirect injection via tool/retrieval output,
// and RAG context poisoning. Ported and extended from ClawMoat's prompt-injection scanner.
const INJECTION_PATTERNS: Array<{ re: RegExp; confidence: number }> = [
  // Instruction overrides
  {
    re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    confidence: 0.95,
  },
  {
    re: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    confidence: 0.95,
  },
  {
    re: /forget\s+(everything|all|what)\s+(you\s+)?(were\s+)?(told|instructed|said)/i,
    confidence: 0.9,
  },
  {
    re: /override\s+(your\s+)?(instructions?|rules?|guidelines?|constraints?)/i,
    confidence: 0.9,
  },

  // System prompt extraction
  {
    re: /repeat\s+(your\s+)?(system\s+prompt|instructions?|prompt)/i,
    confidence: 0.85,
  },
  {
    re: /show\s+(me\s+)?(your\s+)?(system\s+prompt|initial\s+instructions?)/i,
    confidence: 0.85,
  },
  {
    re: /what\s+(are|were)\s+your\s+(original\s+)?instructions?/i,
    confidence: 0.75,
  },

  // Indirect injection signals (in retrieved content / tool output)
  { re: /\[SYSTEM\]:/i, confidence: 0.9 },
  { re: /\[INST\]/i, confidence: 0.85 },
  { re: /<<SYS>>/i, confidence: 0.9 },
  { re: /```\s*system\b/i, confidence: 0.85 },
  { re: /<\|im_start\|>\s*system/i, confidence: 0.9 },

  // Role manipulation
  { re: /you\s+are\s+now\s+(?:a|an)\s+/i, confidence: 0.8 },
  {
    re: /act\s+as\s+(if\s+you\s+(are|were)\s+)?(?:a|an)\s+/i,
    confidence: 0.75,
  },
  { re: /pretend\s+(you\s+are|to\s+be)\s+/i, confidence: 0.75 },

  // RAG / context poisoning signals
  {
    re: /(?:the\s+following\s+is\s+)?a\s+new\s+(instruction|directive|command)\s+from/i,
    confidence: 0.85,
  },
  { re: /\bHIDDEN\s+INSTRUCTION\b/i, confidence: 0.95 },
  {
    re: /\bdo\s+not\s+(?:tell|inform|reveal|mention)\s+(the\s+)?user/i,
    confidence: 0.9,
  },
  {
    re: /\bdo\s+not\s+(?:tell|inform|reveal|mention)\b.{0,120}\b(?:to|for)\s+the\s+user\b/i,
    confidence: 0.9,
  },
];

export class ContextWatcher implements WatcherStrategy {
  readonly name = 'context-watcher';
  readonly supportedGates: Gate[] = ['context'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const signals: Signal[] = [];

    for (const { re, confidence } of INJECTION_PATTERNS) {
      const match = re.exec(content);
      if (match) {
        // Boost confidence for higher-risk sources
        const adjustedConfidence =
          ctx.source === 'tool_output' || ctx.source === 'retrieval'
            ? Math.min(confidence + 0.05, 1)
            : confidence;

        signals.push({
          type: 'prompt_injection',
          confidence: adjustedConfidence,
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
