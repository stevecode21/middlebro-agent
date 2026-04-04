import type { InterventionType, ThreatType } from '../types.js';

// ─── Reasoner Verdict — The structured response from Middlebro's brain ─────────

export interface RawVerdict {
  /** true if this is a genuine security threat */
  threat: boolean;
  /** 0.0–1.0 confidence in the verdict */
  confidence: number;
  /** What Middlebro should do: pass | sanitize | alert | block | terminate | quarantine | redirect */
  action: InterventionType;
  /** 1–2 sentence human-readable explanation */
  reasoning: string;
  /** threat classification, null if no threat */
  threatType: ThreatType | null;
}

/**
 * JSON Schema for providers that accept schema-constrained generation
 * (e.g. OpenAI response_format: json_schema, Groq structured output).
 */
export const VERDICT_JSON_SCHEMA = {
  name: 'middlebro_verdict',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      threat: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      action: {
        type: 'string',
        enum: ['pass', 'sanitize', 'alert', 'block', 'terminate', 'quarantine', 'redirect'],
      },
      reasoning: { type: 'string' },
      threatType: {
        oneOf: [
          {
            type: 'string',
            enum: [
              'prompt_injection',
              'indirect_injection',
              'context_poisoning',
              'memory_poison',
              'jailbreak',
              'obfuscation',
            ],
          },
          { type: 'null' },
        ],
      },
    },
    required: ['threat', 'confidence', 'action', 'reasoning', 'threatType'],
    additionalProperties: false,
  },
} as const;
