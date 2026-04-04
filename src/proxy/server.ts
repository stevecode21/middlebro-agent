import http from 'http';
import { Middlebro } from '../index.js';
import { Interceptor } from './interceptor.js';
import { Reasoner } from '../reasoner/index.js';
import { forward, sendBlocked } from './forwarder.js';
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

  // Wire session events to the live feed
  session.state; // touch to initialise

  bus.on('threat:detected', (event) => {
    if (event.sessionId === session.id) {
      onEvent(`  ⚡  threat detected  session=${session.id.slice(0, 8)}`);
    }
  });

  onEvent(`🟢 new session  ${session.id.slice(0, 8)}  client=${clientKey}`);
  sessions.set(clientKey, session);
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

  const reasoner    = new Reasoner();
  const interceptor = new Interceptor(reasoner);

  const server = http.createServer(async (req, res) => {
    const clientKey = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const session   = getOrCreateSession(clientKey, mb, opts.onEvent);
    const path      = req.url ?? '/';

    // Health check
    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
      return;
    }

    // Only intercept LLM call endpoints
    const isLLMEndpoint = path.includes('/chat/completions') || path.includes('/completions');

    if (req.method !== 'POST' || !isLLMEndpoint) {
      // Non-LLM endpoints (embeddings, models list, etc.) — pass straight through
      const body = await bufferBody(req);
      forward(req, body, res, targetUrl);
      return;
    }

    const ts   = new Date().toISOString().slice(11, 23);
    const body = await bufferBody(req);

    opts.onEvent(`[${ts}] 👁  intercepted  llm:request  session=${session.id.slice(0, 8)}`);

    let result;
    try {
      result = await interceptor.checkRequest(body, session);
    } catch (err) {
      // Reasoner or watcher error — fail open (log, pass through) to avoid breaking the agent
      opts.onEvent(`  ⚠️  interceptor error: ${(err as Error).message} — passing through`);
      forward(req, body, res, targetUrl);
      return;
    }

    if (result.blocked) {
      const reason = result.verdict?.reasoning ?? 'security threat detected';
      opts.onEvent(`  🚨 BLOCKED  — ${reason}`);
      sendBlocked(res, reason);
      return;
    }

    if (result.sanitized) {
      opts.onEvent(`  ✂️  sanitized request  — forwarding clean content`);
    }

    if (result.verdict) {
      opts.onEvent(`  🧠  reasoner: ${result.verdict.action}  (${(result.verdict.confidence * 100).toFixed(0)}%)  — ${result.verdict.reasoning}`);
    }

    forward(req, result.body, res, targetUrl);
  });

  server.on('error', (err) => {
    opts.onEvent(`❌  server error: ${err.message}`);
  });

  server.listen(port, '127.0.0.1', () => {
    opts.onEvent(`🛡  Middlebro listening on http://127.0.0.1:${port}`);
    opts.onEvent(`   forwarding to ${targetUrl}`);
    opts.onEvent(`   mode: ${opts.mode}`);
    opts.onEvent('');
    opts.onEvent('   Set your agent\'s base URL:');
    opts.onEvent(`   OPENAI_BASE_URL=http://127.0.0.1:${port}`);
    opts.onEvent('');
  });

  return server;
}
