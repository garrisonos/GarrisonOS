import { DatabaseSync } from 'node:sqlite';
import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { eventBus } from '../../../core/events.js';

export type ConversationEntityType =
  | 'lease'
  | 'property'
  | 'building'
  | 'unit'
  | 'contact'
  | 'work_order'
  | 'bill'
  | 'portfolio';

export interface Conversation {
  id: string;
  operator_id: string;
  entity_type: ConversationEntityType;
  entity_id: string;
  subject: string;
  is_private: number;
  created_by?: string | null;
  created_by_contact_id?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  message_count?: number;
  last_message_at?: number;
  creator_name?: string;
}

export interface ConversationParticipant {
  id: string;
  operator_id: string;
  conversation_id: string;
  user_id?: string | null;
  contact_id?: string | null;
  participant_name?: string;
  created_at: number;
}

export interface ConversationMessage {
  id: string;
  operator_id: string;
  conversation_id: string;
  author_user_id?: string | null;
  author_contact_id?: string | null;
  author_name?: string;
  author_role?: string;
  body: string;
  created_at: number;
  deleted_at?: number | null;
}

export interface CreateConversationInput {
  entity_type: ConversationEntityType;
  entity_id: string;
  subject: string;
  is_private?: boolean | number;
  initial_message?: string;
  participant_contact_ids?: string[];
  participant_user_ids?: string[];
}

export interface ListConversationsFilter {
  entity_type?: ConversationEntityType;
  entity_id?: string;
  last_modified_start?: number;
  last_modified_end?: number;
  limit?: number;
  page?: number;
}

export interface RequesterContext {
  userId?: string;
  contactId?: string;
  role?: string;
  isStaff?: boolean;
}

/**
 * Universal repository managing polymorphic threaded conversations, messages,
 * and participant access controls across operational entities.
 */
export class ConversationsRepository {
  private db: DatabaseSync;

  /**
   * Initialize repository instance with optional database override.
   *
   * @param db - Optional SQLite database connection.
   */
  constructor(db?: DatabaseSync) {
    this.db = db || getDatabase();
  }

