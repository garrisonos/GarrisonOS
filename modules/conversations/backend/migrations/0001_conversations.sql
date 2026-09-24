-- Universal Conversations & Notes Subsystem
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('lease', 'property', 'building', 'unit', 'contact', 'work_order', 'bill', 'portfolio')),
    entity_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
    created_by TEXT REFERENCES users(id),
    created_by_contact_id TEXT REFERENCES contacts(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversations_entity ON conversations(operator_id, entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(operator_id, created_by_contact_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_participants (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    user_id TEXT REFERENCES users(id),
    contact_id TEXT REFERENCES contacts(id),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_participants_conv ON conversation_participants(operator_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_participants_contact ON conversation_participants(operator_id, contact_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    author_user_id TEXT REFERENCES users(id),
    author_contact_id TEXT REFERENCES contacts(id),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(operator_id, conversation_id) WHERE deleted_at IS NULL;
