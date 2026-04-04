import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompt.js';
import type { ReasonerInput, ReasonerVerdict, InterventionType, ThreatType } from '../types.js';

// Confidence threshold below which we skip the LLM call and pass directly.
// Keeps costs/latency low for clean traffic.
const REASONER_THRESHOLD = 0.6;

const VALID_ACTIONS = new Set<InterventionType>([
  'pass', 'sanitize', 'alert', 'block', 'terminate', 'quarantine', 'redirect',
]);

const VALID_THREAT_TYPES = new Set<ThreatType>([
  'prompt_injection', 'indirect_injection', 'context_poisoning',
  'memory_poison', 'jailbreak', 'obfuscation',
]);

function parseVerdict(raw: string): ReasonerVerdict {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON from model — default to alert so a human reviews
    return { threat: false, confidence: 0, action: 'alert', reasoning: 'Reasoner returned unparseable output.' };
  }

  const action = VALID_ACTIONS.has(parsed['action'] as InterventionType)
    ? (parsed['action'] as InterventionType)
    : 'alert';

  const threatType = VALID_THREAT_TYPES.has(parsed['threatType'] as ThreatType)
    ? (parsed['threatType'] as ThreatType)
    : undefined;

  return {
    threat:     Boolean(parsed['threat']),
    confidence: typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0,
    action,
    reasoning:  typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] : '',
    ...(threatType ? { threatType } : {}),
  };
}

export class Reasoner {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
    this.model = model;
  }

  // Returns null if watcher confidence is below threshold (skip LLM call).
  async analyze(input: ReasonerInput): Promise<ReasonerVerdict | null> {
    const maxConfidence = Math.max(...input.signals.map(s => s.confidence), 0);

    if (maxConfidence < REASONER_THRESHOLD) {
      return null; // nothing suspicious enough to spend an LLM call on
    }

    const userMessage = this.buildPrompt(input);

    const response = await this.client.chat.completions.create({
      model:           this.model,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return parseVerdict(content);
  }

  private buildPrompt(input: ReasonerInput): string {
    const signalLines = input.signals
      .map(s => `  - [${s.type}] confidence=${s.confidence.toFixed(2)}  evidence="${s.evidence}"`)
      .join('\n');

    return `
EVENT TYPE: ${input.eventType}

INTERCEPTED CONTENT:
${input.content.slice(0, 2000)}${input.content.length > 2000 ? '\n[truncated]' : ''}

WATCHER SIGNALS:
${signalLines || '  (none)'}

SESSION HISTORY:
${input.sessionSummary || '  (first event in session)'}
`.trim();
  }
}
