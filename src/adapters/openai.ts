import type { MiddlebroSession } from '../session.js';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export interface MiddlebroAdapterOptions {
  enabled?: boolean;
}

export function isMiddlebroEnabled(
  opts: MiddlebroAdapterOptions = {},
): boolean {
  return opts.enabled ?? parseBoolean(process.env['MIDDLEBRO_ENABLED'], false);
}

/**
 * Helper to set OpenAI baseURL based on feature flag.
 * If Middlebro is enabled, points to local proxy URL.
 */
export function resolveOpenAIBaseURL(
  originalBaseURL?: string,
  opts: MiddlebroAdapterOptions & { middlebroBaseURL?: string } = {},
): string | undefined {
  if (!isMiddlebroEnabled(opts)) return originalBaseURL;
  return (
    opts.middlebroBaseURL ??
    process.env['MIDDLEBRO_URL'] ??
    'http://127.0.0.1:4141/v1'
  );
}

// Wraps an OpenAI-compatible messages array, scanning each message
// before it is sent to the model.
// Usage:
//   const safe = guardMessages(session, messages);
//   const response = await openai.chat.completions.create({ messages: safe, ... });
export function guardMessages(
  session: MiddlebroSession,
  messages: Array<{ role: string; content: string }>,
  opts: MiddlebroAdapterOptions = {},
): Array<{ role: string; content: string }> {
  if (!isMiddlebroEnabled(opts)) return messages;

  for (const msg of messages) {
    const source = msg.role === 'user' ? 'user_message' : 'system_prompt';
    session.context.check(msg.content, { from: source });
  }
  return messages; // passthrough (MiddlebroBlocked thrown if blocked)
}

// Wraps a tool result before it enters the context window.
export function guardToolResult(
  session: MiddlebroSession,
  result: string,
  opts: MiddlebroAdapterOptions = {},
): string {
  if (!isMiddlebroEnabled(opts)) return result;
  session.context.check(result, { from: 'tool_output' });
  return result;
}
