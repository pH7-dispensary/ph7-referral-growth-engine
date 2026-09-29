import type { TransactionRunner } from "@/lib/domain/repository";

export class EventIngestionService {
  constructor(private readonly database: TransactionRunner) {}

  async process<T>(event: { eventId: string; eventType: string }, handler: () => Promise<T>): Promise<{ duplicate: boolean; result?: T }> {
    return this.database.transaction(async (repository) => {
      if (await repository.findWebhookEvent(event.eventId)) return { duplicate: true };
      const claimed = await repository.claimWebhookEvent({ eventId: event.eventId, eventType: event.eventType, receivedAt: new Date(), processedAt: null });
      if (!claimed) return { duplicate: true };
      const result = await handler();
      await repository.markWebhookProcessed(event.eventId);
      return { duplicate: false, result };
    });
  }
}
