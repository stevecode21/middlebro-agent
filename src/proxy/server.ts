import http from 'http';
import { Middlebro } from '../index.js';
import { Interceptor } from './interceptor.js';
import { ResponseInterceptor } from './response-interceptor.js';
import { Reasoner } from '../reasoner/index.js';
import { forward, forwardAndCapture, sendBlocked } from './forwarder.js';
import { bus } from '../bus/index.js';
import type { ProxyConfig, EnforcementMode } from '../types.js';
import type { MiddlebroSession } from '../session.js';

const DEFAULT_TARGET = 'https://api.openai.com';
const DEFAULT_PORT   = 4141;

// One Middlebro session per client address.
// For local use (single agent), this is effectively one session per run.
const sessions = new Map<string, MiddlebroSession>();

function getOrCreateSession(
  clientKey: string,
  mb: Middlebro,
  onEvent: (line: string) => void
): MiddlebroSession {
  const existing = sessions.get(clientKey);
  if (existing) return existing;

  const session = mb.session();

  bus.on('threat:detected', (event) => {
    if (event.sessionId === session.id) {
      onEvent(`  ⚡  threat detected  session=${session.id.slice(0, 8)}`);
    }
  });

  onEvent(`🟢 new session  ${session.id.slice(0, 8)}  client=${clientKey}`);
  sessions.set(clientKey, session);

  // Emit session:start on the bus so plugins / dashboards can subscribe
  bus.emit('session:start', session.id, { clientKey });

  return session;
}

async function bufferBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export function createProxyServer(opts: {
  config: ProxyConfig;
  mode: EnforcementMode;
  onEvent: (line: string) => void;
}): http.Server {
  const targetUrl = opts.config.targetUrl ?? DEFAULT_TARGET;
  const port      = opts.config.port ?? DEFAULT_PORT;

  const mb = new Middlebro({
    mode: opts.mode,
    onThreatLevelChange: (level, state) => {
      opts.onEvent(`  📈  threat level → ${level}  session=${state.id.slice(0, 8)}`);
    },
    onIntervention: (intervention) => {
      if (intervention.type !== 'pass') {
        opts.onEvent(`  🛡  intervention: ${intervention.type}  — ${intervention.reason ?? ''}`);
      }
    },
  });

  const reasoner             = new Reasoner();
  const requestInterceptor   = new Interceptor(reasoner);
  const responseInterceptor  = new ResponseInterceptor(reasoner);

  const server = http.createServer(async (req, res) => {
    const clientKey = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const session   = getOrCreateSession(clientKey, mb, opts.onEvent);
    const path      = req.url ?? '/';

    // ── Health check ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status:   'ok',
        sessions: sessions.size,
        provider: reasoner.providerName,
        mode:     opts.mode,
      }));
      return;
    }

    // ── Non-LLM endpoints (embeddings, model list, etc.) — pass straight through
    const isLLMEndpoint = path.includes('/chat/completions') || path.includes('/completions');

    if (req.method !== 'POST' || !isLLMEndpoint) {
      const body = await bufferBody(req);
      forward(req, body, res, targetUrl);
      return;
    }

    const ts   = new Date().toISOString().slice(11, 23);
    const body = await bufferBody(req);
    const turn = session.state.turnCount + 1;

    opts.onEvent(`[${ts}] 👁  turn ${turn}  intercepted  llm:request  session=${session.id.slice(0, 8)}`);

    // Emit to bus so the event log / dashboard can track it
    bus.emit('llm:request', session.id, { turn, preview: body.slice(0, 120) });

    // ── Request interception ──────────────────────────────────────────────────
    let reqResult;
    try {
      reqResult = await requestInterceptor.checkRequest(body, session);
    } catch (err) {
      opts.onEvent(`  ⚠️  interceptor error: ${(err as Error).message} — passing through`);
      forward(req, body, res, targetUrl);
      return;
    }

    if (reqResult.blocked) {
      const reason = reqResult.verdict?.reasoning ?? 'security threat detected';
      opts.onEvent(`  🚨 BLOCKED request  — ${reason}`);
      bus.emit('intervention:executed', session.id, { action: 'block', reason, plane: 'request' });
      sendBlocked(res, reason);
      return;
    }

    if (reqResult.sanitized) {
      opts.onEvent(`  ✂️  sanitized request  — forwarding clean content`);
    }

    if (reqResult.verdict) {
      const v = reqResult.verdict;
      opts.onEvent(`  🧠  reasoner [req]: ${v.action}  (${(v.confidence * 100).toFixed(0)}%)  — ${v.reasoning}`);
      bus.emit('threat:detected', session.id, { verdict: v, plane: 'request' });
    } else {
      opts.onEvent(`  ✅  watchers: no signals  → pass`);
    }

    // ── Forward to upstream & capture response ────────────────────────────────
    let upstreamBody: string;
    try {
      upstreamBody = await forwardAndCapture(req, reqResult.body, res, targetUrl);
    } catch {
      // forwardAndCapture already sent the error response to the client
      return;
    }

    // ── Response interception ─────────────────────────────────────────────────
    // Skip response scan for streaming (SSE) — we already sent it through
    const isStreaming = body.includes('"stream":true') || body.includes('"stream": true');
    if (isStreaming || !upstreamBody) return;

    bus.emit('llm:response', session.id, { turn, preview: upstreamBody.slice(0, 120) });

    let resResult;
    try {
      resResult = await responseInterceptor.checkResponse(upstreamBody, session);
    } catch (err) {
      opts.onEvent(`  ⚠️  response interceptor error: ${(err as Error).message}`);
      return;
    }

    if (resResult.blocked) {
      const reason = resResult.verdict?.reasoning ?? 'security threat in LLM response';
      opts.onEvent(`  🚨 BLOCKED response  — ${reason}`);
      bus.emit('intervention:executed', session.id, { action: 'block', reason, plane: 'response' });
      // Note: we already forwarded the response; in a full impl this would require
      // buffering before sending. Log it for now so the operator is alerted.
      opts.onEvent(`  ⚠️  [response-block] response was already sent — session flagged`);
    } else if (resResult.sanitized) {
      opts.onEvent(`  ✂️  sanitized response  — threat stripped from LLM output`);
      bus.emit('intervention:executed', session.id, { action: 'sanitize', plane: 'response' });
    } else if (resResult.verdict) {
      const v = resResult.verdict;
      opts.onEvent(`  🧠  reasoner [res]: ${v.action}  (${(v.confidence * 100).toFixed(0)}%)  — ${v.reasoning}`);
    }
  });

  server.on('error', (err) => {
    opts.onEvent(`❌  server error: ${err.message}`);
  });

  server.listen(port, '127.0.0.1', () => {
    opts.onEvent(`🛡  Middlebro listening on http://127.0.0.1:${port}`);
    opts.onEvent(`   forwarding to ${targetUrl}`);
    opts.onEvent(`   mode: ${opts.mode}  |  reasoner: ${reasoner.providerName}`);
    opts.onEvent('');
    opts.onEvent('   Set your agent\'s base URL:');
    opts.onEvent(`   OPENAI_BASE_URL=http://127.0.0.1:${port}`);
    opts.onEvent(`   ANTHROPIC_BASE_URL=http://127.0.0.1:${port}`);
    opts.onEvent('');
  });

  return server;
}
