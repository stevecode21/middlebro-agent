# Middlebro

Middlebro is an open-source security shield for AI agents.

It protects agents against malicious instructions, unsafe execution flows, and network-level threats before they turn into real-world impact.

Built for agent builders who need a control point for prompt injection, context poisoning, suspicious tool behavior, and risky inbound or outbound network activity.

## Why Middlebro

- Detect malicious instruction attacks like prompt injection, indirect injection, and poisoned context
- Inspect risky agent behavior across tools, execution flows, and outbound traffic
- Enforce policy by allowing, sanitizing, blocking, or logging suspicious behavior

## Quick Example

```ts
import OpenAI from "openai";
import { Middlebro } from "middlebro";
import {
  guardMessages,
  resolveOpenAIBaseURL,
} from "middlebro/adapters/openai";

const mb = new Middlebro({ mode: "enforce" });
const session = mb.session();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: resolveOpenAIBaseURL(process.env.OPENAI_BASE_URL),
});

const safeMessages = guardMessages(session, messages);

const response = await client.chat.completions.create({
  model: "gpt-oss:20b",
  messages: safeMessages,
});
```

## What Middlebro Covers

Middlebro is being built across three layers:

### 1. Instruction Layer

- prompt injection
- indirect prompt injection
- context poisoning
- malicious instructions hidden in retrieved docs, tool outputs, or memory

### 2. Execution Layer

- unsafe tool calls
- suspicious action chains
- dangerous execution flows
- policy violations during tool use

### 3. Boundary Layer

- risky outbound traffic
- suspicious ingress and egress patterns
- agent-to-system boundary abuse
- network-level exposure around agent workflows

## Current Scope

Today, Middlebro is strongest at the instruction layer.

That is the current wedge because it has:

- immediate security value
- low integration friction
- clear live-demo behavior
- direct relevance to agent builders using retrieval and tool calling

The long-term direction is broader: a programmable control point between agents and the world around them.

## Install

```bash
npm install middlebro
```

Or install the CLI globally:

```bash
npm install -g middlebro
```

## Run as Middleware Proxy

Start Middlebro as an OpenAI-compatible proxy in front of your model or upstream endpoint:

```bash
middlebro start \
  --mode monitor \
  --port 4141 \
  --target http://127.0.0.1:11434/v1 \
  --reasoner-model gpt-oss:20b
```

Then point your client to:

```text
http://127.0.0.1:4141/v1
```

## Feature-Flag Integration

You can turn Middlebro on or off without changing application code:

```bash
MIDDLEBRO_ENABLED=true
MIDDLEBRO_URL=http://127.0.0.1:4141/v1
```

When `MIDDLEBRO_ENABLED=false`, adapter checks become no-op and your agent continues normally.

## Adapters

### OpenAI

```ts
import OpenAI from "openai";
import { Middlebro } from "middlebro";
import {
  guardMessages,
  guardToolResult,
  resolveOpenAIBaseURL,
} from "middlebro/adapters/openai";

const mb = new Middlebro({ mode: "enforce" });
const session = mb.session();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: resolveOpenAIBaseURL(process.env.OPENAI_BASE_URL),
});

const safeMessages = guardMessages(session, messages);

const completion = await client.chat.completions.create({
  model: "gpt-oss:20b",
  messages: safeMessages,
});

const safeToolOutput = guardToolResult(session, toolOutput);
```

### LangChain

```ts
import { Middlebro } from "middlebro";
import { MiddlebroLangChainHandler } from "middlebro/adapters/langchain";

const mb = new Middlebro({ mode: "enforce" });
const session = mb.session();
const handler = new MiddlebroLangChainHandler(session);

// pass handler in callbacks
```

## Local Demo Flow

Run the end-to-end local flow with Ollama:

Terminal 1:

```bash
npm run flow:start
```

Terminal 2:

```bash
npm run flow:demo
```

Run evals:

```bash
npm run flow:evals
```

Run the package integration demo:

```bash
npm run flow:package-demo
```

This routes through:

- Middlebro proxy: `http://127.0.0.1:4141/v1`
- Ollama upstream: `http://127.0.0.1:11434/v1`

## Development

Requirements:

- Node.js 18+
- npm

Common commands:

```bash
npm install
npm run build
npm run typecheck
npm run lint
```

Useful local scripts:

- `npm run start`
- `npm run demo`
- `npm run evals`
- `npm run flow:start`
- `npm run flow:demo`
- `npm run flow:evals`
- `npm run flow:package-demo`

## Roadmap

- Instruction layer hardening
- Execution policy and action controls
- Boundary monitoring and network enforcement
- Better adapters and framework integrations
- Production deployment guidance

## Who Middlebro Is For

Middlebro is for teams building:

- AI agents with retrieval and tool use
- internal copilots connected to sensitive systems
- action-taking agents, not just text generators
- agent infrastructure that needs a security control point before production rollout

## Project Status

Middlebro is early, but real.

The package, CLI, evals, and demos are here now.
The broader control-plane vision is still being built.

Expect active iteration in API shape, policy model, and adapter ergonomics.

## Contributing

Contributions are welcome.

The highest-value contributions right now are:

- threat model feedback
- detector ideas
- policy design feedback
- adapter improvements
- eval coverage
- documentation improvements

If you want to make a large change, open an issue or discussion first.

## Security

If you believe you have found a security issue, avoid posting exploit details publicly first.

Use responsible disclosure and contact the maintainers privately before opening a detailed public report.

## License

MIT
