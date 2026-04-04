import https from 'https';
import http from 'http';
import { URL } from 'url';

function buildRequestOptions(
  originalReq: http.IncomingMessage,
  body: string,
  target: URL,
): http.RequestOptions {
  const isHttps = target.protocol === 'https:';
  const defaultPort = isHttps ? 443 : 80;
  return {
    hostname: target.hostname,
    port: target.port ? Number(target.port) : defaultPort,
    path: target.pathname + target.search,
    method: originalReq.method ?? 'POST',
    headers: {
      ...originalReq.headers,
      host: target.host,
      'content-length': Buffer.byteLength(body).toString(),
    },
  };
}

function requestForProtocol(target: URL): typeof http.request {
  return target.protocol === 'https:' ? https.request : http.request;
}

// ─── forward ─────────────────────────────────────────────────────────────────
// Forwards an intercepted (and possibly sanitized) request to the real provider.
// Handles both streaming (SSE) and non-streaming transparently by piping.
// Use when you don't need to inspect the response.

export function forward(
  originalReq: http.IncomingMessage,
  body: string,
  res: http.ServerResponse,
  targetUrl: string,
): void {
  const target = new URL(originalReq.url ?? '/', targetUrl);

  const options = buildRequestOptions(originalReq, body, target);
  const request = requestForProtocol(target);

  const proxyReq = request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(
      JSON.stringify({
        error: {
          message: `Middlebro upstream error: ${err.message}`,
          type: 'proxy_error',
        },
      }),
    );
  });

  proxyReq.write(body);
  proxyReq.end();
}

// ─── forwardAndCapture ────────────────────────────────────────────────────────
// Like forward(), but also buffers the upstream response body so response
// interception can scan it.
//
// For streaming (SSE) responses the buffer is unavoidably partial — use
// `forward()` instead for streams and skip response inspection.
//
// Returns the raw upstream response body as a string.
// Rejects if the upstream call fails (caller should handle and NOT re-send).

export function forwardAndCapture(
  originalReq: http.IncomingMessage,
  body: string,
  res: http.ServerResponse,
  targetUrl: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(originalReq.url ?? '/', targetUrl);

    const options = buildRequestOptions(originalReq, body, target);
    const request = requestForProtocol(target);

    const proxyReq = request(options, (proxyRes) => {
      const chunks: Buffer[] = [];

      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));

      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8');

        // Send response to the original client
        if (!res.headersSent) {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        }
        res.end(responseBody);

        resolve(responseBody);
      });

      proxyRes.on('error', reject);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: `Middlebro upstream error: ${err.message}`,
              type: 'proxy_error',
            },
          }),
        );
      }
      reject(err);
    });

    proxyReq.write(body);
    proxyReq.end();
  });
}

// ─── sendBlocked ──────────────────────────────────────────────────────────────

export function sendBlocked(res: http.ServerResponse, reason: string): void {
  const body = JSON.stringify({
    error: {
      message: `Request blocked by Middlebro: ${reason}`,
      type: 'security_block',
      code: 'middlebro_blocked',
    },
  });
  res.writeHead(403, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}
