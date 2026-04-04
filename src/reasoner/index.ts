import { SYSTEM_PROMPT } from './prompt.js';
import {
  parseProviderOutput,
  createProvider,
  type LLMProvider,
  type ProviderFactoryOptions,
} from './provider.js';
import type { ReasonerInput, ReasonerVerdict } from '../types.js';

// Confidence threshold below which we skip the LLM call and pass directly.
// Keeps costs/latency low for clean traffic.
const REASONER_THRESHOLD = 0.6;

export interface ReasonerOptions extends ProviderFactoryOptions {
  /** Inject a custom provider directly (for testing or advanced config) */
  customProvider?: LLMProvider;
}

export class Reasoner {
  private provider: LLMProvider;

  constructor(opts: ReasonerOptions = {}) {
    this.provider = opts.customProvider ?? createProvider(opts);
  }

  get providerName(): string {
    return this.provider.name;
  }

  // Returns null if watcher confidence is below threshold (skip LLM call).
  async analyze(input: ReasonerInput): Promise<ReasonerVerdict | null> {
    const maxConfidence = Math.max(
      ...input.signals.map((s) => s.confidence),
      0,
    );

    if (maxConfidence < REASONER_THRESHOLD) {
      return null; // nothing suspicious enough to spend an LLM call on
    }

    const userMessage = this.buildPrompt(input);
    const raw = await this.provider.complete(SYSTEM_PROMPT, userMessage);
    const verdict = parseProviderOutput(raw);

    return {
      threat: verdict.threat,
      confidence: verdict.confidence,
      action: verdict.action,
      reasoning: verdict.reasoning,
      ...(verdict.threatType ? { threatType: verdict.threatType } : {}),
    };
  }

  private buildPrompt(input: ReasonerInput): string {
    const signalLines = input.signals
      .map(
        (s) =>
          `  - [${s.type}] confidence=${s.confidence.toFixed(2)}  evidence="${s.evidence}"`,
      )
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
