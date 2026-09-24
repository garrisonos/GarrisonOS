import { EventBus } from '../../../core/events.js';

/**
 * Registers EventBus subscribers for the conversations and staff notes module.
 *
 * @param _eventBus - Application EventBus instance.
 */
export function registerSubscribers(_eventBus: EventBus): void {
  // Conversations module produces conversation.created and conversation_message.created events
}
