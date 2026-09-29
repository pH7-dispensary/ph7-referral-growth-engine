import type { EconomicsSnapshot } from "@/lib/domain/types";

export interface SnapshotInput extends Omit<EconomicsSnapshot, "capturedAt"> {
  capturedAt?: Date;
}

/** Creates an immutable historical offer record; current programme settings are never referenced again. */
export function captureEconomicsSnapshot(input: SnapshotInput): EconomicsSnapshot {
  if (input.friendIncentiveMinor < 0 || input.referrerRewardMinor < 0 || input.holdingPeriodDays < 0) {
    throw new RangeError("Economics snapshot values cannot be negative.");
  }

  return Object.freeze({ ...input, capturedAt: input.capturedAt ?? new Date() });
}
