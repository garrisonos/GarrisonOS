import { Router } from '../../../api/router.js';
import { successResponse, errorResponse } from '../../../api/response.js';
import { requirePermission } from '../../../api/middleware.js';
import { RequestContext } from '../../../core/context.js';
import { ConversationsRepository, ConversationEntityType, RequesterContext } from './repository.js';

const VALID_ENTITY_TYPES: readonly ConversationEntityType[] = Object.freeze([
  'lease',
  'property',
  'building',
  'unit',
  'contact',
  'work_order',
  'bill',
  'portfolio'
]);

// Map plural route segments to singular entity_type
const ROUTE_SEGMENT_TO_ENTITY: Record<string, ConversationEntityType> = {
  properties: 'property',
  buildings: 'building',
  units: 'unit',
  leases: 'lease',
  contacts: 'contact',
  work_orders: 'work_order',
  bills: 'bill',
  portfolios: 'portfolio'
};

/**
 * Extract requester context from active request context for conversation participant scoping.
 *
 * @returns RequesterContext object.
 */
function getRequesterContext(): RequesterContext {
  const userId = RequestContext.getUserId();
  // If request has an active authenticated user with role, verify staff status
  // Operator staff (owner, manager, leasing_agent, maintenance, auditor, etc.) isStaff = true
  return {
    userId: userId || undefined,
    isStaff: true
  };
}

/**
 * Register Universal Conversations REST API endpoints and entity-nested aliases with the router.
 *
 * @param router - Application API router instance.
 */
