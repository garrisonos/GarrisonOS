import * as net from 'node:net';
import * as tls from 'node:tls';
import * as http from 'node:http';
import * as https from 'node:https';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/client.js';
import { RequestContext } from './context.js';
import { generateUUIDv7 } from './crypto.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  fromEmail: string;
  fromName?: string;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
}

export interface OperatorNotificationSettings {
  operator_id: string;
  smtp_host?: string | null;
  smtp_port: number;
  smtp_secure: number;
  smtp_user?: string | null;
  smtp_pass?: string | null;
  from_email?: string | null;
  from_name: string;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  created_at: number;
  updated_at: number;
}

export interface NotificationLog {
  id: string;
  operator_id: string;
  channel: 'smtp' | 'webhook' | 'in_app';
  recipient: string;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed' | 'logged';
  error_message?: string | null;
  metadata_json?: string | null;
  created_at: number;
  sent_at?: number | null;
}

export interface SendEmailOptions {
  operatorId?: string;
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
}

export interface SendWebhookOptions {
  operatorId?: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface SendInAppOptions {
  operatorId?: string;
  recipientUserId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * Native, zero-dependency SMTP client executing RFC 5321 handshake over socket/TLS.
 */
export class NativeSmtpClient {
  /**
   * Send an email message directly via standard library sockets.
   *
   * @param config - Target SMTP host and credential configuration.
   * @param to - Recipient email address.
   * @param subject - Message subject.
   * @param body - Plain-text message content.
   * @returns Promise resolving when SMTP session successfully terminates with 250/221.
   */
  public static async send(
    config: SmtpConfig,
    to: string,
    subject: string,
    body: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let socket: net.Socket;
      let secureSocket: tls.TLSSocket | null = null;
      let buffer = '';
      let step = 0;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('SMTP connection timed out after 10000ms'));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        if (secureSocket) {
          secureSocket.destroy();
        }
        if (socket) {
          socket.destroy();
        }
      };

      const sendLine = (line: string, activeSock: net.Socket | tls.TLSSocket) => {
        activeSock.write(line + '\r\n');
      };

      const handleData = (chunk: Buffer, activeSock: net.Socket | tls.TLSSocket) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.length === 0) continue;
          const code = parseInt(line.substring(0, 3), 10);
          const isContinuation = line.charAt(3) === '-';
          if (isContinuation) continue;

