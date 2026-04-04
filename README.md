# Middlebro

Lightweight security middleware for AI agents. Middlebro inspects context before it reaches the model and can sanitize, block, or terminate suspicious flows.

## Install

```bash
npm install middlebro
```

Or as a sidecar CLI:

```bash
npm install -g middlebro
```

## Run As Middleware Proxy

```bash
middlebro start --mode monitor --port 4141 --target http://127.0.0.1:11434/v1 --reasoner-model gpt-oss:20b
```

Then point your agent OpenAI-compatible client to:

```text
http://127.0.0.1:4141/v1
```

## Feature Flag In Other Agent

Use `MIDDLEBRO_ENABLED` to enable/disable Middlebro without code changes.

```bash
MIDDLEBRO_ENABLED=true
MIDDLEBRO_URL=http://127.0.0.1:4141/v1
```

### OpenAI Adapter Example

```ts
import OpenAI from 'openai';
import { Middlebro } from 'middlebro';
import {
  guardMessages,
  guardToolResult,
  resolveOpenAIBaseURL,
} from 'middlebro/adapters/openai';

const mb = new Middlebro({ mode: 'enforce' });
const session = mb.session();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: resolveOpenAIBaseURL(process.env.OPENAI_BASE_URL),
});

const safeMessages = guardMessages(session, messages);
const completion = await client.chat.completions.create({
  model: 'gpt-oss:20b',
  messages: safeMessages,
});

const safeToolOutput = guardToolResult(session, toolOutput);
```

### LangChain Adapter Example

```ts
import { Middlebro } from 'middlebro';
import { MiddlebroLangChainHandler } from 'middlebro/adapters/langchain';

const mb = new Middlebro({ mode: 'enforce' });
const session = mb.session();
const handler = new MiddlebroLangChainHandler(session);

// pass handler in callbacks
```

If `MIDDLEBRO_ENABLED=false`, adapter checks become no-op and your agent continues normally.

## Quick Flow (Ollama + Flag)

Terminal 1 (run middleware):

```bash
npm run flow:start
```

Terminal 2 (run test traffic through middleware):

```bash
npm run flow:demo
```

Run evaluation suite:

```bash
npm run flow:evals
```

Run package-integration demo (simulates another agent using the SDK):

```bash
npm run flow:package-demo
```

This flow keeps `MIDDLEBRO_ENABLED=true` and routes through:

- Middlebro proxy: `http://127.0.0.1:4141/v1`
- Ollama upstream: `http://127.0.0.1:11434/v1`
