import "server-only";

import { randomUUID } from "node:crypto";
import { captureEconomicsSnapshot } from "@/lib/domain/economics";
import type { EconomicsSnapshot } from "@/lib/domain/types";

const referralCodePattern = /^[A-Z0-9-]{6,24}$/;
const opaqueAttributionPattern = /^attr_[a-f0-9]{32}$/;

export type FunnelUnavailableReason = "MALFORMED_CODE" | "INVALID_CODE" | "INACTIVE_CODE" | "EXPIRED_CAMPAIGN" | "INACTIVE_OFFER" | "UNAVAILABLE";

export interface FriendOffer {
  readonly code: string;
  readonly friendIncentiveMinor: number;
  readonly currency: "EUR";
  readonly holdingPeriodDays: number;
}

export interface OpaqueAttribution {
  readonly attributionId: string;
  readonly code: string;
  readonly contextKey: string;
  readonly economics: EconomicsSnapshot;
  readonly createdAt: Date;
}
export interface AttributionStore { findByContext(key: string): OpaqueAttribution | null; findById(id: string): OpaqueAttribution | null; insert(attribution: OpaqueAttribution): void; }
export class LocalAttributionStore implements AttributionStore {
  private readonly byContext = new Map<string, OpaqueAttribution>(); private readonly byId = new Map<string, OpaqueAttribution>();
  findByContext(key: string) { return this.byContext.get(key) ?? null; } findById(id: string) { return this.byId.get(id) ?? null; }
  insert(attribution: OpaqueAttribution) { this.byContext.set(attribution.contextKey, attribution); this.byId.set(attribution.attributionId, attribution); }
}

interface SyntheticReferralCode {
  readonly code: string;
  readonly active: boolean;
  readonly referrerUserId: string;
  readonly campaign: {
    readonly id: string;
    readonly version: number;
    readonly programmeSettingsVersion: number;
    readonly active: boolean;
    readonly startsAt: Date;
    readonly endsAt: Date | null;
    readonly friendIncentiveMinor: number;
    readonly referrerRewardMinor: number;
    readonly holdingPeriodDays: number;
  } | null;
}

export type FunnelOfferResolution =
  | { readonly kind: "available"; readonly offer: FriendOffer }
  | { readonly kind: "unavailable"; readonly reason: FunnelUnavailableReason };

export class FunnelAccessError extends Error {
  constructor(readonly reason: FunnelUnavailableReason) {
    super("This invitation is not available.");
    this.name = "FunnelAccessError";
  }
}

function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

function snapshotFor(campaign: NonNullable<SyntheticReferralCode["campaign"]>, capturedAt: Date): EconomicsSnapshot {
  return captureEconomicsSnapshot({
    campaignId: campaign.id,
    campaignVersion: campaign.version,
    programmeSettingsVersion: campaign.programmeSettingsVersion,
    friendIncentiveMinor: campaign.friendIncentiveMinor,
    referrerRewardMinor: campaign.referrerRewardMinor,
    currency: "EUR",
    qualificationEvent: "consultation.paid",
    holdingPeriodDays: campaign.holdingPeriodDays,
    rewardCapMinor: null,
    capturedAt,
  });
}

function isCampaignAvailable(campaign: NonNullable<SyntheticReferralCode["campaign"]>, now: Date): FunnelUnavailableReason | null {
  if (!campaign.active) return "INACTIVE_OFFER";
  if (campaign.startsAt > now || (campaign.endsAt && campaign.endsAt <= now)) return "EXPIRED_CAMPAIGN";
  return null;
}