          try {
            switch (step) {
              case 0: // Server greeting (220)
                if (code !== 220) throw new Error(`Unexpected greeting: ${line}`);
                step = 1;
                sendLine(`EHLO garrisonos.local`, activeSock);
                break;

              case 1: // EHLO response (250)
                if (code !== 250) throw new Error(`EHLO rejected: ${line}`);
                if (!config.secure && config.user && config.pass) {
                  // Attempt STARTTLS upgrade if on plain connection
                  step = 2;
                  sendLine('STARTTLS', activeSock);
                } else if (config.user && config.pass) {
                  step = 4;
                  sendLine('AUTH LOGIN', activeSock);
                } else {
                  step = 7;
                  sendLine(`MAIL FROM:<${config.fromEmail}>`, activeSock);
                }
                break;

              case 2: // STARTTLS response (220)
                if (code !== 220) {
                  // Fallback without TLS if rejected
                  if (config.user && config.pass) {
                    step = 4;
                    sendLine('AUTH LOGIN', activeSock);
                  } else {
                    step = 7;
                    sendLine(`MAIL FROM:<${config.fromEmail}>`, activeSock);
                  }
                  break;
                }
                // Upgrade to TLS
                socket.removeAllListeners('data');
                secureSocket = tls.connect({
                  socket,
                  servername: config.host,
                  rejectUnauthorized: true
                });
                secureSocket.on('data', (c) => handleData(c, secureSocket!));
                step = 3;
                sendLine('EHLO garrisonos.local', secureSocket);
                break;

              case 3: // EHLO after TLS (250)
                if (code !== 250) throw new Error(`Post-TLS EHLO rejected: ${line}`);
                if (config.user && config.pass) {
                  step = 4;
                  sendLine('AUTH LOGIN', secureSocket!);
                } else {
                  step = 7;
                  sendLine(`MAIL FROM:<${config.fromEmail}>`, secureSocket || activeSock);
                }
                break;

              case 4: // AUTH LOGIN username prompt (334)
                if (code !== 334) throw new Error(`AUTH LOGIN rejected: ${line}`);
                step = 5;
                sendLine(Buffer.from(config.user || '').toString('base64'), activeSock);
                break;

              case 5: // AUTH LOGIN password prompt (334)
                if (code !== 334) throw new Error(`AUTH username rejected: ${line}`);
                step = 6;
                sendLine(Buffer.from(config.pass || '').toString('base64'), activeSock);
                break;

              case 6: // AUTH success (235)
                if (code !== 235) throw new Error(`AUTH password rejected: ${line}`);
                step = 7;
                sendLine(`MAIL FROM:<${config.fromEmail}>`, activeSock);
                break;

              case 7: // MAIL FROM response (250)
                if (code !== 250) throw new Error(`MAIL FROM rejected: ${line}`);
                step = 8;
                sendLine(`RCPT TO:<${to}>`, activeSock);
                break;

              case 8: // RCPT TO response (250)
                if (code !== 250) throw new Error(`RCPT TO rejected: ${line}`);
                step = 9;
                sendLine('DATA', activeSock);
                break;

              case 9: // DATA prompt (354)
                if (code !== 354) throw new Error(`DATA prompt rejected: ${line}`);
                step = 10;
                const fromHeader = config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail;
                const rfcMessage = [
                  `From: ${fromHeader}`,
                  `To: <${to}>`,
                  `Subject: ${subject}`,
                  `Date: ${new Date().toUTCString()}`,
                  `Message-ID: <${generateUUIDv7()}@garrisonos.local>`,
                  `MIME-Version: 1.0`,
                  `Content-Type: text/plain; charset=utf-8`,
                  '',
                  body,
                  '.'
                ].join('\r\n');
                sendLine(rfcMessage, activeSock);
                break;

              case 10: // DATA delivery response (250)
                if (code !== 250) throw new Error(`Message delivery failed: ${line}`);
                step = 11;
                sendLine('QUIT', activeSock);
                break;

              case 11: // QUIT response (221)
                cleanup();
                resolve();
                return;
            }
          } catch (err) {
            cleanup();
            reject(err);
            return;
          }
        }
      };

      if (config.secure) {
        socket = tls.connect({
          host: config.host,
          port: config.port,
          rejectUnauthorized: true
        });
      } else {
        socket = net.connect({
          host: config.host,
          port: config.port
        });
      }

      socket.on('data', (chunk) => handleData(chunk, socket));
      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });
  }
}

/**
 * Universal Zero-Dependency Notification Dispatcher managing email, webhooks, and audit logs.
 */
export class NotificationDispatcher {
  private db: DatabaseSync;

  /**
   * Initialize notification dispatcher with database handle.
   *
   * @param db - Optional SQLite database connection.
   */
  constructor(db?: DatabaseSync) {
    this.db = db || getDatabase();
  }

