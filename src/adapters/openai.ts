import type { MiddlebroSession } from '../session.js';

// Wraps an OpenAI-compatible messages array, scanning each message
// before it is sent to the model.
// Usage:
//   const safe = guardMessages(session, messages);
//   const response = await openai.chat.completions.create({ messages: safe, ... });
export function guardMessages(
  session: MiddlebroSession,
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  for (const msg of messages) {
    const source = msg.role === 'user' ? 'user_message' : 'system_prompt';
    session.context.check(msg.content, { from: source });
  }
  return messages; // passthrough (MiddlebroBlocked thrown if blocked)
}

// Wraps a tool result before it enters the context window.
export function guardToolResult(session: MiddlebroSession, result: string): string {
  session.context.check(result, { from: 'tool_output' });
  return result;
}
