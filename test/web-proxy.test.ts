import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { handleWebRequest } from '../web/server.js';
import { Session, commitSession } from '../web/lib/session.js';

describe('Web Server - API Reverse Proxy Subsystem', () => {
  let backendServer: http.Server;
  let backendPort: number;
  let webServer: http.Server;
  let webPort: number;

  let capturedHeaders: http.IncomingHttpHeaders = {};
  let capturedUrl = '';

  before(async () => {
    // 1. Start mock backend API server
    backendServer = http.createServer((req, res) => {
      capturedHeaders = { ...req.headers };
      capturedUrl = req.url || '';

      if (req.url === '/api/v1/accounting/export/rent-roll.csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="rent-roll-export.csv"'
        });
        res.end('Unit,Resident,MarketRent,Balance\n101,John Doe,150000,0\n');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });

    await new Promise<void>((resolve) => {
      backendServer.listen(0, '127.0.0.1', () => {
        const addr = backendServer.address() as any;
        backendPort = addr.port;
        resolve();
      });
    });

    // 2. Start web presentation server routing to mock backend
    webServer = http.createServer((req, res) => {
      handleWebRequest(req, res, `http://127.0.0.1:${backendPort}`).catch((err) => {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(String(err));
        }
      });
    });

    await new Promise<void>((resolve) => {
      webServer.listen(0, '127.0.0.1', () => {
        const addr = webServer.address() as any;
        webPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    await new Promise<void>((resolve) => webServer.close(() => resolve()));
  });

  it('transparently proxies /api/ requests with session auth token and operator ID', async () => {
    // Construct signed session cookie
    const session = new Session({
      authToken: 'mock-jwt-token-12345',
      operatorId: 'op-proxy-test-99'
    });

    const dummyRes = new http.ServerResponse({} as any);
    commitSession(dummyRes, session);
    const setCookie = dummyRes.getHeader('set-cookie') as string;
    const cookieHeader = setCookie ? setCookie.split(';')[0] : '';

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: webPort,
      path: '/api/v1/accounting/export/rent-roll.csv',
      method: 'GET',
      headers: {
        Cookie: cookieHeader
      }
    };

    const res = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const clientReq = http.request(options, (clientRes) => {
        const chunks: Buffer[] = [];
        clientRes.on('data', (c) => chunks.push(c));
        clientRes.on('end', () => {
          resolve({
            statusCode: clientRes.statusCode || 0,
            headers: clientRes.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      });
      clientReq.on('error', reject);
      clientReq.end();
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.headers['content-disposition'], 'attachment; filename="rent-roll-export.csv"');
    assert.match(res.body, /Unit,Resident,MarketRent,Balance/);

    // Verify backend received injected headers
    assert.equal(capturedUrl, '/api/v1/accounting/export/rent-roll.csv');
    assert.equal(capturedHeaders['authorization'], 'Bearer mock-jwt-token-12345');
    assert.equal(capturedHeaders['x-operator-id'], 'op-proxy-test-99');
  });

  it('returns 502 BAD_GATEWAY if the backend API server is unreachable', async () => {
    // Send to web server with unreachable apiUrl port
    const offlineWebServer = http.createServer((req, res) => {
      handleWebRequest(req, res, 'http://127.0.0.1:1').catch(() => {});
    });

    await new Promise<void>((resolve) => offlineWebServer.listen(0, '127.0.0.1', () => resolve()));
    const offlinePort = (offlineWebServer.address() as any).port;

    try {
      const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const clientReq = http.request({
          hostname: '127.0.0.1',
          port: offlinePort,
          path: '/api/v1/accounting/export/rent-roll.csv',
          method: 'GET'
        }, (clientRes) => {
          const chunks: Buffer[] = [];
          clientRes.on('data', (c) => chunks.push(c));
          clientRes.on('end', () => {
            resolve({
              statusCode: clientRes.statusCode || 0,
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        });
        clientReq.on('error', reject);
        clientReq.end();
      });

      assert.equal(res.statusCode, 502);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.success, false);
      assert.equal(parsed.error.code, 'BAD_GATEWAY');
    } finally {
      await new Promise<void>((resolve) => offlineWebServer.close(() => resolve()));
    }
  });
});
