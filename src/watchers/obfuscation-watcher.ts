import { randomUUID } from 'crypto';
import type { WatcherStrategy, Gate, ObservationContext, Observation, Signal } from '../types.js';

// Zero-width and invisible characters used to hide instructions from human reviewers
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/;

// Bidirectional override characters — used to visually flip text direction
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200F\u200E]/;

// Unicode tag block — sometimes abused to encode hidden payloads
const TAG_CHARS = /[\uE0001-\uE007F]/;

// Cyrillic/Greek homoglyphs that look identical to Latin letters
const HOMOGLYPH_MAP: Array<[RegExp, string]> = [
  [/[\u0430\u0435\u043E\u0440\u0441\u0445\u0440]/g, 'a/e/o/p/c/x/p'], // Cyrillic
  [/[\u03B1\u03B2\u03B5]/g, 'α/β/ε'],                                   // Greek
];

// Detects if a string mixes Latin with Cyrillic or Greek (common in homoglyph attacks)
function hasMixedScripts(text: string): boolean {
  const hasLatin = /[a-zA-Z]/.test(text);
  const hasCyrillic = /[\u0400-\u04FF]/.test(text);
  const hasGreek = /[\u0370-\u03FF]/.test(text);
  return hasLatin && (hasCyrillic || hasGreek);
}

// Detects suspiciously dense base64-like encoding (possible encoded payload)
function hasEncodedPayload(text: string): boolean {
  const b64 = /[A-Za-z0-9+/]{40,}={0,2}/g;
  const matches = text.match(b64) ?? [];
  return matches.length > 0;
}

export class ObfuscationWatcher implements WatcherStrategy {
  readonly name = 'obfuscation-watcher';
  readonly supportedGates: Gate[] = ['context', 'memory'];

  observe(content: string, ctx: ObservationContext): Observation | null {
    const signals: Signal[] = [];

    if (ZERO_WIDTH.test(content)) {
      signals.push({ type: 'obfuscation', confidence: 0.9, evidence: 'zero-width characters detected' });
    }

    if (BIDI.test(content)) {
      signals.push({ type: 'obfuscation', confidence: 0.95, evidence: 'bidirectional override characters detected' });
    }

    if (TAG_CHARS.test(content)) {
      signals.push({ type: 'obfuscation', confidence: 0.9, evidence: 'Unicode tag characters detected' });
    }

    if (hasMixedScripts(content)) {
      signals.push({ type: 'obfuscation', confidence: 0.8, evidence: 'mixed scripts (Latin + Cyrillic/Greek)' });
    }

    if (hasEncodedPayload(content)) {
      signals.push({ type: 'obfuscation', confidence: 0.65, evidence: 'dense base64-like encoding' });
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
