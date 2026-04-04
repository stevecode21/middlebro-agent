import { randomUUID } from 'crypto';
import type { WatcherStrategy, Gate, ObservationContext, Observation, Signal } from '../types.js';

const JAILBREAK_PATTERNS: Array<{ re: RegExp; confidence: number; label: string }> = [
  // DAN and named jailbreak variants
  { re: /\bDAN\b.*(?:do\s+anything\s+now|jailbreak)/i, confidence: 0.95, label: 'DAN jailbreak' },
  { re: /\b(?:DAN|STAN|DUDE|AIM|KEVIN)\s+(?:mode|prompt|jailbreak|persona)/i, confidence: 0.9, label: 'named jailbreak variant' },

  // Developer / debug mode exploits
  { re: /(?:enable|enter|activate|switch\s+to)\s+(?:developer|debug|maintenance|god|unrestricted|jailbreak)\s+mode/i, confidence: 0.9, label: 'debug mode activation' },

  // Safety filter bypass framing
  { re: /(?:safety|content|ethical|moral)\s+(?:filters?|restrictions?|guidelines?|rules?)\s+(?:removed|disabled|off|bypassed|don.t\s+apply)/i, confidence: 0.9, label: 'safety bypass framing' },
  { re: /(?:for\s+)?(?:research|educational|hypothetical|fictional|creative\s+writing)\s+purposes?\s+only/i, confidence: 0.6, label: 'fictional framing' },

  // "Hypothetical" / "imagine" bypass
  { re: /(?:hypothetically|theoretically|in\s+a\s+fictional\s+world)\s+(?:how\s+would|could\s+you|if\s+you)/i, confidence: 0.75, label: 'hypothetical bypass' },

  // Dual persona / split-brain attacks
  { re: /(?:respond|answer)\s+as\s+(?:both|two)\s+(?:characters?|personas?|selves?|versions?)/i, confidence: 0.85, label: 'dual persona attack' },
  { re: /your\s+(?:evil|unfiltered|uncensored|shadow|true|real)\s+(?:self|twin|side|persona)/i, confidence: 0.9, label: 'shadow self framing' },

  // Completion / token injection attacks
  { re: /(?:continue|complete|finish)\s+(?:this|the\s+following)\s+(?:sentence|prompt|text|code)\s*:/i, confidence: 0.7, label: 'completion attack' },

  // Token smuggling via encoding
  { re: /(?:translate|decode|convert|interpret)\s+(?:this\s+)?(?:from\s+)?(?:base64|hex|rot13|binary|morse)/i, confidence: 0.8, label: 'encoding smuggling' },
];

export class JailbreakWatcher implements WatcherStrategy {
  readonly name = 'jailbreak-watcher';
  readonly supportedGates: Gate[] = ['context'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const signals: Signal[] = [];

    for (const { re, confidence, label } of JAILBREAK_PATTERNS) {
      const match = re.exec(content);
      if (match) {
        signals.push({
          type: 'jailbreak',
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
