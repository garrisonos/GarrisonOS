/**
 * GarrisonOS Web Presentation Layer - Standalone Server
 *
 * Zero-dependency native Node.js HTTP server that serves the SSR presentation layer,
 * static assets, handles form/JSON body parsing, cookie-based HMAC session persistence,
 * and routes to the WebRouter.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { pipeline } from 'node:stream';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleStaticFile, serveStatic } from './static.js';
import { getSession, commitSession, Session } from './lib/session.js';
import { ApiClient } from './lib/api-client.js';
import { PageContext } from './lib/page-context.js';
import { WebRouter } from './router.js';
import { HookRegistry } from './lib/hooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(): string {
  let cur = path.resolve(__dirname);
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
    cur = path.dirname(cur);
  }
  return process.cwd();
}
const rootDir = findRepoRoot();

/**
 * Parse incoming HTTP request body. Supports JSON, URL-encoded forms, and basic multipart files.
 */
function parseRequestBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const contentType = req.headers['content-type'] || '';
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const maxSize = 25 * 1024 * 1024; // 25 MB max payload

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        resolve({});
        return;
      }

      const isMultipart = contentType.includes('multipart/form-data');
      const bodyStr = buffer.toString(isMultipart ? 'latin1' : 'utf8');

      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(bodyStr));
        } catch {
          resolve({});
        }
        return;
      }

      if (contentType.includes('application/x-www-form-urlencoded')) {
        try {
          const params = new URLSearchParams(bodyStr);
          const result: Record<string, any> = {};
          for (const [key, value] of params.entries()) {
            result[key] = value;
          }
          resolve(result);
        } catch {
          resolve({});
        }
        return;
      }

      if (isMultipart) {
        try {
          const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
          if (!match) {
            resolve({});
            return;
          }
          const boundary = match[1] || match[2];
          const parts = bodyStr.split(`--${boundary}`);
          const result: Record<string, any> = {};

          for (const part of parts) {
            if (!part || part === '--' || part === '--\r\n') continue;
            const headerEndIndex = part.indexOf('\r\n\r\n');
            if (headerEndIndex === -1) continue;

            const headerSection = part.slice(0, headerEndIndex);
            const contentSection = part.slice(headerEndIndex + 4).replace(/\r\n$/, '');

            const nameMatch = headerSection.match(/name="([^"]+)"/);
            if (!nameMatch) continue;
            const fieldName = nameMatch[1];
            if (!fieldName) continue;

            const filenameMatch = headerSection.match(/filename="([^"]+)"/);
            if (filenameMatch && filenameMatch[1]) {
              const filename = filenameMatch[1];
              result['filename'] = filename;
              // Encode uploaded binary as base64
              result['backup_data'] = Buffer.from(contentSection, 'latin1').toString('base64');
            } else {
              result[fieldName] = Buffer.from(contentSection, 'latin1').toString('utf8');
            }
          }
          resolve(result);
        } catch {
          resolve({});
        }
        return;
      }

      resolve({});
    });

    req.on('error', () => {
      resolve({});
    });
  });
}

/**
 * Transparently reverse-proxies API requests from the web presentation server to the backend REST API.
 * Automatically injects authentication tokens and operator context from the active browser session.
 *
 * @param req - Incoming HTTP request from the browser.
 * @param res - Server response stream to forward the backend response into.
 * @param backendOrigin - Resolved destination URL on the backend API server.
 * @param safePath - Sanitized relative request path and query string starting with /api/.
 * @param session - Active user session containing cryptographic auth token and operator context.
 */
function proxyApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  backendOrigin: URL,
  safePath: string,
  session: Session
): void {
  const headers = { ...req.headers };
  headers.host = backendOrigin.host;

  if (session.authToken && !headers['authorization']) {
    headers['authorization'] = `Bearer ${session.authToken}`;
  }
  if (session.operatorId && !headers['x-operator-id']) {
    headers['x-operator-id'] = session.operatorId;
  }

  const transport = backendOrigin.protocol === 'https:' ? https : http;
  const requestOptions: http.RequestOptions = {
    protocol: backendOrigin.protocol,
    hostname: backendOrigin.hostname,
    port: backendOrigin.port || (backendOrigin.protocol === 'https:' ? 443 : 80),
    path: safePath,
    method: req.method,
    headers
  };

  const proxyReq = transport.request(requestOptions, (apiRes) => {
    res.writeHead(apiRes.statusCode || 200, apiRes.headers);
    pipeline(apiRes, res, (err) => {
      if (err && !res.destroyed) {
        res.destroy(err);
      }
    });
  });

  proxyReq.setTimeout(30_000, () => {
    proxyReq.destroy(new Error('Upstream timeout'));
  });

  // Cancel upstream request only if client connection drops before response is finished
  res.on('close', () => {
    if (!res.writableFinished && !proxyReq.destroyed) {
      proxyReq.destroy();
    }
  });

  proxyReq.on('error', (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    if (!res.writableEnded) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'BAD_GATEWAY',
            message: 'Failed to proxy request to backend API'
          }
        })
      );
    }
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    pipeline(req, proxyReq, (err) => {
      if (err && !proxyReq.destroyed) {
        proxyReq.destroy(err);
      }
    });
  }
}

