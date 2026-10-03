import "server-only";

import type { LedgerEntry, Referral, ReferralStatus } from "@/lib/domain/types";
import type { PatientPortalData, PortalPayoutHistoryItem } from "@/lib/portal/data";
import { buildPatientPortalData } from "@/lib/portal/data";
import { toMinorUnits } from "@/lib/portal/money";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import type { SqlExecutor } from "@/lib/persistence/postgres";

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function getPostgresPatientPortalData(
  sql: SqlExecutor,
  referralUserId: string,
): Promise<PatientPortalData | null> {
  const [code, programme, referrals, ledger, payouts, account] = await Promise.all([
    sql.query<{ code: string }>(
      "SELECT code FROM referral_codes WHERE referral_user_id=$1 AND is_active=true LIMIT 1",
      [referralUserId],
    ),
    sql.query<{
      friend_incentive_minor: string | number;
      referrer_reward_minor: string | number;
      holding_period_days: number;
      minimum_withdrawal_minor: string | number;
    }>(
      `SELECT c.friend_incentive_minor, c.referrer_reward_minor, c.holding_period_days,
        (SELECT CASE WHEN programme_enabled THEN minimum_withdrawal_minor ELSE 0 END FROM programme_settings ORDER BY version DESC LIMIT 1) AS minimum_withdrawal_minor
       FROM campaigns c
       WHERE c.is_active=true AND (SELECT programme_enabled FROM programme_settings ORDER BY version DESC LIMIT 1)=true
       AND (c.starts_at IS NULL OR c.starts_at<=now()) AND (c.ends_at IS NULL OR c.ends_at>now())
       ORDER BY c.version DESC LIMIT 1`,
    ),
    sql.query<{
      id: string;
      public_id: string;
      status: ReferralStatus;
      status_before_fraud_review: ReferralStatus | null;
      campaign_id: string;
      campaign_version: number;
      programme_settings_version: number;
      friend_incentive_minor: string | number;
      referrer_reward_minor: string | number;
      currency: "EUR";
      qualification_event: "consultation.paid";
      holding_period_days: number;
      reward_cap_minor: string | number | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT r.id, a.public_id, r.status, r.status_before_fraud_review, r.campaign_id, r.campaign_version,
        r.programme_settings_version, r.friend_incentive_minor, r.referrer_reward_minor, r.currency,
        r.qualification_event, r.holding_period_days, r.reward_cap_minor, r.created_at, r.updated_at
       FROM referrals r
       JOIN referral_attributions a ON a.id=r.attribution_id
       WHERE r.referrer_user_id=$1
       ORDER BY r.created_at DESC`,
      [referralUserId],
    ),
    sql.query<LedgerEntry>(
      `SELECT id, referral_id AS "referralId", payout_request_id AS "payoutRequestId", type,
        amount_minor AS "amountMinor", currency, status, idempotency_key AS "idempotencyKey",
        effective_at AS "effectiveAt", created_at AS "createdAt"
       FROM reward_ledger
       WHERE referral_user_id=$1
       ORDER BY created_at`,
      [referralUserId],
    ),
    sql.query<{
      id: string;
      amount_minor: string | number;
      status: PortalPayoutHistoryItem["status"];
      requested_at: Date | string;
      paid_at: Date | string | null;
      iban_last4: string;
    }>(
      `SELECT p.id, p.amount_minor, p.status, p.requested_at, p.paid_at, a.iban_last4
       FROM payout_requests p
       JOIN payout_accounts a ON a.id=p.payout_account_id AND a.referral_user_id=p.referral_user_id
       WHERE p.referral_user_id=$1
       ORDER BY p.created_at DESC`,
      [referralUserId],
    ),
    sql.query<{ id: string; iban_last4: string }>("SELECT id,iban_last4 FROM payout_accounts WHERE referral_user_id=$1 ORDER BY created_at DESC LIMIT 1", [referralUserId]),
  ]);

  const referralCode = code.rows[0]?.code;
  const campaign = programme.rows[0];
  if (!referralCode || !campaign) return null;

  const referralModels: PatientPortalData["referrals"] = referrals.rows.map((row, index) => ({
    id: row.id,
    referrerUserId: referralUserId,
    attributionId: row.public_id,
    status: row.status,
    statusBeforeFraudReview: row.status_before_fraud_review,
    patientLabel: `Friend ${index + 1}`,
    economics: Object.freeze({
      campaignId: row.campaign_id,
      campaignVersion: row.campaign_version,
      programmeSettingsVersion: row.programme_settings_version,
      friendIncentiveMinor: toMinorUnits(row.friend_incentive_minor, "friend incentive"),
      referrerRewardMinor: toMinorUnits(row.referrer_reward_minor, "referrer reward"),
      currency: row.currency,
      qualificationEvent: row.qualification_event,
      holdingPeriodDays: row.holding_period_days,
      rewardCapMinor: row.reward_cap_minor === null ? null : toMinorUnits(row.reward_cap_minor, "reward cap"),
      capturedAt: asDate(row.created_at),
    }),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));

  const ledgerRows = ledger.rows.map((row) => ({
    ...row,
    amountMinor: toMinorUnits(row.amountMinor, "portal ledger amount"),
    effectiveAt: row.effectiveAt ? asDate(row.effectiveAt) : null,
    createdAt: asDate(row.createdAt),
  }));

  const totals = buildPatientPortalData(referralModels, ledgerRows);
  return {
    ...totals,
    withdrawableBalanceMinor: Math.max(0, totals.availableBalanceMinor - payouts.rows.filter(row => row.status === "REQUESTED").reduce((sum,row) => sum + toMinorUnits(row.amount_minor,"requested withdrawal"),0)),
    withdrawalUnderReview: referralModels.some(row=>row.status==="FRAUD_REVIEW"),
    payoutAccount: account.rows[0] ? { id: account.rows[0].id, accountMask: `•••• ${account.rows[0].iban_last4}` } : undefined,
    syntheticPatientName: "pH7 patient",
    displayName: "there",
    referralCode,
    referralUrl: buildReferralUrl(referralCode),
    friendIncentiveMinor: toMinorUnits(campaign.friend_incentive_minor, "friend incentive"),
    currentRewardMinor: toMinorUnits(campaign.referrer_reward_minor, "current reward"),
    holdingPeriodDays: campaign.holding_period_days,
    minimumWithdrawalMinor: toMinorUnits(campaign.minimum_withdrawal_minor ?? 0, "minimum withdrawal"),
    payouts: payouts.rows.map((row) => ({
      id: row.id,
      amountMinor: toMinorUnits(row.amount_minor, "payout amount"),
      status: row.status,
      requestedAt: asDate(row.requested_at),
      paidAt: row.paid_at ? asDate(row.paid_at) : null,
      accountMask: `•••• ${row.iban_last4}`,
    })),
  };
}
