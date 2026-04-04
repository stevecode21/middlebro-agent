import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompt.js';
import type { RawVerdict } from './schema.js';

// ─── Provider Interface ────────────────────────────────────────────────────────

/**
 * A LLMProvider wraps a concrete model and handles the raw chat completion call.
 * Implement this to swap in Claude, Groq, Mistral, or any OpenAI-compatible API.
 */
export interface LLMProvider {
  readonly name: string;
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

// ─── OpenAI Provider (default) ────────────────────────────────────────────────

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  /** Override to point at any OpenAI-compatible endpoint (Groq, Together, vLLM…) */
  baseURL?: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.model = opts.model ?? 'gpt-4o-mini';
    this.name = `openai/${this.model}`;
    this.client = new OpenAI({
      // OpenAI SDK requires apiKey to be present even for local OpenAI-compatible APIs.
      apiKey: opts.apiKey ?? process.env['OPENAI_API_KEY'] ?? 'test-key',
      baseURL: opts.baseURL ?? process.env['OPENAI_API_URL'],
    });
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content ?? '{}';
  }
}

// ─── Anthropic-compatible Provider (via OpenAI SDK compat layer) ───────────────
// Works when routing through a proxy or using Anthropic's OpenAI-compat endpoint.

export interface AnthropicCompatProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export class AnthropicCompatProvider implements LLMProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;

  constructor(opts: AnthropicCompatProviderOptions = {}) {
    this.model = opts.model ?? 'claude-3-5-haiku-20241022';
    this.name = `anthropic-compat/${this.model}`;
    this.client = new OpenAI({
      apiKey: opts.apiKey ?? process.env['ANTHROPIC_API_KEY'],
      baseURL: opts.baseURL ?? 'https://api.anthropic.com/v1',
      defaultHeaders: { 'anthropic-version': '2023-06-01' },
    });
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content ?? '{}';
  }
}

// ─── Groq Provider ────────────────────────────────────────────────────────────
// Groq is fully OpenAI-compatible — just a different baseURL + key.

export interface GroqProviderOptions {
  apiKey?: string;
  /** Default: llama-3.1-8b-instant (ultra-fast, low cost) */
  model?: string;
}

export class GroqProvider implements LLMProvider {
  readonly name: string;
  private inner: OpenAIProvider;

  constructor(opts: GroqProviderOptions = {}) {
    const model = opts.model ?? 'llama-3.1-8b-instant';
    const apiKey = opts.apiKey ?? process.env['GROQ_API_KEY'];
    this.name = `groq/${model}`;
    this.inner = new OpenAIProvider({
      ...(apiKey ? { apiKey } : {}),
      baseURL: 'https://api.groq.com/openai/v1',
      model,
    });
  }

  complete(systemPrompt: string, userMessage: string): Promise<string> {
    return this.inner.complete(systemPrompt, userMessage);
  }
}

// ─── Parse raw LLM output into a typed RawVerdict ────────────────────────────

import type { InterventionType, ThreatType } from '../types.js';

const VALID_ACTIONS = new Set<InterventionType>([
  'pass',
  'sanitize',
  'alert',
  'block',
  'terminate',
  'quarantine',
  'redirect',
]);

const VALID_THREAT_TYPES = new Set<ThreatType>([
  'prompt_injection',
  'indirect_injection',
  'context_poisoning',
  'memory_poison',
  'jailbreak',
  'obfuscation',
]);

export function parseProviderOutput(raw: string): RawVerdict {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      threat: false,
      confidence: 0,
      action: 'alert',
      reasoning: 'Reasoner returned unparseable output.',
      threatType: null,
    };
  }

  const action: InterventionType = VALID_ACTIONS.has(
    parsed['action'] as InterventionType,
  )
    ? (parsed['action'] as InterventionType)
    : 'alert';

  const rawThreatType = parsed['threatType'];
  const threatType: ThreatType | null =
    rawThreatType !== null &&
    VALID_THREAT_TYPES.has(rawThreatType as ThreatType)
      ? (rawThreatType as ThreatType)
      : null;

  return {
    threat: Boolean(parsed['threat']),
    confidence:
      typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0,
    action,
    reasoning:
      typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] : '',
    threatType,
  };
}

// ─── Factory: create provider from env or explicit config ─────────────────────

export type ProviderName = 'openai' | 'anthropic' | 'groq';

export interface ProviderFactoryOptions {
  provider?: ProviderName;
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export function createProvider(opts: ProviderFactoryOptions = {}): LLMProvider {
  const name =
    opts.provider ??
    (process.env['MIDDLEBRO_PROVIDER'] as ProviderName) ??
    'openai';
  const model = opts.model ?? process.env['MIDDLEBRO_MODEL'];
  const apiKey = opts.apiKey ?? process.env['MIDDLEBRO_API_KEY'];
  const baseURL = opts.baseURL ?? process.env['MIDDLEBRO_BASE_URL'];

  switch (name) {
    case 'anthropic':
      return new AnthropicCompatProvider({
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
    case 'groq':
      return new GroqProvider({
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
    case 'openai':
    default:
      return new OpenAIProvider({
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
  }
}

export { SYSTEM_PROMPT };
