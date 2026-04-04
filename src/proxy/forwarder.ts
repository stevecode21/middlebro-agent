import https from 'https';
import http from 'http';
import { URL } from 'url';

// Forwards an intercepted (and possibly sanitized) request to the real provider.
// Handles both streaming (SSE) and non-streaming transparently by piping.
export function forward(
  originalReq: http.IncomingMessage,
  body: string,
  res: http.ServerResponse,
  targetUrl: string
): void {
  const target = new URL(originalReq.url ?? '/', targetUrl);

  const options: https.RequestOptions = {
    hostname: target.hostname,
    port:     target.port || 443,
    path:     target.pathname + target.search,
    method:   originalReq.method ?? 'POST',
    headers: {
      ...originalReq.headers,
      host:             target.hostname,
      'content-length': Buffer.byteLength(body).toString(),
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ error: { message: `Middlebro upstream error: ${err.message}`, type: 'proxy_error' } }));
  });

  proxyReq.write(body);
  proxyReq.end();
}

export function sendBlocked(res: http.ServerResponse, reason: string): void {
  const body = JSON.stringify({
    error: {
      message: `Request blocked by Middlebro: ${reason}`,
      type:    'security_block',
      code:    'middlebro_blocked',
    },
  });
  res.writeHead(403, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString() });
  res.end(body);
}
