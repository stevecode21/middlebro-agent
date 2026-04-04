import { randomUUID } from 'crypto';
import type {
  WatcherStrategy,
  Gate,
  ObservationContext,
  Observation,
  Signal,
} from '../types.js';

// Zero-width and invisible characters used to hide instructions from human reviewers
function hasZeroWidthChars(text: string): boolean {
  const codepoints = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && codepoints.has(cp)) {
      return true;
    }
  }
  return false;
}

// Bidirectional override characters — used to visually flip text direction
function hasBidiChars(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const inRloRange = cp >= 0x202a && cp <= 0x202e;
    const inIsolateRange = cp >= 0x2066 && cp <= 0x2069;
    if (inRloRange || inIsolateRange || cp === 0x200f || cp === 0x200e) {
      return true;
    }
  }
  return false;
}

// Unicode tag block — sometimes abused to encode hidden payloads
function hasUnicodeTagChars(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp >= 0xe0001 && cp <= 0xe007f) {
      return true;
    }
  }
  return false;
}

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

    if (hasZeroWidthChars(content)) {
      signals.push({
        type: 'obfuscation',
        confidence: 0.9,
        evidence: 'zero-width characters detected',
      });
    }

    if (hasBidiChars(content)) {
      signals.push({
        type: 'obfuscation',
        confidence: 0.95,
        evidence: 'bidirectional override characters detected',
      });
    }

    if (hasUnicodeTagChars(content)) {
      signals.push({
        type: 'obfuscation',
        confidence: 0.9,
        evidence: 'Unicode tag characters detected',
      });
    }

    if (hasMixedScripts(content)) {
      signals.push({
        type: 'obfuscation',
        confidence: 0.8,
        evidence: 'mixed scripts (Latin + Cyrillic/Greek)',
      });
    }

    if (hasEncodedPayload(content)) {
      signals.push({
        type: 'obfuscation',
        confidence: 0.65,
        evidence: 'dense base64-like encoding',
      });
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