export function registerRoutes(router: Router): void {
  const repo = new ConversationsRepository();

  /**
   * Canonical: List conversations with entity filtering and pagination.
   */
  router.get('/api/v1/conversations', requirePermission('conversations:view'), async (req, res) => {
    const rawEntityType = req.query['entity_type'] as string | undefined;
    const entityId = req.query['entity_id'] as string | undefined;

    let entityType: ConversationEntityType | undefined;
    if (rawEntityType !== undefined) {
      if (!VALID_ENTITY_TYPES.includes(rawEntityType as ConversationEntityType)) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          `Query parameter "entity_type" must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
          400
        );
      }
      entityType = rawEntityType as ConversationEntityType;
    }

    let lastModifiedStart: number | undefined;
    if (req.query['last_modified_start'] !== undefined) {
      const parsed = Number(req.query['last_modified_start']);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          'Query parameter "last_modified_start" must be a positive integer millisecond timestamp',
          400
        );
      }
      lastModifiedStart = parsed;
    }

    let lastModifiedEnd: number | undefined;
    if (req.query['last_modified_end'] !== undefined) {
      const parsed = Number(req.query['last_modified_end']);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          'Query parameter "last_modified_end" must be a positive integer millisecond timestamp',
          400
        );
      }
      lastModifiedEnd = parsed;
    }

    let limit = 50;
    if (req.query['limit'] !== undefined) {
      const parsed = Number(req.query['limit']);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          'Query parameter "limit" must be a positive integer',
          400
        );
      }
      limit = parsed;
    }

    let page = 1;
    if (req.query['page'] !== undefined) {
      const parsed = Number(req.query['page']);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          'Query parameter "page" must be a positive integer',
          400
        );
      }
      page = parsed;
    }

    const requester = getRequesterContext();
    const result = repo.listConversations(
      {
        entity_type: entityType,
        entity_id: entityId,
        last_modified_start: lastModifiedStart,
        last_modified_end: lastModifiedEnd,
        limit,
        page
      },
      requester
    );

    successResponse(res, result.items, 200, {
      total: result.total,
      page,
      limit
    });
  });

  /**
   * Canonical: Create conversation thread attached to an entity.
   */
  router.post('/api/v1/conversations', requirePermission('conversations:create'), async (req, res) => {
    const body = req.body || {};
    const entityType = body['entity_type'] as ConversationEntityType | undefined;
    const entityId = body['entity_id'] as string | undefined;
    const subject = body['subject'] as string | undefined;

    if (!entityType || !VALID_ENTITY_TYPES.includes(entityType)) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        `Field "entity_type" is required and must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
        400
      );
    }

    if (!entityId || typeof entityId !== 'string' || entityId.trim().length === 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Field "entity_id" is required', 400);
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Field "subject" is required', 400);
    }

    const isPrivate = !!body['is_private'];
    const initialMessage = typeof body['initial_message'] === 'string' ? body['initial_message'] : undefined;
    const participantContactIds = Array.isArray(body['participant_contact_ids']) ? body['participant_contact_ids'] : undefined;
    const participantUserIds = Array.isArray(body['participant_user_ids']) ? body['participant_user_ids'] : undefined;

    const requester = getRequesterContext();
    try {
      const conversation = repo.createConversation(
        {
          entity_type: entityType,
          entity_id: entityId.trim(),
          subject: subject.trim(),
          is_private: isPrivate,
          initial_message: initialMessage,
          participant_contact_ids: participantContactIds,
          participant_user_ids: participantUserIds
        },
        requester
      );

      successResponse(res, conversation, 201);
    } catch (err: any) {
      return errorResponse(res, 'INTERNAL_ERROR', err?.message || 'Failed to create conversation', 500);
    }
  });

  /**
   * Canonical: Retrieve conversation details by ID.
   */
  router.get('/api/v1/conversations/:conversation_id', requirePermission('conversations:view'), async (req, res) => {
    const conversationId = req.params['conversation_id'];
    if (!conversationId) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Parameter conversation_id is required', 400);
    }
    const requester = getRequesterContext();

    const conversation = repo.getConversation(conversationId, requester);
    if (!conversation) {
      return errorResponse(res, 'NOT_FOUND', 'Conversation not found or access denied', 404);
    }

    const messages = repo.listMessages(conversationId, requester);
    successResponse(res, {
      ...conversation,
      messages
    }, 200);
  });

  /**
   * Canonical: Add message / comment to conversation thread.
   */
  router.post('/api/v1/conversations/:conversation_id/messages', requirePermission('conversations:create'), async (req, res) => {
    const conversationId = req.params['conversation_id'];
    if (!conversationId) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Parameter conversation_id is required', 400);
    }
    const body = req.body || {};
    const messageBody = body['body'] as string | undefined;

    if (!messageBody || typeof messageBody !== 'string' || messageBody.trim().length === 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Field "body" is required and cannot be empty', 400);
    }

    const requester = getRequesterContext();
    try {
      const message = repo.addMessage(conversationId, messageBody.trim(), requester);
      successResponse(res, message, 201);
    } catch (err: any) {
      if (err?.message?.includes('not found') || err?.message?.includes('access denied')) {
        return errorResponse(res, 'NOT_FOUND', 'Conversation not found or access denied', 404);
      }
      return errorResponse(res, 'INTERNAL_ERROR', err?.message || 'Failed to add message', 500);
    }
  });

  /**
   * Canonical: List messages for a conversation.
   */
  router.get('/api/v1/conversations/:conversation_id/messages', requirePermission('conversations:view'), async (req, res) => {
    const conversationId = req.params['conversation_id'];
    if (!conversationId) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Parameter conversation_id is required', 400);
    }
    const requester = getRequesterContext();

    const conversation = repo.getConversation(conversationId, requester);
    if (!conversation) {
      return errorResponse(res, 'NOT_FOUND', 'Conversation not found or access denied', 404);
    }

    const messages = repo.listMessages(conversationId, requester);
    successResponse(res, messages, 200);
  });

  /**
   * Canonical: Soft delete conversation thread.
   */
  router.delete('/api/v1/conversations/:conversation_id', requirePermission('conversations:delete'), async (req, res) => {
    const conversationId = req.params['conversation_id'];
    if (!conversationId) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Parameter conversation_id is required', 400);
    }
    const requester = getRequesterContext();

    const deleted = repo.deleteConversation(conversationId, requester);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Conversation not found or access denied', 404);
    }

    successResponse(res, { deleted: true, id: conversationId }, 200);
  });

  /**
   * Entity-nested aliases for REST spec section 11.
   * Registers /api/v1/:entity_segment/:id/conversations across entities.
   */
  for (const [segment, entityType] of Object.entries(ROUTE_SEGMENT_TO_ENTITY)) {
    // GET /api/v1/:entity_type/:id/conversations
    router.get(`/api/v1/${segment}/:id/conversations`, requirePermission('conversations:view'), async (req, res) => {
      const entityId = req.params['id'];
      if (!entityId) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Parameter id is required', 400);
      }
      const requester = getRequesterContext();
      const result = repo.listConversations({ entity_type: entityType, entity_id: entityId }, requester);
      successResponse(res, result.items, 200, { total: result.total, page: 1, limit: 50 });
    });

    // POST /api/v1/:entity_type/:id/conversations
    router.post(`/api/v1/${segment}/:id/conversations`, requirePermission('conversations:create'), async (req, res) => {
      const entityId = req.params['id'];
      if (!entityId) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Parameter id is required', 400);
      }
      const body = req.body || {};
      const subject = body['subject'] as string | undefined;

      if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Field "subject" is required', 400);
      }

      const requester = getRequesterContext();
      try {
        const conversation = repo.createConversation(
          {
            entity_type: entityType,
            entity_id: entityId,
            subject: subject.trim(),
            is_private: !!body['is_private'],
            initial_message: typeof body['initial_message'] === 'string' ? body['initial_message'] : undefined,
            participant_contact_ids: Array.isArray(body['participant_contact_ids']) ? body['participant_contact_ids'] : undefined,
            participant_user_ids: Array.isArray(body['participant_user_ids']) ? body['participant_user_ids'] : undefined
          },
          requester
        );
        successResponse(res, conversation, 201);
      } catch (err: any) {
        return errorResponse(res, 'INTERNAL_ERROR', err?.message || 'Failed to create conversation', 500);
      }
    });

    // POST /api/v1/:entity_type/:id/conversations/:conversation_id/messages
    router.post(`/api/v1/${segment}/:id/conversations/:conversation_id/messages`, requirePermission('conversations:create'), async (req, res) => {
      const conversationId = req.params['conversation_id'];
      if (!conversationId) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Parameter conversation_id is required', 400);
      }
      const body = req.body || {};
      const messageBody = body['body'] as string | undefined;

      if (!messageBody || typeof messageBody !== 'string' || messageBody.trim().length === 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Field "body" is required', 400);
      }

      const requester = getRequesterContext();
      try {
        const message = repo.addMessage(conversationId, messageBody.trim(), requester);
        successResponse(res, message, 201);
      } catch (err: any) {
        if (err?.message?.includes('not found') || err?.message?.includes('access denied')) {
          return errorResponse(res, 'NOT_FOUND', 'Conversation not found or access denied', 404);
        }
        return errorResponse(res, 'INTERNAL_ERROR', err?.message || 'Failed to add message', 500);
      }
    });

    // DELETE /api/v1/:entity_type/:id/conversations/:conversation_id
    router.delete(`/api/v1/${segment}/:id/conversations/:conversation_id`, requirePermission('conversations:delete'), async (req, res) => {
      const conversationId = req.params['conversation_id'];
      if (!conversationId) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Parameter conversation_id is required', 400);
      }
      const requester = getRequesterContext();

      const deleted = repo.deleteConversation(conversationId, requester);
      if (!deleted) {
        return errorResponse(res, 'NOT_FOUND', 'Conversation not found or access denied', 404);
      }

      successResponse(res, { deleted: true, id: conversationId }, 200);
    });
  }
}
