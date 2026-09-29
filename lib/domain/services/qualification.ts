import type { Referral } from "@/lib/domain/types";
import type { TransactionRunner } from "@/lib/domain/repository";
import { LedgerService } from "@/lib/domain/services/ledger";
import { ReferralLifecycleService } from "@/lib/domain/services/referral-lifecycle";

/** Shared by the future signed webhook adapter and the future founder manual-action adapter. */
export class QualificationService {
  constructor(
    private readonly database: TransactionRunner,
    private readonly lifecycle: ReferralLifecycleService,
    private readonly ledger: LedgerService,
  ) {}

  async qualifyReferral(input: { referralId: string; source: "MANUAL" | "WEBHOOK"; eventKey: string }): Promise<Referral> {
    return this.database.transaction(async (repository) => {
      const referral = await this.lifecycle.transitionInTransaction(repository, {
        referralId: input.referralId, toStatus: "QUALIFIED", source: input.source,
        idempotencyKey: `transition:qualified:${input.eventKey}`,
      });
      await this.ledger.postInTransaction(repository, {
        referralId: referral.id, type: "CREDIT", amountMinor: referral.economics.referrerRewardMinor,
        idempotencyKey: `ledger:qualification:${input.eventKey}`,
      });
      return referral;
    });
  }
}
