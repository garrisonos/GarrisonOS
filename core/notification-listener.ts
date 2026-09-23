import { EventBus } from './events.js';
import { NotificationDispatcher } from './notifications.js';
import { getDatabase } from '../database/client.js';

/**
 * Register core asynchronous EventBus listeners to trigger notifications
 * across leasing, maintenance, conversations, and accounting events.
 *
 * @param eventBus - Application-wide event bus instance.
 */
export function registerNotificationListeners(eventBus: EventBus): void {
  const dispatcher = new NotificationDispatcher();

  // 1. Work Order Created Event
  eventBus.subscribe('work_order.created', async (payload: any) => {
    try {
      const operatorId = payload?.operatorId;
      if (!operatorId) return;

      const title = payload?.title || 'New Work Order';
      const workOrderId = payload?.workOrderId || payload?.id;

      // Send in-app notification to operator staff
      dispatcher.sendInApp({
        operatorId,
        recipientUserId: 'all_staff',
        title: `Work Order Created: ${title}`,
        body: `Work order #${workOrderId || ''} was created. Status: open.`,
        metadata: { workOrderId }
      });

      // Dispatch webhook
      await dispatcher.sendWebhook({
        operatorId,
        event: 'work_order.created',
        payload: { workOrderId, title, operatorId }
      });
    } catch {
      // EventBus background failures must not crash process
    }
  });

  // 2. Preventative Maintenance Due Event
  eventBus.subscribe('preventative_maintenance.due', async (payload: any) => {
    try {
      const operatorId = payload?.operatorId;
      if (!operatorId) return;

      const title = payload?.title || 'Preventative Maintenance Due';
      const scheduleId = payload?.scheduleId;
      const workOrderId = payload?.workOrderId;

      dispatcher.sendInApp({
        operatorId,
        recipientUserId: 'all_staff',
        title: `Preventative Maintenance: ${title}`,
        body: `Schedule generated work order #${workOrderId || ''}.`,
        metadata: { scheduleId, workOrderId }
      });

      await dispatcher.sendWebhook({
        operatorId,
        event: 'preventative_maintenance.due',
        payload: { scheduleId, workOrderId, title, operatorId }
      });
    } catch {
      // Graceful error isolation
    }
  });

  // 3. Lease Late Fee Applied Event
  eventBus.subscribe('lease.late_fee_applied', async (payload: any) => {
    try {
      const operatorId = payload?.operatorId;
      if (!operatorId) return;

      const leaseId = payload?.leaseId;
      const feeCents = payload?.feeCents || 0;

      dispatcher.sendInApp({
        operatorId,
        recipientUserId: 'leasing_staff',
        title: 'Late Fee Applied',
        body: `Late fee of $${(feeCents / 100).toFixed(2)} applied to lease #${leaseId || ''}.`,
        metadata: { leaseId, feeCents }
      });

      await dispatcher.sendWebhook({
        operatorId,
        event: 'lease.late_fee_applied',
        payload: { leaseId, feeCents, operatorId }
      });
    } catch {
      // Graceful error isolation
    }
  });

  // 4. Conversation Message Created Event
  eventBus.subscribe('conversation_message.created', async (payload: any) => {
    try {
      const operatorId = payload?.operatorId;
      if (!operatorId) return;

      const conversationId = payload?.conversationId;
      const messageId = payload?.messageId;

      await dispatcher.sendWebhook({
        operatorId,
        event: 'conversation_message.created',
        payload: { conversationId, messageId, operatorId }
      });
    } catch {
      // Graceful error isolation
    }
  });
}
