-- Operator Notification Settings & Audit Logs
CREATE TABLE IF NOT EXISTS operator_notification_settings (
    operator_id TEXT PRIMARY KEY REFERENCES operators(id),
    smtp_host TEXT,
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_secure INTEGER NOT NULL DEFAULT 0 CHECK (smtp_secure IN (0, 1)),
    smtp_user TEXT,
    smtp_pass TEXT,
    from_email TEXT,
    from_name TEXT NOT NULL DEFAULT 'GarrisonOS Notifications',
    webhook_url TEXT,
    webhook_secret TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    channel TEXT NOT NULL CHECK (channel IN ('smtp', 'webhook', 'in_app')),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'logged')),
    error_message TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_operator_created ON notification_logs(operator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_operator_status ON notification_logs(operator_id, status);