  /**
   * Create a new polymorphic conversation thread and optional initial message.
   *
   * @param input - Creation payload including entity target and subject.
   * @param requester - Requester context for authorship attribution.
   * @returns Newly created Conversation entity.
   */
  public createConversation(
    input: CreateConversationInput,
    requester?: RequesterContext
  ): Conversation {
    const operatorId = RequestContext.getOperatorId();
    const now = Date.now();
    const conversationId = generateUUIDv7();
    const isPrivate = input.is_private ? 1 : 0;
    const authorUserId = requester?.userId || null;
    const authorContactId = requester?.contactId || null;

    withTransaction((tx) => {
      tx.prepare(`
        INSERT INTO conversations (
          id, operator_id, entity_type, entity_id, subject, is_private,
          created_by, created_by_contact_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        conversationId,
        operatorId,
        input.entity_type,
        input.entity_id,
        input.subject.trim(),
        isPrivate,
        authorUserId,
        authorContactId,
        now,
        now
      );

      // Link creator as participant
      if (authorUserId || authorContactId) {
        tx.prepare(`
          INSERT INTO conversation_participants (id, operator_id, conversation_id, user_id, contact_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(generateUUIDv7(), operatorId, conversationId, authorUserId, authorContactId, now);
      }

      // Link any explicit participants
      if (Array.isArray(input.participant_contact_ids)) {
        for (const cid of input.participant_contact_ids) {
          if (cid && cid !== authorContactId) {
            tx.prepare(`
              INSERT INTO conversation_participants (id, operator_id, conversation_id, user_id, contact_id, created_at)
              VALUES (?, ?, ?, NULL, ?, ?)
            `).run(generateUUIDv7(), operatorId, conversationId, cid, now);
          }
        }
      }

      if (Array.isArray(input.participant_user_ids)) {
        for (const uid of input.participant_user_ids) {
          if (uid && uid !== authorUserId) {
            tx.prepare(`
              INSERT INTO conversation_participants (id, operator_id, conversation_id, user_id, contact_id, created_at)
              VALUES (?, ?, ?, ?, NULL, ?)
            `).run(generateUUIDv7(), operatorId, conversationId, uid, now);
          }
        }
      }

      // Insert initial message if provided
      if (input.initial_message && input.initial_message.trim().length > 0) {
        const messageId = generateUUIDv7();
        tx.prepare(`
          INSERT INTO conversation_messages (
            id, operator_id, conversation_id, author_user_id, author_contact_id, body, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId,
          operatorId,
          conversationId,
          authorUserId,
          authorContactId,
          input.initial_message.trim(),
          now
        );
      }
    }, this.db);

    const created = this.getConversation(conversationId, requester);
    if (!created) {
      throw new Error('Failed to retrieve newly created conversation');
    }

    try {
      eventBus.publish('conversation.created', {
        operatorId,
        conversationId,
        entityType: input.entity_type,
        entityId: input.entity_id,
        subject: input.subject,
        isPrivate
      });
    } catch {
      // Background event failure must not interrupt request flow
    }

    return created;
  }

  /**
   * Retrieve conversation by ID with participant privacy validation.
   *
   * @param id - Unique conversation UUIDv7.
   * @param requester - Requester context for permission verification.
   * @returns Conversation entity or null if not found/unauthorized.
   */
  public getConversation(id: string, requester?: RequesterContext): Conversation | null {
    const operatorId = RequestContext.getOperatorId();
    const stmt = this.db.prepare(`
      SELECT c.*,
             (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) as message_count,
             (SELECT MAX(created_at) FROM conversation_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) as last_message_at,
             COALESCE(u.first_name || ' ' || u.last_name, ct.first_name || ' ' || ct.last_name, 'System') as creator_name
      FROM conversations c
      LEFT JOIN users u ON u.id = c.created_by AND u.deleted_at IS NULL
      LEFT JOIN contacts ct ON ct.id = c.created_by_contact_id AND ct.deleted_at IS NULL
      WHERE c.operator_id = ? AND c.id = ? AND c.deleted_at IS NULL
    `);

    const row = stmt.get(operatorId, id) as any;
    if (!row) {
      return null;
    }

    // Participant Scoping: If requester is an external contact, enforce strict participant check
    const isStaff = requester?.isStaff !== false;
    if (!isStaff) {
      // External contacts cannot access private operator notes
      if (row.is_private === 1) {
        return null;
      }

      const contactId = requester?.contactId;
      if (!contactId) {
        return null;
      }

      // Check if this contact created the thread or is an explicit participant
      if (row.created_by_contact_id !== contactId) {
        const participantCheck = this.db.prepare(`
          SELECT 1 FROM conversation_participants
          WHERE operator_id = ? AND conversation_id = ? AND contact_id = ?
        `).get(operatorId, id, contactId);

        if (!participantCheck) {
          return null;
        }
      }
    }

    return {
      id: row.id,
      operator_id: row.operator_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      subject: row.subject,
      is_private: row.is_private,
      created_by: row.created_by,
      created_by_contact_id: row.created_by_contact_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      message_count: Number(row.message_count || 0),
      last_message_at: row.last_message_at ? Number(row.last_message_at) : row.updated_at,
      creator_name: row.creator_name
    };
  }

  /**
   * List conversations matching filter criteria with pagination and participant isolation.
   *
   * @param filter - Search criteria and pagination parameters.
   * @param requester - Requester context for permission verification.
   * @returns Array of matching Conversation entities and total count.
   */
  public listConversations(
    filter: ListConversationsFilter = {},
    requester?: RequesterContext
  ): { items: Conversation[]; total: number } {
    const operatorId = RequestContext.getOperatorId();
    const isStaff = requester?.isStaff !== false;
    const contactId = requester?.contactId;

    const conditions: string[] = ['c.operator_id = ?', 'c.deleted_at IS NULL'];
    const params: any[] = [operatorId];

    if (filter.entity_type) {
      conditions.push('c.entity_type = ?');
      params.push(filter.entity_type);
    }

    if (filter.entity_id) {
      conditions.push('c.entity_id = ?');
      params.push(filter.entity_id);
    }

    if (filter.last_modified_start !== undefined) {
      conditions.push('c.updated_at >= ?');
      params.push(filter.last_modified_start);
    }

    if (filter.last_modified_end !== undefined) {
      conditions.push('c.updated_at <= ?');
      params.push(filter.last_modified_end);
    }

    // Participant Scoping for external contacts
    if (!isStaff) {
      if (!contactId) {
        return { items: [], total: 0 };
      }
      conditions.push('c.is_private = 0');
      conditions.push(`(
        c.created_by_contact_id = ? OR
        c.id IN (SELECT conversation_id FROM conversation_participants WHERE operator_id = ? AND contact_id = ?)
      )`);
      params.push(contactId, operatorId, contactId);
    }

    const whereClause = conditions.join(' AND ');

    // Count query
    const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM conversations c WHERE ${whereClause}
    `).get(...params) as any;
    const total = Number(countRow?.count || 0);

    const limit = Math.min(Math.max(filter.limit || 50, 1), 100);
    const page = Math.max(filter.page || 1, 1);
    const offset = (page - 1) * limit;

    const itemsQuery = `
      SELECT c.*,
             (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) as message_count,
             (SELECT MAX(created_at) FROM conversation_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) as last_message_at,
             COALESCE(u.first_name || ' ' || u.last_name, ct.first_name || ' ' || ct.last_name, 'System') as creator_name
      FROM conversations c
      LEFT JOIN users u ON u.id = c.created_by AND u.deleted_at IS NULL
      LEFT JOIN contacts ct ON ct.id = c.created_by_contact_id AND ct.deleted_at IS NULL
      WHERE ${whereClause}
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.db.prepare(itemsQuery).all(...params, limit, offset) as any[];

    const items: Conversation[] = rows.map((row) => ({
      id: row.id,
      operator_id: row.operator_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      subject: row.subject,
      is_private: row.is_private,
      created_by: row.created_by,
      created_by_contact_id: row.created_by_contact_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      message_count: Number(row.message_count || 0),
      last_message_at: row.last_message_at ? Number(row.last_message_at) : row.updated_at,
      creator_name: row.creator_name
    }));

    return { items, total };
  }

  /**
   * Append a new message to an active conversation thread.
   *
   * @param conversationId - Target conversation UUIDv7.
   * @param body - Message text content.
   * @param requester - Requester context for authorship attribution.
   * @returns Created ConversationMessage entity.
   */
  public addMessage(
    conversationId: string,
    body: string,
    requester?: RequesterContext
  ): ConversationMessage {
    const operatorId = RequestContext.getOperatorId();
    const conversation = this.getConversation(conversationId, requester);
    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    const messageId = generateUUIDv7();
    const now = Date.now();
    const authorUserId = requester?.userId || null;
    const authorContactId = requester?.contactId || null;

    withTransaction((tx) => {
      tx.prepare(`
        INSERT INTO conversation_messages (
          id, operator_id, conversation_id, author_user_id, author_contact_id, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        operatorId,
        conversationId,
        authorUserId,
        authorContactId,
        body.trim(),
        now
      );

      // Update parent conversation timestamp
      tx.prepare(`
        UPDATE conversations SET updated_at = ? WHERE id = ? AND operator_id = ?
      `).run(now, conversationId, operatorId);

      // Automatically register author as participant if not already present
      if (authorUserId || authorContactId) {
        const existing = tx.prepare(`
          SELECT 1 FROM conversation_participants
          WHERE operator_id = ? AND conversation_id = ? AND (
            (user_id IS NOT NULL AND user_id = ?) OR
            (contact_id IS NOT NULL AND contact_id = ?)
          )
        `).get(operatorId, conversationId, authorUserId || '', authorContactId || '');

        if (!existing) {
          tx.prepare(`
            INSERT INTO conversation_participants (id, operator_id, conversation_id, user_id, contact_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(generateUUIDv7(), operatorId, conversationId, authorUserId, authorContactId, now);
        }
      }
    }, this.db);

    const message = this.getMessage(messageId);
    if (!message) {
      throw new Error('Failed to retrieve newly added message');
    }

    try {
      eventBus.publish('conversation_message.created', {
        operatorId,
        conversationId,
        messageId,
        authorUserId,
        authorContactId
      });
    } catch {
      // Non-blocking background event
    }

    return message;
  }

  /**
   * Retrieve a single conversation message by ID.
   *
   * @param messageId - Unique message UUIDv7.
   * @returns ConversationMessage entity or null.
   */
  public getMessage(messageId: string): ConversationMessage | null {
    const operatorId = RequestContext.getOperatorId();
    const stmt = this.db.prepare(`
      SELECT m.*,
             COALESCE(u.first_name || ' ' || u.last_name, ct.first_name || ' ' || ct.last_name, 'System') as author_name,
             COALESCE(u.role, ct.contact_type, 'system') as author_role
      FROM conversation_messages m
      LEFT JOIN users u ON u.id = m.author_user_id AND u.deleted_at IS NULL
      LEFT JOIN contacts ct ON ct.id = m.author_contact_id AND ct.deleted_at IS NULL
      WHERE m.operator_id = ? AND m.id = ? AND m.deleted_at IS NULL
    `);

    const row = stmt.get(operatorId, messageId) as any;
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      operator_id: row.operator_id,
      conversation_id: row.conversation_id,
      author_user_id: row.author_user_id,
      author_contact_id: row.author_contact_id,
      author_name: row.author_name,
      author_role: row.author_role,
      body: row.body,
      created_at: row.created_at,
      deleted_at: row.deleted_at
    };
  }

  /**
   * List all non-deleted messages in a conversation ordered chronologically.
   *
   * @param conversationId - Target conversation UUIDv7.
   * @param requester - Requester context for permission verification.
   * @returns Array of ConversationMessage entities.
   */
  public listMessages(conversationId: string, requester?: RequesterContext): ConversationMessage[] {
    const operatorId = RequestContext.getOperatorId();
    const conversation = this.getConversation(conversationId, requester);
    if (!conversation) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT m.*,
             COALESCE(u.first_name || ' ' || u.last_name, ct.first_name || ' ' || ct.last_name, 'System') as author_name,
             COALESCE(u.role, ct.contact_type, 'system') as author_role
      FROM conversation_messages m
      LEFT JOIN users u ON u.id = m.author_user_id AND u.deleted_at IS NULL
      LEFT JOIN contacts ct ON ct.id = m.author_contact_id AND ct.deleted_at IS NULL
      WHERE m.operator_id = ? AND m.conversation_id = ? AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `);

    const rows = stmt.all(operatorId, conversationId) as any[];
    return rows.map((row) => ({
      id: row.id,
      operator_id: row.operator_id,
      conversation_id: row.conversation_id,
      author_user_id: row.author_user_id,
      author_contact_id: row.author_contact_id,
      author_name: row.author_name,
      author_role: row.author_role,
      body: row.body,
      created_at: row.created_at,
      deleted_at: row.deleted_at
    }));
  }

  /**
   * Soft delete a conversation thread and its messages.
   *
   * @param conversationId - Unique conversation UUIDv7.
   * @param requester - Requester context.
   * @returns True if deleted successfully.
   */
  public deleteConversation(conversationId: string, requester?: RequesterContext): boolean {
    const operatorId = RequestContext.getOperatorId();
    const conversation = this.getConversation(conversationId, requester);
    if (!conversation) {
      return false;
    }

    const now = Date.now();
    withTransaction((tx) => {
      tx.prepare(`
        UPDATE conversations SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(now, now, conversationId, operatorId);

      tx.prepare(`
        UPDATE conversation_messages SET deleted_at = ?
        WHERE conversation_id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, conversationId, operatorId);
    }, this.db);

    return true;
  }
}
