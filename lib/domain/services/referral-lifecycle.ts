import { randomUUID } from "node:crypto";
import { DomainError } from "@/lib/domain/errors";
import { assertTransition } from "@/lib/domain/state-machine";
import type { Referral, ReferralEvent, ReferralStatus } from "@/lib/domain/types";
import type { ReferralRepository, TransactionRunner } from "@/lib/domain/repository";

export class ReferralLifecycleService {
  constructor(private readonly database: TransactionRunner) {}

  async transition(input: {
    referralId: string;
    toStatus: ReferralStatus;
    source: ReferralEvent["source"];
    idempotencyKey: string;
  }): Promise<Referral> {
    return this.database.transaction((repository) => this.transitionInTransaction(repository, input));
  }

  async transitionInTransaction(repository: ReferralRepository, input: {
    referralId: string; toStatus: ReferralStatus; source: ReferralEvent["source"]; idempotencyKey: string;
  }): Promise<Referral> {
    const previousEvent = await repository.findReferralEventByKey(input.idempotencyKey);
    if (previousEvent) {
      const existing = await repository.findReferral(input.referralId);
      if (!existing) throw new DomainError("Referral does not exist.", "REFERRAL_NOT_FOUND");
      return existing;
    }
    const referral = await repository.findReferral(input.referralId);
    if (!referral) throw new DomainError("Referral does not exist.", "REFERRAL_NOT_FOUND");
    assertTransition(referral.status, input.toStatus);
    const fromStatus = referral.status;
    if (input.toStatus === "FRAUD_REVIEW") referral.statusBeforeFraudReview = fromStatus;
    if (fromStatus === "FRAUD_REVIEW" && input.toStatus !== "REJECTED" && input.toStatus !== referral.statusBeforeFraudReview) {
      throw new DomainError("Fraud review can only restore the previous state or reject.", "INVALID_FRAUD_RESOLUTION");
    }
    referral.status = input.toStatus;
    referral.updatedAt = new Date();
    await repository.saveReferral(referral);
    await repository.appendReferralEvent({
      id: randomUUID(), referralId: referral.id, fromStatus, toStatus: input.toStatus, source: input.source,
      idempotencyKey: input.idempotencyKey, occurredAt: new Date(),
    });
    return referral;
  }
}
