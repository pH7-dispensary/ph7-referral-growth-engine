import { randomUUID } from "node:crypto";
import { DomainError } from "@/lib/domain/errors";
import type { ReferralRepository, TransactionRunner } from "@/lib/domain/repository";
import type { LedgerEntry, LedgerEntryType } from "@/lib/domain/types";

export class LedgerService {
  constructor(private readonly database: TransactionRunner) {}

  async post(input: {
    referralId?: string;
    payoutRequestId?: string;
    type: LedgerEntryType;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<LedgerEntry> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
      throw new DomainError("Ledger amounts must be non-zero safe integers in minor units.", "INVALID_AMOUNT");
    }
    if ((input.type === "CREDIT" && input.amountMinor < 0) || (input.type !== "CREDIT" && input.amountMinor > 0)) {
      throw new DomainError("Ledger amount sign does not match its entry type.", "INVALID_LEDGER_SIGN");
    }

    return this.database.transaction((repository) => this.postInTransaction(repository, input));
  }

  async postInTransaction(repository: ReferralRepository, input: {
    referralId?: string; payoutRequestId?: string; type: LedgerEntryType; amountMinor: number; idempotencyKey: string;
  }): Promise<LedgerEntry> {
    const existing = await repository.findLedgerEntryByKey(input.idempotencyKey);
    if (existing) return existing;
    const entry: LedgerEntry = Object.freeze({
      id: randomUUID(), referralId: input.referralId ?? null, payoutRequestId: input.payoutRequestId ?? null,
      type: input.type, amountMinor: input.amountMinor, currency: "EUR", status: "EFFECTIVE",
      idempotencyKey: input.idempotencyKey, effectiveAt: new Date(), createdAt: new Date(),
    });
    await repository.appendLedgerEntry(entry);
    return entry;
  }

  async availableBalance(referralId: string): Promise<number> {
    // Deliberately absent: balances are derived by a read repository/query, never maintained here.
    throw new DomainError(`Use a ledger balance query for referral ${referralId}.`, "READ_MODEL_REQUIRED");
  }
}
