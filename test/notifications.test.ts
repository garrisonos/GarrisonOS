import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../database/client.js';
import { runMigrations } from '../database/migrator.js';
import { RequestContext } from '../core/context.js';
import { generateUUIDv7 } from '../core/crypto.js';
import { NotificationDispatcher } from '../core/notifications.js';
import { registerNotificationListeners } from '../core/notification-listener.js';
import { EventBus } from '../core/events.js';

describe('Zero-Dependency Notification Dispatcher Suite', () => {
  let db: any;
  const operatorA = generateUUIDv7();
  const operatorB = generateUUIDv7();
  let dispatcher: NotificationDispatcher;
  let testEventBus: EventBus;

  before(() => {
    db = getDatabase({ inMemory: true });
    runMigrations(db);

    const now = Date.now();
    db.prepare(`
      INSERT INTO operators (id, name, created_at, updated_at)
      VALUES (?, 'Operator A', ?, ?), (?, 'Operator B', ?, ?)
    `).run(operatorA, now, now, operatorB, now, now);

    dispatcher = new NotificationDispatcher(db);
    testEventBus = new EventBus();
    registerNotificationListeners(testEventBus);
  });

  after(() => {
    closeDatabase();
  });

  it('handles offline fallback when SMTP is unconfigured without throwing', async () => {
    await RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, async () => {
      // Operator A has no SMTP configured yet
      const logId = await dispatcher.sendEmail({
        to: 'tenant@example.com',
        subject: 'Monthly Rent Statement',
        body: 'Your statement for the current month is ready.'
      });

      assert.ok(logId);
      const logs = dispatcher.listLogs(operatorA);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.id, logId);
      assert.equal(logs[0]!.status, 'logged');
      assert.equal(logs[0]!.recipient, 'tenant@example.com');
      assert.equal(logs[0]!.subject, 'Monthly Rent Statement');
      assert.ok(logs[0]!.error_message?.includes('SMTP unconfigured'));
    });
  });

  it('updates operator notification settings and retrieves them', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      dispatcher.updateSettings(operatorA, {
        smtp_host: 'smtp.sendgrid.net',
        smtp_port: 587,
        smtp_secure: 0,
        smtp_user: 'apikey',
        smtp_pass: 'SG.fakekey',
        from_email: 'noreply@garrisonos.local',
        from_name: 'Garrison Support',
        webhook_url: 'https://webhook.site/test-uuid',
        webhook_secret: 'whsec_sample123'
      });

      const settings = dispatcher.getSettings(operatorA);
      assert.ok(settings);
      assert.equal(settings.smtp_host, 'smtp.sendgrid.net');
      assert.equal(settings.smtp_port, 587);
      assert.equal(settings.from_email, 'noreply@garrisonos.local');
      assert.equal(settings.webhook_secret, 'whsec_sample123');
    });
  });

  it('records in-app system notifications for operator dashboard view', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      const logId = dispatcher.sendInApp({
        recipientUserId: 'user-alice-123',
        title: 'Emergency Work Order Dispatched',
        body: 'Work order #WO-101 has been assigned to Frank HVAC.',
        metadata: { workOrderId: 'WO-101' }
      });

      assert.ok(logId);
      const logs = dispatcher.listLogs(operatorA);
      const match = logs.find((l) => l.id === logId);
      assert.ok(match);
      assert.equal(match.channel, 'in_app');
      assert.equal(match.status, 'sent');
      assert.equal(match.subject, 'Emergency Work Order Dispatched');
      assert.ok(match.metadata_json?.includes('WO-101'));
    });
  });

  it('enforces operator scoping on notification logs and settings', () => {
    RequestContext.run({ operatorId: operatorB, correlationId: 'test-corr' }, () => {
      const logsB = dispatcher.listLogs(operatorB);
      assert.equal(logsB.length, 0, 'Operator B should have no notification logs');

      const settingsB = dispatcher.getSettings(operatorB);
      assert.equal(settingsB, null, 'Operator B should have no settings initialized');
    });
  });

  it('event listener responds to work_order.created by emitting notification', async () => {
    testEventBus.publish('work_order.created', {
      operatorId: operatorA,
      workOrderId: 'WO-999',
      title: 'Water leak under kitchen sink',
      priority: 'high'
    });

    // Wait for setImmediate dispatch in EventBus
    await new Promise((resolve) => setTimeout(resolve, 50));

    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      const logs = dispatcher.listLogs(operatorA);
      const match = logs.find((l) => l.subject.includes('Water leak under kitchen sink'));
      assert.ok(match, 'Event listener must create notification log on work_order.created');
    });
  });
});
