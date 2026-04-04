/**
 * ResponseInterceptor — scans LLM responses before returning them to the agent.
 *
 * Why this matters:
 *  - A compromised LLM could return tool calls that execute malicious commands
 *  - Responses can carry injected content from poisoned context that "passed" the request scan
 *  - Assistant messages become part of the context window — poisoned history compounds
 *
 * For streaming responses we can't buffer indefinitely, so we only scan non-streaming.
 * Streaming interception (chunked SSE) is a Phase 1.5 enhancement.
 */

import type { OpenAIMessage, InterceptResult, Signal } from '../types.js';
import type { MiddlebroSession } from '../session.js';
import type { Reasoner } from '../reasoner/index.js';

// ─── Tool call heuristics ─────────────────────────────────────────────────────
// Flags tool calls that follow suspicious patterns: data exfiltration,
// self-modification attempts, or commands injected via previous context poisoning.

const DANGEROUS_TOOL_PATTERNS: Array<{ re: RegExp; confidence: number }> = [
  { re: /curl\s+https?:\/\//i, confidence: 0.85 },
  { re: /wget\s+https?:\/\//i, confidence: 0.85 },
  { re: /\|\s*sh\b|\|\s*bash\b/i, confidence: 0.9 },
  { re: /base64\s+-d/i, confidence: 0.8 },
  { re: /eval\s*\(/i, confidence: 0.75 },
  { re: /rm\s+-rf\s+\//i, confidence: 0.95 },
  { re: /\bexfiltrat/i, confidence: 0.88 },
  { re: /~\/\.ssh|~\/\.aws|\/etc\/passwd|\/etc\/shadow/i, confidence: 0.9 },
  { re: /IGNORE\s+PREVIOUS\s+INSTRUCTIONS/i, confidence: 0.95 },
];

// ─── Response content heuristics ─────────────────────────────────────────────
// Detects injected instructions that slipped through context and are now
// being echoed back in the assistant's response (a sign the agent was fooled).

const RESPONSE_INJECTION_PATTERNS: Array<{ re: RegExp; confidence: number }> = [
  {
    re: /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/i,
    confidence: 0.9,
  },
  { re: /\[SYSTEM\]:/i, confidence: 0.85 },
  { re: /you\s+are\s+now\s+(?:a|an)\s+/i, confidence: 0.8 },
  { re: /do\s+not\s+(?:tell|reveal|mention)\s+the\s+user/i, confidence: 0.9 },
  { re: /HIDDEN\s+INSTRUCTION/i, confidence: 0.95 },
];

function extractToolCallText(msg: OpenAIMessage): string {
  const parts: string[] = [];
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      parts.push(`[tool: ${tc.function.name}] args: ${tc.function.arguments}`);
    }
  }
  if (typeof msg.content === 'string' && msg.content.length > 0) {
    parts.push(msg.content);
  }
  return parts.join('\n');
}

function scanForSignals(text: string): Signal[] {
  const signals: Signal[] = [];

  // Scan tool call patterns
  for (const { re, confidence } of DANGEROUS_TOOL_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      signals.push({
        type: 'indirect_injection',
        confidence,
        evidence: match[0].slice(0, 80),
      });
    }
  }

  // Scan response content for injection echoes
  for (const { re, confidence } of RESPONSE_INJECTION_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      signals.push({
        type: 'context_poisoning',
        confidence,
        evidence: match[0].slice(0, 80),
      });
    }
  }

  return signals;
}

function buildSessionSummary(session: MiddlebroSession): string {
  const recent = session.state.timeline.slice(-8);
  if (recent.length === 0) return '';
  return recent
    .map((obs) => {
      const signals = obs.signals
        .map((s) => `${s.type}(${s.confidence.toFixed(2)})`)
        .join(', ');
      return `[turn ${obs.turn}] gate=${obs.gate} source=${obs.source} signals=[${signals || 'none'}]`;
    })
    .join('\n');
}

export class ResponseInterceptor {
  private reasoner: Reasoner;

  constructor(reasoner: Reasoner) {
    this.reasoner = reasoner;
  }

  /**
   * Check a raw LLM response body.
   * Returns the same InterceptResult contract as the request interceptor.
   */
  async checkResponse(
    raw: string,
    session: MiddlebroSession,
  ): Promise<InterceptResult> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return { blocked: false, sanitized: false, body: raw };
    }

    // Handle streaming — skip (can't buffer SSE chunks reliably here)
    if (
      typeof body['object'] === 'string' &&
      body['object'].includes('stream')
    ) {
      return { blocked: false, sanitized: false, body: raw };
    }

    const choices = body['choices'];
    if (!Array.isArray(choices) || choices.length === 0) {
      return { blocked: false, sanitized: false, body: raw };
    }

    const allSignals: Signal[] = [];
    let sanitized = false;
    const sanitizedChoices = [...choices];

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i] as Record<string, unknown>;
      const msg = choice['message'] as OpenAIMessage | undefined;
      if (!msg) continue;

      const text = extractToolCallText(msg);
      if (!text) continue;

      const signals = scanForSignals(text);
      if (signals.length === 0) continue;

      allSignals.push(...signals);

      const verdict = await this.reasoner.analyze({
        eventType: 'llm:response',
        content: text,
        signals,
        sessionSummary: buildSessionSummary(session),
      });

      if (!verdict) continue;

      if (verdict.action === 'block' || verdict.action === 'terminate') {
        return {
          blocked: true,
          sanitized: false,
          body: raw,
          verdict,
        };
      }

      if (verdict.action === 'sanitize') {
        sanitizedChoices[i] = {
          ...choice,
          message: {
            role: msg.role ?? 'assistant',
            content:
              '[response sanitized by Middlebro — security threat detected in LLM output]',
          },
        };
        sanitized = true;
      }
    }

    if (sanitized) {
      const sanitizedBody = { ...body, choices: sanitizedChoices };
      return {
        blocked: false,
        sanitized: true,
        body: JSON.stringify(sanitizedBody),
      };
    }

    return { blocked: false, sanitized: false, body: raw };
  }
}
