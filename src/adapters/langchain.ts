import type { MiddlebroSession } from '../session.js';

// LangChain.js callback handler.
// Usage:
//   const session = mb.session();
//   const chain = new AgentExecutor({ callbacks: [new MiddlebroLangChainHandler(session)] });
export class MiddlebroLangChainHandler {
  private session: MiddlebroSession;

  constructor(session: MiddlebroSession) {
    this.session = session;
  }

  async handleLLMStart(_: unknown, prompts: string[]): Promise<void> {
    for (const prompt of prompts) {
      this.session.context.check(prompt, { from: 'user_message' });
    }
  }

  async handleToolStart(_: unknown, input: string): Promise<void> {
    this.session.context.check(input, { from: 'tool_output' });
  }

  async handleToolEnd(output: string): Promise<void> {
    this.session.context.check(output, { from: 'tool_output' });
  }

  async handleRetrieverEnd(documents: Array<{ pageContent: string }>): Promise<void> {
    for (const doc of documents) {
      this.session.context.check(doc.pageContent, { from: 'retrieval' });
    }
  }
}
