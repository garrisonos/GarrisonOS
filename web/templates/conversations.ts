import { html, raw, SafeHtml } from '../lib/html.js';
import { Conversation, ConversationMessage } from '../../modules/conversations/backend/repository.js';

/**
 * Thread model extended with populated child messages for presentation.
 */
export interface ConversationThreadWithMessages extends Conversation {
  /** Ordered list of messages belonging to this thread. */
  messages?: ConversationMessage[];
}

/**
 * Options for configuring and rendering the universal conversations widget.
 */
export interface ConversationsWidgetOptions {
  /** Polymorphic target entity type (e.g. lease, property, work_order). */
  entityType: string;
  /** Primary identifier of the parent entity. */
  entityId: string;
  /** Existing conversation threads associated with the entity. */
  conversations: ConversationThreadWithMessages[];
  /** Whether the active user is permitted to create new threads. */
  canCreate?: boolean;
  /** Active user role for privacy gating (staff vs external). */
  currentUserRole?: string;
  /** Target endpoint URL for submitting new conversations. */
  postActionUrl?: string;
}

function formatTimestamp(epochMs: number): string {
  if (!epochMs) return '';
  const d = new Date(epochMs);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Universal SSR Conversations and Notes widget.
 * Embeddable across properties, units, leases, contacts, and work order show pages.
 *
 * @param options - Configuration options and thread data for the widget.
 * @returns SafeHtml template component.
 */
export function renderConversationsWidget(options: ConversationsWidgetOptions): SafeHtml {
  const {
    entityType,
    entityId,
    conversations = [],
    canCreate = true,
    currentUserRole = 'manager',
    postActionUrl = '/api/v1/conversations'
  } = options;

  const isStaff = ['owner', 'manager', 'leasing_agent', 'maintenance', 'auditor'].includes(currentUserRole);

  const threadsHtml = conversations.length === 0
    ? html`
        <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.7;">💬</div>
          <div style="font-weight: 600; margin-bottom: 0.25rem;">No conversations or notes yet</div>
          <small>Start a discussion or record an internal operational note for this ${entityType}.</small>
        </div>
      `
    : conversations.map((conv) => {
        const isPrivate = conv.is_private === 1;
        const messages = conv.messages || [];

        return html`
          <div class="thread-row">
            <div class="thread-row-top">
              <div>
                <span class="thread-title">${conv.subject}</span>
                ${isPrivate
                  ? html`<span class="badge badge-warning" style="margin-left: 0.5rem;">🔒 Private Note (Staff Only)</span>`
                  : html`<span class="badge badge-info" style="margin-left: 0.5rem;">💬 Shared Thread</span>`}
              </div>
              <div class="thread-meta">
                ${formatTimestamp(conv.last_message_at || conv.created_at)}
              </div>
            </div>

            <div class="messages-history">
              ${messages.map((msg) => {
                const author = msg.author_name || (msg.author_user_id ? 'Staff' : 'Contact');
                const isPrivateBubble = isPrivate;
                const bubbleClass = isPrivateBubble ? 'message-bubble private-note' : 'message-bubble incoming';

                return html`
                  <div class="${bubbleClass}">
                    <span class="message-author-tag">
                      ${author} ${msg.author_role ? html`<small class="text-muted">(${msg.author_role})</small>` : raw('')}
                      <span style="font-weight: normal; font-size: 0.72rem; color: var(--text-muted); margin-left: 0.4rem;">
                        ${formatTimestamp(msg.created_at)}
                      </span>
                    </span>
                    <div style="white-space: pre-wrap;">${msg.body}</div>
                  </div>
                `;
              })}
            </div>

            ${canCreate
              ? html`
                  <form method="POST" action="/conversations/reply" style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <input type="hidden" name="conversation_id" value="${conv.id}">
                    <input type="hidden" name="return_url" value="/${entityType === 'work_order' ? 'maintenance' : entityType + 's'}/show?id=${entityId}">
                    <input type="text" name="body" class="form-input form-input-sm" placeholder="Write a reply..." required style="flex: 1;">
                    <button type="submit" class="btn btn-sm btn-primary">Send</button>
                  </form>
                `
              : raw('')}
          </div>
        `;
      });

  return html`
    <div class="conversations-widget card">
      <div class="card-header conversations-header">
        <div>
          <h3 class="card-title" style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>💬</span> Activity, Notes & Communications
          </h3>
          <small class="text-muted">Universal timeline of tenant notices, vendor logs, and team notes</small>
        </div>
        ${canCreate
          ? html`
              <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('new-thread-modal-${entityId}').showModal()">
                + New Thread or Note
              </button>
            `
          : raw('')}
      </div>

      <div class="conversations-threads-list">
        ${threadsHtml}
      </div>
    </div>

    ${canCreate
      ? html`
          <dialog id="new-thread-modal-${entityId}" class="modal">
            <div class="modal-box">
              <form method="POST" action="/conversations/create">
                <input type="hidden" name="entity_type" value="${entityType}">
                <input type="hidden" name="entity_id" value="${entityId}">
                <input type="hidden" name="return_url" value="/${entityType === 'work_order' ? 'maintenance' : entityType + 's'}/show?id=${entityId}">

                <div class="modal-header">
                  <h3 style="margin: 0; font-size: 1.1rem;">Start Discussion or Private Note</h3>
                  <button type="button" class="btn-close" onclick="document.getElementById('new-thread-modal-${entityId}').close()">×</button>
                </div>
                <div class="modal-body">
                  <div class="form-group">
                    <label class="form-label">Subject / Title</label>
                    <input type="text" name="subject" class="form-input" placeholder="e.g. Move-in Inspection Follow-up or Leak Investigation" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label">First Message / Note Content</label>
                    <textarea name="body" class="form-input" rows="4" placeholder="Detail notes, instructions, or tenant communications..." required></textarea>
                  </div>
                  ${isStaff
                    ? html`
                        <div class="form-group" style="background: var(--bg-subtle); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                          <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600; cursor: pointer; margin: 0;">
                            <input type="checkbox" name="is_private" value="1" checked>
                            <span>🔒 Mark as Private Internal Note (Staff Only)</span>
                          </label>
                          <small class="text-muted" style="display: block; margin-top: 0.25rem;">
                            When checked, tenants and outside vendors cannot view this thread. Uncheck to allow tenant/vendor participation.
                          </small>
                        </div>
                      `
                    : raw('')}
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" onclick="document.getElementById('new-thread-modal-${entityId}').close()">Cancel</button>
                  <button type="submit" class="btn btn-primary">Create Conversation</button>
                </div>
              </form>
            </div>
          </dialog>
        `
      : raw('')}
  `;
}