/**
 * Request handler for web presentation requests.
 *
 * @param req - Incoming Node.js HTTP request message.
 * @param res - Node.js ServerResponse to write page or proxy output to.
 * @param apiUrl - Loopback or remote URL of the backend REST API engine.
 */
export async function handleWebRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  apiUrl: string = process.env['API_URL'] || 'http://127.0.0.1:3000'
): Promise<void> {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);

  // Native health check endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', uptime: process.uptime() }));
    return;
  }

  // Serve static assets and standard root icons
  if (url.pathname.startsWith('/public/')) {
    const handled = handleStaticFile(req, res);
    if (handled) return;
  }
  if (url.pathname === '/favicon.ico') {
    const handled = serveStatic(req, res, '/public/favicon.ico');
    if (handled) return;
  }
  if (url.pathname === '/apple-touch-icon.png') {
    const handled = serveStatic(req, res, '/public/apple-touch-icon.png');
    if (handled) return;
  }

  // Parse session and cookies
  const isSecure = req.headers['x-forwarded-proto'] === 'https';
  const session: Session = getSession(req);

  // Transparently reverse-proxy API requests (e.g. browser file downloads/exports)
  if (url.pathname.startsWith('/api/')) {
    // SSRF and Path Traversal defense: reject control characters, backslashes, or protocol-relative prefixes
    if (
      /[\x00-\x1F\x7F]/.test(req.url || '') ||
      (req.url || '').includes('\\') ||
      url.pathname.includes('//') ||
      (req.url || '').startsWith('//')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid API path' } }));
      return;
    }

    const normalizedPath = path.posix.normalize(url.pathname);
    if (!normalizedPath.startsWith('/api/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid API path' } }));
      return;
    }

    const parsedApiUrl = new URL(apiUrl);
    const safePathAndQuery = normalizedPath + url.search;

    proxyApiRequest(req, res, parsedApiUrl, safePathAndQuery, session);
    return;
  }

  // Parse body
  const body = await parseRequestBody(req);

  // Parse query params
  const query: Record<string, string> = {};
  url.searchParams.forEach((val, key) => {
    query[key] = val;
  });

  // Prepare ApiClient bound to active session auth & operator
  const api = new ApiClient({
    baseUrl: apiUrl,
    authToken: session.authToken,
    operatorId: session.operatorId,
  });

  // Hook writeHead to automatically commit modified sessions
  const originalWriteHead = res.writeHead.bind(res);
  let sessionCommitted = false;

  res.writeHead = function (statusCode: number, ...args: any[]) {
    if (!sessionCommitted) {
      sessionCommitted = true;
      if (session.isDirty()) {
        commitSession(res, session, { isSecure });
      }
    }
    return (originalWriteHead as any)(statusCode, ...args);
  };

  const ctx: PageContext = {
    req,
    res,
    api,
    session,
    url,
    query,
    body,
    method: req.method || 'GET',
  };

  await WebRouter.dispatch(ctx);
}

/**
 * Create, initialize module hooks, and start the standalone web presentation HTTP server.
 *
 * @param port - TCP port to bind (default 8080 or WEB_PORT).
 * @param host - Network address to bind (default localhost or WEB_HOST).
 * @param apiUrl - Loopback destination URL of the backend REST API engine.
 * @returns Resolving promise with active HTTP server instance once listening.
 */
export async function createWebServer(
  port: number = parseInt(process.env['WEB_PORT'] || '8080', 10),
  host: string = process.env['WEB_HOST'] || 'localhost',
  apiUrl: string = process.env['API_URL'] || 'http://127.0.0.1:3000'
): Promise<http.Server> {
  await HookRegistry.loadModuleHooks(rootDir);

  const server = http.createServer((req, res) => {
    handleWebRequest(req, res, apiUrl).catch((err) => {
      process.stderr.write(`[web] Unhandled request error: ${String(err)}\n`);
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      process.stdout.write(`[web] Presentation server listening on http://${host}:${port}\n`);
      resolve(server);
    });
  });
}

// Auto-run if executed directly as entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createWebServer().catch((err) => {
    process.stderr.write(`[web] Fatal server startup error: ${String(err)}\n`);
    process.exit(1);
  });
}
