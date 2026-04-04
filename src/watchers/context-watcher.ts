import { randomUUID } from 'crypto';
import type { WatcherStrategy, Gate, ObservationContext, Observation, Signal } from '../types.js';

// Patterns covering direct prompt injection, indirect injection via tool/retrieval output,
// and RAG context poisoning. Ported and extended from ClawMoat's prompt-injection scanner.
const INJECTION_PATTERNS: Array<{ re: RegExp; confidence: number; label: string }> = [
  // Instruction overrides
  { re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i, confidence: 0.95, label: 'instruction override' },
  { re: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i, confidence: 0.95, label: 'instruction disregard' },
  { re: /forget\s+(everything|all|what)\s+(you\s+)?(were\s+)?(told|instructed|said)/i, confidence: 0.9, label: 'forget instructions' },
  { re: /override\s+(your\s+)?(instructions?|rules?|guidelines?|constraints?)/i, confidence: 0.9, label: 'override instructions' },

  // System prompt extraction
  { re: /repeat\s+(your\s+)?(system\s+prompt|instructions?|prompt)/i, confidence: 0.85, label: 'system prompt extraction' },
  { re: /show\s+(me\s+)?(your\s+)?(system\s+prompt|initial\s+instructions?)/i, confidence: 0.85, label: 'system prompt leak' },
  { re: /what\s+(are|were)\s+your\s+(original\s+)?instructions?/i, confidence: 0.75, label: 'instructions probe' },

  // Indirect injection signals (in retrieved content / tool output)
  { re: /\[SYSTEM\]:/i, confidence: 0.9, label: 'fake system tag' },
  { re: /\[INST\]/i, confidence: 0.85, label: 'instruction delimiter' },
  { re: /<<SYS>>/i, confidence: 0.9, label: 'sys delimiter' },
  { re: /```\s*system\b/i, confidence: 0.85, label: 'markdown system block' },
  { re: /<\|im_start\|>\s*system/i, confidence: 0.9, label: 'ChatML system tag' },

  // Role manipulation
  { re: /you\s+are\s+now\s+(?:a|an)\s+/i, confidence: 0.8, label: 'role replacement' },
  { re: /act\s+as\s+(if\s+you\s+(are|were)\s+)?(?:a|an)\s+/i, confidence: 0.75, label: 'act as' },
  { re: /pretend\s+(you\s+are|to\s+be)\s+/i, confidence: 0.75, label: 'pretend persona' },

  // RAG / context poisoning signals
  { re: /(?:the\s+following\s+is\s+)?a\s+new\s+(instruction|directive|command)\s+from/i, confidence: 0.85, label: 'injected directive' },
  { re: /\bHIDDEN\s+INSTRUCTION\b/i, confidence: 0.95, label: 'hidden instruction marker' },
  { re: /\bdo\s+not\s+(?:tell|inform|reveal|mention)\s+(the\s+)?user/i, confidence: 0.9, label: 'concealment directive' },
];

export class ContextWatcher implements WatcherStrategy {
  readonly name = 'context-watcher';
  readonly supportedGates: Gate[] = ['context'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const signals: Signal[] = [];

    for (const { re, confidence, label } of INJECTION_PATTERNS) {
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
