import { randomUUID } from 'crypto';
import type {
  WatcherStrategy,
  Gate,
  ObservationContext,
  Observation,
  Signal,
} from '../types.js';

const JAILBREAK_PATTERNS: Array<{ re: RegExp; confidence: number }> = [
  // DAN and named jailbreak variants
  { re: /\bDAN\b.*(?:do\s+anything\s+now|jailbreak)/i, confidence: 0.95 },
  {
    re: /\b(?:DAN|STAN|DUDE|AIM|KEVIN)\s+(?:mode|prompt|jailbreak|persona)/i,
    confidence: 0.9,
  },

  // Developer / debug mode exploits
  {
    re: /(?:enable|enter|activate|switch\s+to)\s+(?:developer|debug|maintenance|god|unrestricted|jailbreak)\s+mode/i,
    confidence: 0.9,
  },
  {
    re: /(?:enabl(?:e|ing)|turn(?:ing)?\s+on)\s+(?:developer|dev|debug)\s+mode/i,
    confidence: 0.9,
  },
  {
    re: /\[(?:DEV|DEVELOPER)\s*MODE\s*ON\]/i,
    confidence: 0.9,
  },

  // Safety filter bypass framing
  {
    re: /(?:safety|content|ethical|moral)\s+(?:filters?|restrictions?|guidelines?|rules?)\s+(?:removed|disabled|off|bypassed|don.t\s+apply)/i,
    confidence: 0.9,
  },
  {
    re: /(?:for\s+)?(?:research|educational|hypothetical|fictional|creative\s+writing)\s+purposes?\s+only/i,
    confidence: 0.6,
  },

  // "Hypothetical" / "imagine" bypass
  {
    re: /(?:hypothetically|theoretically|in\s+a\s+fictional\s+world)\s+(?:how\s+would|could\s+you|if\s+you)/i,
    confidence: 0.75,
  },

  // Dual persona / split-brain attacks
  {
    re: /(?:respond|answer)\s+as\s+(?:both|two)\s+(?:characters?|personas?|selves?|versions?)/i,
    confidence: 0.85,
  },
  {
    re: /your\s+(?:evil|unfiltered|uncensored|shadow|true|real)\s+(?:self|twin|side|persona)/i,
    confidence: 0.9,
  },

  // Completion / token injection attacks
  {
    re: /(?:continue|complete|finish)\s+(?:this|the\s+following)\s+(?:sentence|prompt|text|code)\s*:/i,
    confidence: 0.7,
  },

  // Token smuggling via encoding
  {
    re: /(?:translate|decode|convert|interpret)\s+(?:this\s+)?(?:from\s+)?(?:base64|hex|rot13|binary|morse)/i,
    confidence: 0.8,
  },
];

export class JailbreakWatcher implements WatcherStrategy {
  readonly name = 'jailbreak-watcher';
  readonly supportedGates: Gate[] = ['context'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const signals: Signal[] = [];

    for (const { re, confidence } of JAILBREAK_PATTERNS) {
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