export class SyntheticAttributionService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly codes: ReadonlyMap<string, SyntheticReferralCode> = createSyntheticCodes(), private readonly store: AttributionStore = new LocalAttributionStore()) {}

  resolveOffer(codeInput: string, now = new Date()): FunnelOfferResolution {
    const code = normaliseCode(codeInput);
    if (!referralCodePattern.test(code)) return { kind: "unavailable", reason: "MALFORMED_CODE" };
    const referralCode = this.codes.get(code);
    if (!referralCode) return { kind: "unavailable", reason: "INVALID_CODE" };
    if (!referralCode.active) return { kind: "unavailable", reason: "INACTIVE_CODE" };
    if (!referralCode.campaign) return { kind: "unavailable", reason: "UNAVAILABLE" };
    const unavailableReason = isCampaignAvailable(referralCode.campaign, now);
    if (unavailableReason) return { kind: "unavailable", reason: unavailableReason };
    return { kind: "available", offer: toFriendOffer(referralCode) };
  }

  async createOrResolveAttribution(input: { code: string; journeyId: string; now?: Date }): Promise<{ attribution: OpaqueAttribution; created: boolean }> {
    const now = input.now ?? new Date();
    const code = normaliseCode(input.code);
    const offer = this.resolveOffer(code, now);
    if (offer.kind !== "available") throw new FunnelAccessError(offer.reason);
    const contextKey = `${input.journeyId}:${code}`;
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const existing = this.store.findByContext(contextKey);
      if (existing) return { attribution: existing, created: false };
      const referralCode = this.codes.get(code);
      if (!referralCode?.campaign) throw new FunnelAccessError("UNAVAILABLE");
      const attribution = Object.freeze({
        attributionId: `attr_${randomUUID().replaceAll("-", "")}`,
        code,
        contextKey,
        economics: snapshotFor(referralCode.campaign, now),
        createdAt: now,
      });
      this.store.insert(attribution);
      return { attribution, created: true };
    } finally {
      release();
    }
  }

  findAttribution(attributionId: string): OpaqueAttribution | null {
    if (!opaqueAttributionPattern.test(attributionId)) return null;
    return this.store.findById(attributionId);
  }
}

function toFriendOffer(referralCode: SyntheticReferralCode): FriendOffer {
  if (!referralCode.campaign) throw new FunnelAccessError("UNAVAILABLE");
  return Object.freeze({
    code: referralCode.code,
    friendIncentiveMinor: referralCode.campaign.friendIncentiveMinor,
    currency: "EUR",
    holdingPeriodDays: referralCode.campaign.holdingPeriodDays,
  });
}

function createSyntheticCodes(): ReadonlyMap<string, SyntheticReferralCode> {
  const activeCampaign = {
    id: "synthetic-friend-campaign", version: 1, programmeSettingsVersion: 1, active: true,
    startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: null,
    friendIncentiveMinor: 1000, referrerRewardMinor: 1000, holdingPeriodDays: 14,
  } as const;
  return new Map([
    ["PH7-AVA-72", { code: "PH7-AVA-72", active: true, referrerUserId: "synthetic-ava", campaign: activeCampaign }],
    ["PH7-INACTIVE-99", { code: "PH7-INACTIVE-99", active: false, referrerUserId: "synthetic-ava", campaign: activeCampaign }],
    ["PH7-EXPIRED-90", { code: "PH7-EXPIRED-90", active: true, referrerUserId: "synthetic-ava", campaign: { ...activeCampaign, id: "synthetic-expired", endsAt: new Date("2026-09-01T00:00:00.000Z") } }],
    ["PH7-OFFER-00", { code: "PH7-OFFER-00", active: true, referrerUserId: "synthetic-ava", campaign: { ...activeCampaign, id: "synthetic-inactive", active: false } }],
  ]);
}

const serviceKey = "__ph7SyntheticAttributionService" as const;
type GlobalFunnel = typeof globalThis & { [serviceKey]?: SyntheticAttributionService };

export function getSyntheticAttributionService(): SyntheticAttributionService {
  const globalStore = globalThis as GlobalFunnel;
  globalStore[serviceKey] ??= new SyntheticAttributionService();
  return globalStore[serviceKey];
}

export function isOpaqueAttributionId(value: string): boolean {
  return opaqueAttributionPattern.test(value);
}
