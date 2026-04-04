import type {
  OpenAIChatRequest,
  OpenAIMessage,
  InterceptResult,
  Signal,
  SourceContext,
} from '../types.js';
import type { MiddlebroSession } from '../session.js';
import type { Reasoner } from '../reasoner/index.js';

// Maps OpenAI message roles to Middlebro source contexts
function roleToSource(role: OpenAIMessage['role']): SourceContext {
  switch (role) {
    case 'user':
      return 'user_message';
    case 'system':
      return 'system_prompt';
    case 'tool':
      return 'tool_output';
    case 'assistant':
      return 'inter_agent';
  }
}

// Extracts plain text from a message (handles string content and tool calls)
function extractText(msg: OpenAIMessage): string {
  const parts: string[] = [];
  if (typeof msg.content === 'string' && msg.content.length > 0) {
    parts.push(msg.content);
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      parts.push(`[tool_call: ${tc.function.name}] ${tc.function.arguments}`);
    }
  }
  return parts.join('\n');
}

// Builds a session summary string for the reasoner from recent observations
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

export class Interceptor {
  private reasoner: Reasoner;

  constructor(reasoner: Reasoner) {
    this.reasoner = reasoner;
  }

  async checkRequest(
    raw: string,
    session: MiddlebroSession,
  ): Promise<InterceptResult> {
    let req: OpenAIChatRequest;
    try {
      req = JSON.parse(raw) as OpenAIChatRequest;
    } catch {
      return { blocked: false, sanitized: false, body: raw };
    }

    if (!Array.isArray(req.messages)) {
      return { blocked: false, sanitized: false, body: raw };
    }

    // Inspect the most recent messages (last 3 — oldest are already trusted context)
    const toInspect = req.messages.slice(-3);
    const allSignals: Signal[] = [];
    let sanitized = false;
    const sanitizedMessages = [...req.messages];

    for (const msg of toInspect) {
      const text = extractText(msg);
      if (!text) continue;

      const source = roleToSource(msg.role);
      const gateResult = session.context.check(text, { from: source });
      const { intervention, observation } = gateResult;

      if (observation) {
        allSignals.push(...observation.signals);
      }

      // If watchers fired, ask the reasoner
      if (allSignals.length > 0) {
        const verdict = await this.reasoner.analyze({
          eventType: 'llm:request',
          content: text,
          signals: allSignals,
          sessionSummary: buildSessionSummary(session),
        });

        if (verdict) {
          if (verdict.action === 'block' || verdict.action === 'terminate') {
            return {
              blocked: true,
              sanitized: false,
              body: raw,
              intervention,
              verdict,
            };
          }

          if (verdict.action === 'sanitize') {
            // Strip the offending message content, replace with a redacted marker
            const idx = sanitizedMessages.indexOf(msg);
            if (idx !== -1) {
              const redacted: OpenAIMessage = {
                role: msg.role,
                content:
                  '[content redacted by Middlebro — security threat detected]',
              };
              sanitizedMessages[idx] = redacted;
              sanitized = true;
            }
          }
        }
      }
    }

    if (sanitized) {
      const sanitizedReq = { ...req, messages: sanitizedMessages };
      return {
        blocked: false,
        sanitized: true,
        body: JSON.stringify(sanitizedReq),
      };
    }

    return { blocked: false, sanitized, body: raw };
  }
}
