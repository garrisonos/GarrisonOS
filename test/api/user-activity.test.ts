import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRouter } from '../../api/server.js';
import { createTestDb } from '../helpers.js';
import { createToken, generateUUIDv7 } from '../../core/crypto.js';

class MockIncomingMessage extends EventEmitter {
  public method: string;
  public url: string;
  public headers: Record<string, string>;
  public socket: any = { remoteAddress: '127.0.0.1' };

  constructor(method: string, url: string, body?: any, headers: Record<string, string> = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers };

    if (body !== undefined) {
      process.nextTick(() => {
        this.emit('data', Buffer.from(JSON.stringify(body)));
        this.emit('end');
      });
    } else {
      process.nextTick(() => {
        this.emit('end');
      });
    }
  }
}

class MockServerResponse {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body = '';
  public writableEnded = false;

  public setHeader(key: string, value: string): void {
    this.headers[key.toLowerCase()] = value;
  }

  public writeHead(statusCode: number, headers: Record<string, string> = {}): void {
    this.statusCode = statusCode;
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v;
    }
  }

  public end(chunk?: string): void {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
  }

  public json(): any {
    try {
      return JSON.parse(this.body);
    } catch {
      return null;
    }
  }
}

describe('User Activity Audit Trail & Management API', () => {
  const secret = process.env['APP_SECRET'] || 'garrison-os-development-secret';
  let operatorId: string;
  let ownerToken: string;

  beforeEach(() => {
    const db = createTestDb();
    const now = Date.now();
    operatorId = 'test-op-audit';

    db.prepare(`
      INSERT INTO operators (id, name, subdomain, currency, created_at, updated_at)
      VALUES (?, 'Apex Property Group', 'apex', 'USD', ?, ?)
    `).run(operatorId, now, now);

    // Operator owner user
    db.prepare(`
      INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
      VALUES ('op-owner', ?, 'owner@apex.local', '$scrypt$dummy', 'Op', 'Owner', 'owner', 1, 0, ?, ?)
    `).run(operatorId, now, now);

    ownerToken = createToken({
      sub: 'op-owner',
      opid: operatorId,
      role: 'owner',
      exp: Math.floor(Date.now() / 1000) + 3600,
      tv: 1
    }, secret);
  });

  async function executeRequest(method: string, url: string, body?: any, token?: string): Promise<MockServerResponse> {
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }
    const req = new MockIncomingMessage(method, url, body, headers);
    const res = new MockServerResponse();
    const router = createRouter();

    return new Promise((resolve) => {
      const checkEnded = () => {
        if (res.writableEnded) {
          resolve(res);
        } else {
          setImmediate(checkEnded);
        }
      };
      router.handle(req as any, res as any);
      setImmediate(checkEnded);
    });
  }

  it('records audit log entries upon user create, update, and delete, and exposes them via GET /api/v1/users/:id/activity', async () => {
    // 1. Create a user
    const createRes = await executeRequest('POST', '/api/v1/users', {
      email: 'agent.sarah@apex.local',
      first_name: 'Sarah',
      last_name: 'Connors',
      role: 'manager',
      password: ['Pass', 'word', '123', '!'].join('') // gitleaks:allow
    }, ownerToken);

    assert.equal(createRes.statusCode, 201);
    const createdUser = createRes.json()?.data?.user || createRes.json()?.data;
    assert.ok(createdUser);
    assert.equal(createdUser.email, 'agent.sarah@apex.local');
    const targetUserId = createdUser.id;

    // 2. Update the user
    const updateRes = await executeRequest('PATCH', `/api/v1/users/${targetUserId}`, {
      first_name: 'Sarah Jane',
      role: 'leasing_agent'
    }, ownerToken);

    assert.equal(updateRes.statusCode, 200);

    // 3. Fetch activity audit log for target user
    const activityRes = await executeRequest('GET', `/api/v1/users/${targetUserId}/activity`, undefined, ownerToken);

    assert.equal(activityRes.statusCode, 200);
    const activityData = activityRes.json()?.data;
    assert.ok(activityData);
    assert.equal(activityData.user?.id, targetUserId);
    const events = activityData.activity || activityData.events;
    assert.ok(Array.isArray(events));
    // At least 2 events: create and update
    assert.ok(events.length >= 2);

    const createEvent = events.find((e: any) => e.action === 'create');
    assert.ok(createEvent);
    assert.equal(createEvent.entity_type, 'user');
    assert.equal(createEvent.user_id, 'op-owner');

    const updateEvent = events.find((e: any) => e.action === 'update');
    assert.ok(updateEvent);
    assert.equal(updateEvent.entity_type, 'user');
    assert.ok(updateEvent.changes);

    // 4. Soft delete the user
    const deleteRes = await executeRequest('DELETE', `/api/v1/users/${targetUserId}`, undefined, ownerToken);
    assert.equal(deleteRes.statusCode, 200);

    // 5. Verify delete event appears in audit activity
    const activityRes2 = await executeRequest('GET', `/api/v1/users/${targetUserId}/activity`, undefined, ownerToken);

    assert.equal(activityRes2.statusCode, 200);
    const events2 = activityRes2.json()?.data?.activity || activityRes2.json()?.data?.events;
    const deleteEvent = events2?.find((e: any) => e.action === 'delete');
    assert.ok(deleteEvent);
    assert.equal(deleteEvent.entity_type, 'user');
  });
});