  /**
   * Retrieve notification settings for the active operator.
   *
   * @param operatorId - Target operator UUID.
   * @returns OperatorNotificationSettings record or null.
   */
  public getSettings(operatorId: string): OperatorNotificationSettings | null {
    const row = this.db.prepare(`
      SELECT * FROM operator_notification_settings WHERE operator_id = ?
    `).get(operatorId) as any;

    if (!row) {
      return null;
    }

    return {
      operator_id: row.operator_id,
      smtp_host: row.smtp_host,
      smtp_port: row.smtp_port,
      smtp_secure: row.smtp_secure,
      smtp_user: row.smtp_user,
      smtp_pass: row.smtp_pass,
      from_email: row.from_email,
      from_name: row.from_name,
      webhook_url: row.webhook_url,
      webhook_secret: row.webhook_secret,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Save or update notification settings for an operator.
   *
   * @param operatorId - Target operator UUID.
   * @param settings - Candidate configuration fields.
   */
  public updateSettings(
    operatorId: string,
    settings: Partial<OperatorNotificationSettings>
  ): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO operator_notification_settings (
        operator_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass,
        from_email, from_name, webhook_url, webhook_secret, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operator_id) DO UPDATE SET
        smtp_host = excluded.smtp_host,
        smtp_port = excluded.smtp_port,
        smtp_secure = excluded.smtp_secure,
        smtp_user = excluded.smtp_user,
        smtp_pass = excluded.smtp_pass,
        from_email = excluded.from_email,
        from_name = excluded.from_name,
        webhook_url = excluded.webhook_url,
        webhook_secret = excluded.webhook_secret,
        updated_at = excluded.updated_at
    `).run(
      operatorId,
      settings.smtp_host || null,
      settings.smtp_port || 587,
      settings.smtp_secure ? 1 : 0,
      settings.smtp_user || null,
      settings.smtp_pass || null,
      settings.from_email || null,
      settings.from_name || 'GarrisonOS Notifications',
      settings.webhook_url || null,
      settings.webhook_secret || null,
      now,
      now
    );
  }

  /**
   * Dispatch an email notification. If SMTP is unconfigured or in development/test,
   * cleanly logs to the database queue without interrupting program flow.
   *
   * @param options - Email delivery parameters.
   * @returns Notification log record ID.
   */
  public async sendEmail(options: SendEmailOptions): Promise<string> {
    const operatorId = options.operatorId || RequestContext.getOperatorId();
    const logId = generateUUIDv7();
    const now = Date.now();
    const settings = this.getSettings(operatorId);

    // If SMTP host is not configured, fallback cleanly to 'logged' status
    if (!settings || !settings.smtp_host || !settings.from_email) {
      this.db.prepare(`
        INSERT INTO notification_logs (
          id, operator_id, channel, recipient, subject, body, status, error_message, created_at, sent_at
        ) VALUES (?, ?, 'smtp', ?, ?, ?, 'logged', 'SMTP unconfigured - logged to database queue', ?, ?)
      `).run(logId, operatorId, options.to, options.subject, options.body, now, now);

      if (process.env['NODE_ENV'] !== 'test') {
        process.stdout.write(
          `[NotificationDispatcher] Logged offline email to ${options.to}: "${options.subject}"\n`
        );
      }
      return logId;
    }

    try {
      await NativeSmtpClient.send(
        {
          host: settings.smtp_host,
          port: settings.smtp_port,
          secure: settings.smtp_secure === 1,
          user: settings.smtp_user || undefined,
          pass: settings.smtp_pass || undefined,
          fromEmail: settings.from_email,
          fromName: settings.from_name
        },
        options.to,
        options.subject,
        options.body
      );

      this.db.prepare(`
        INSERT INTO notification_logs (
          id, operator_id, channel, recipient, subject, body, status, created_at, sent_at
        ) VALUES (?, ?, 'smtp', ?, ?, ?, 'sent', ?, ?)
      `).run(logId, operatorId, options.to, options.subject, options.body, now, Date.now());

      return logId;
    } catch (err: any) {
      this.db.prepare(`
        INSERT INTO notification_logs (
          id, operator_id, channel, recipient, subject, body, status, error_message, created_at
        ) VALUES (?, ?, 'smtp', ?, ?, ?, 'failed', ?, ?)
      `).run(logId, operatorId, options.to, options.subject, options.body, String(err?.message || err), now);

      return logId;
    }
  }

  /**
   * Dispatch an HTTP/HTTPS Webhook POST payload signed with HMAC-SHA256.
   *
   * @param options - Webhook event and payload parameters.
   * @returns Notification log record ID.
   */
  public async sendWebhook(options: SendWebhookOptions): Promise<string> {
    const operatorId = options.operatorId || RequestContext.getOperatorId();
    const logId = generateUUIDv7();
    const now = Date.now();
    const settings = this.getSettings(operatorId);

    if (!settings || !settings.webhook_url) {
      this.db.prepare(`
        INSERT INTO notification_logs (
          id, operator_id, channel, recipient, subject, body, status, error_message, created_at, sent_at
        ) VALUES (?, ?, 'webhook', 'none', ?, ?, 'logged', 'Webhook unconfigured - logged to queue', ?, ?)
      `).run(logId, operatorId, options.event, JSON.stringify(options.payload), now, now);

      return logId;
    }

    const payloadString = JSON.stringify({
      id: logId,
      event: options.event,
      operator_id: operatorId,
      timestamp: now,
      data: options.payload
    });

    // Compute HMAC signature if secret is configured
    const signature = settings.webhook_secret
      ? createHmac('sha256', settings.webhook_secret).update(payloadString).digest('hex')
      : '';

    try {
      await this.executeHttpPost(settings.webhook_url, payloadString, signature);

      this.db.prepare(`
        INSERT INTO notification_logs (
          id, operator_id, channel, recipient, subject, body, status, created_at, sent_at
        ) VALUES (?, ?, 'webhook', ?, ?, ?, 'sent', ?, ?)
      `).run(logId, operatorId, settings.webhook_url, options.event, payloadString, now, Date.now());

      return logId;
    } catch (err: any) {
      this.db.prepare(`
        INSERT INTO notification_logs (
          id, operator_id, channel, recipient, subject, body, status, error_message, created_at
        ) VALUES (?, ?, 'webhook', ?, ?, ?, 'failed', ?, ?)
      `).run(logId, operatorId, settings.webhook_url, options.event, payloadString, String(err?.message || err), now);

      return logId;
    }
  }

  /**
   * Record an in-app system notification for user dashboard display.
   *
   * @param options - In-app notification parameters.
   * @returns Notification log record ID.
   */
  public sendInApp(options: SendInAppOptions): string {
    const operatorId = options.operatorId || RequestContext.getOperatorId();
    const logId = generateUUIDv7();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO notification_logs (
        id, operator_id, channel, recipient, subject, body, status, metadata_json, created_at, sent_at
      ) VALUES (?, ?, 'in_app', ?, ?, ?, 'sent', ?, ?, ?)
    `).run(
      logId,
      operatorId,
      options.recipientUserId,
      options.title,
      options.body,
      options.metadata ? JSON.stringify(options.metadata) : null,
      now,
      now
    );

    return logId;
  }

  /**
   * List notification logs with operator scoping and optional limit.
   *
   * @param operatorId - Target operator UUID.
   * @param limit - Maximum records to return.
   * @returns Array of NotificationLog records.
   */
  public listLogs(operatorId: string, limit = 50): NotificationLog[] {
    const rows = this.db.prepare(`
      SELECT * FROM notification_logs
      WHERE operator_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(operatorId, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      operator_id: r.operator_id,
      channel: r.channel,
      recipient: r.recipient,
      subject: r.subject,
      body: r.body,
      status: r.status,
      error_message: r.error_message,
      metadata_json: r.metadata_json,
      created_at: r.created_at,
      sent_at: r.sent_at
    }));
  }

  private executeHttpPost(targetUrl: string, body: string, signature: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        'User-Agent': 'GarrisonOS-Webhook-Dispatcher/0.1.0'
      };

      if (signature) {
        headers['X-Garrison-Signature'] = `sha256=${signature}`;
      }

      const req = transport.request(
        parsed,
        {
          method: 'POST',
          headers,
          timeout: 5000
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Webhook endpoint returned HTTP ${res.statusCode}`));
          }
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out after 5000ms'));
      });

      req.write(body);
      req.end();
    });
  }
}
