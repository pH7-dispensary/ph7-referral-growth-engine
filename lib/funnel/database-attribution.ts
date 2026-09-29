import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { FunnelAccessError, type FriendOffer, type FunnelOfferResolution, type OpaqueAttribution } from "@/lib/funnel/attribution";
import { PostgresAttributionRepository } from "@/lib/persistence/postgres";
import type { SqlExecutor } from "@/lib/persistence/postgres";

const codePattern = /^[A-Z0-9-]{6,24}$/;
const opaquePattern = /^attr_[a-f0-9]{32}$/;
interface OfferRow { referral_code_id: string; campaign_id: string; code: string; campaign_version: number; programme_settings_version: number; friend_incentive_minor: number; referrer_reward_minor: number; holding_period_days: number; qualification_event: "consultation.paid"; reward_cap_minor: number | null; }

function contextHash(journeyId: string, code: string): string { return createHash("sha256").update(`${journeyId}:${code}`).digest("hex"); }
function toOffer(row: OfferRow): FriendOffer { return Object.freeze({ code: row.code, friendIncentiveMinor: row.friend_incentive_minor, currency: "EUR", holdingPeriodDays: row.holding_period_days }); }

export class DatabaseAttributionService {
  private readonly attributions: PostgresAttributionRepository;
  constructor(private readonly sql: SqlExecutor) { this.attributions = new PostgresAttributionRepository(sql); }

  async resolveOffer(codeInput: string, now = new Date()): Promise<FunnelOfferResolution> {
    const code = codeInput.trim().toUpperCase();
    if (!codePattern.test(code)) return { kind: "unavailable", reason: "MALFORMED_CODE" };
    const row = await this.findOffer(code, now);
    return row ? { kind: "available", offer: toOffer(row) } : { kind: "unavailable", reason: "INVALID_CODE" };
  }

  async createOrResolveAttribution(input: { code: string; journeyId: string; now?: Date }): Promise<{ attribution: OpaqueAttribution; created: boolean }> {
    const now = input.now ?? new Date(); const code = input.code.trim().toUpperCase();
    const offer = await this.resolveOffer(code, now);
    if (offer.kind === "unavailable") throw new FunnelAccessError(offer.reason);
    const row = await this.findOffer(code, now);
    if (!row) throw new FunnelAccessError("UNAVAILABLE");
    const result = await this.attributions.createOrResolve({
      referralCodeId: row.referral_code_id, campaignId: row.campaign_id, campaignVersion: row.campaign_version,
      programmeSettingsVersion: row.programme_settings_version, friendIncentiveMinor: row.friend_incentive_minor,
      referrerRewardMinor: row.referrer_reward_minor, currency: "EUR", qualificationEvent: row.qualification_event,
      holdingPeriodDays: row.holding_period_days, rewardCapMinor: row.reward_cap_minor,
      publicId: `attr_${randomUUID().replaceAll("-", "")}`, journeyContextHash: contextHash(input.journeyId, code),
    });
    const attribution = result.attribution;
    return { created: result.created, attribution: Object.freeze({ attributionId: attribution.publicId, code, contextKey: contextHash(input.journeyId, code), economics: Object.freeze({ campaignId: row.campaign_id, campaignVersion: attribution.campaignVersion, programmeSettingsVersion: attribution.programmeSettingsVersion, friendIncentiveMinor: attribution.friendIncentiveMinor, referrerRewardMinor: attribution.referrerRewardMinor, currency: "EUR", qualificationEvent: "consultation.paid", holdingPeriodDays: attribution.holdingPeriodDays, rewardCapMinor: attribution.rewardCapMinor, capturedAt: attribution.createdAt }), createdAt: attribution.createdAt }) };
  }

  async findAttribution(publicId: string): Promise<OpaqueAttribution | null> {
    if (!opaquePattern.test(publicId)) return null;
    const attribution = await this.attributions.findByPublicId(publicId);
    if (!attribution) return null;
    const code = await this.sql.query<{ code: string }>("SELECT code FROM referral_codes WHERE id = (SELECT referral_code_id FROM referral_attributions WHERE id = $1)", [attribution.id]);
    if (!code.rows[0]) return null;
    return Object.freeze({ attributionId: attribution.publicId, code: code.rows[0].code, contextKey: attribution.journeyContextHash, economics: Object.freeze({ campaignId: "internal", campaignVersion: attribution.campaignVersion, programmeSettingsVersion: attribution.programmeSettingsVersion, friendIncentiveMinor: attribution.friendIncentiveMinor, referrerRewardMinor: attribution.referrerRewardMinor, currency: "EUR", qualificationEvent: "consultation.paid", holdingPeriodDays: attribution.holdingPeriodDays, rewardCapMinor: attribution.rewardCapMinor, capturedAt: attribution.createdAt }), createdAt: attribution.createdAt });
  }

  private async findOffer(code: string, now: Date): Promise<OfferRow | null> {
    const result = await this.sql.query<OfferRow>(`SELECT rc.id AS referral_code_id, c.id AS campaign_id, rc.code, c.version AS campaign_version, ps.version AS programme_settings_version, c.friend_incentive_minor, c.referrer_reward_minor, c.holding_period_days, c.qualification_event, c.reward_cap_minor FROM referral_codes rc JOIN campaigns c ON c.is_active AND (c.starts_at IS NULL OR c.starts_at <= $2) AND (c.ends_at IS NULL OR c.ends_at > $2) CROSS JOIN LATERAL (SELECT version FROM programme_settings WHERE programme_enabled ORDER BY version DESC LIMIT 1) ps WHERE rc.code = $1 AND rc.is_active`, [code, now]);
    return result.rows[0] ?? null;
  }
}
