import "server-only";

import type { ReferralStatus } from "@/lib/domain/types";
import type { FraudType } from "@/lib/persistence/operations-postgres";
import { getPostgresExecutor } from "@/lib/persistence/node-postgres";
import type { SqlExecutor } from "@/lib/persistence/postgres";

export const founderSections = ["overview", "campaigns", "referrals", "payouts", "fraud", "audit"] as const;
export type FounderSection = (typeof founderSections)[number];

export interface FounderFilters {
  search?: string;
  referralStatus?: ReferralStatus | "ALL";
  campaignId?: string;
  from?: string;
  to?: string;
  page?: number;
  referralId?: string;
  payoutStatus?: "ALL" | "REQUESTED" | "PAID" | "REJECTED" | "CANCELLED";
  fraudStatus?: "ALL" | "OPEN" | "INVESTIGATING" | "APPROVED" | "REJECTED";
  auditSearch?: string;
}

export interface FounderDashboardData {
  overview: {
    totalReferrals: number; newReferrals: number; previousNewReferrals: number; qualifiedReferrals: number;
    conversionRate: number | null; pendingRewardsMinor: number; availableRewardsMinor: number; paidOutMinor: number;
    outstandingPayouts: number; openFraudFlags: number;
  };
  programme: { enabled: boolean; minimumWithdrawalMinor: number };
  activeCampaign: CampaignRow | null;
  campaigns: CampaignRow[];
  referrals: ReferralRow[];
  referralCount: number;
  referralPage: number;
  referralPages: number;
  selectedReferral: ReferralDetail | null;
  payouts: PayoutRow[];
  fraudFlags: FraudRow[];
  audit: AuditRow[];
  recentReferrals: ReferralRow[];
  recentPayouts: PayoutRow[];
}

export interface CampaignRow {
  id: string; version: number; name: string; active: boolean; startsAt: Date | null; endsAt: Date | null;
  friendIncentiveMinor: number; referrerRewardMinor: number; holdingPeriodDays: number; qualificationEvent: string; createdAt: Date;
}
export interface ReferralRow {
  id: string; publicAttributionId: string; referrerReference: string; referredReference: string;
  campaignId: string; campaignVersion: number; friendIncentiveMinor: number; referrerRewardMinor: number;
  status: ReferralStatus; createdAt: Date; qualifiedAt: Date | null; payoutStatus: string | null; fraudStatus: string | null;
}
export interface ReferralDetail extends ReferralRow {
  events: Array<{ id: string; fromStatus: string | null; toStatus: string; source: string; occurredAt: Date }>;
  ledger: Array<{ id: string; type: string; amountMinor: number; status: string; createdAt: Date }>;
  flags: FraudRow[];
}
export interface PayoutRow {
  id: string; referrerReference: string; amountMinor: number; status: string; accountMask: string;
  requestedAt: Date; paidAt: Date | null; availableBalanceMinor: number;
}
export interface FraudRow {
  id: string; referralId: string; type: FraudType; status: string; detail: Record<string, unknown>;
  createdAt: Date; resolvedAt: Date | null;
}
export interface AuditRow {
  id: string; actor: string; action: string; subjectType: string; subjectId: string | null;
  beforeData: Record<string, unknown> | null; afterData: Record<string, unknown> | null; createdAt: Date;
}

const referralStatuses = new Set<ReferralStatus>(["VISITED", "ATTRIBUTED", "REGISTERED", "BOOKED", "PAID", "QUALIFIED", "PAYABLE", "PAID_OUT", "CANCELLED", "REFUNDED", "REJECTED", "FRAUD_REVIEW", "EXPIRED"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function date(value: Date | string | null): Date | null { return value ? value instanceof Date ? value : new Date(value) : null; }
function money(value: string | number | null): number { const parsed = Number(value ?? 0); if (!Number.isSafeInteger(parsed)) throw new Error("Invalid stored minor-unit amount."); return parsed; }
function privacyReference(value: string | null, prefix: string): string {
  if (!value) return `${prefix} unavailable`;
  const suffix = value.replace(/[^A-Za-z0-9]/g, "").slice(-6);
  return `${prefix} •••${suffix || "unknown"}`;
}
function safeJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(["reason", "friendIncentiveMinor", "referrerRewardMinor", "holdingPeriodDays", "active", "version", "status"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, item]) => allowed.has(key) && ["string", "number", "boolean"].includes(typeof item)));
}
function day(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function normaliseFounderFilters(input: FounderFilters): Required<Pick<FounderFilters, "page">> & FounderFilters {
  const page = Number.isSafeInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
  return {
    ...input,
    page,
    search: input.search?.trim().slice(0, 100) || undefined,
    auditSearch: input.auditSearch?.trim().slice(0, 100) || undefined,
    referralStatus: input.referralStatus && (input.referralStatus === "ALL" || referralStatuses.has(input.referralStatus)) ? input.referralStatus : "ALL",
    campaignId: input.campaignId && uuidPattern.test(input.campaignId) ? input.campaignId : undefined,
    referralId: input.referralId && uuidPattern.test(input.referralId) ? input.referralId : undefined,
    from: day(input.from)?.toISOString(), to: day(input.to)?.toISOString(),
  };
}

export async function getFounderDashboardData(input: FounderFilters = {}, sql: SqlExecutor = getPostgresExecutor()): Promise<FounderDashboardData> {
  const filters = normaliseFounderFilters(input);
  const pageSize = 25;
  const params: unknown[] = [];
  const where = ["1=1"];
  if (filters.search) { params.push(`%${filters.search.replace(/[\\%_]/g, "\\$&")}%`); where.push(`(r.id::text ILIKE $${params.length} ESCAPE '\\' OR a.public_id ILIKE $${params.length} ESCAPE '\\' OR ru.patient_reference ILIKE $${params.length} ESCAPE '\\' OR COALESCE(r.referred_patient_reference,'') ILIKE $${params.length} ESCAPE '\\')`); }
  if (filters.referralStatus && filters.referralStatus !== "ALL") { params.push(filters.referralStatus); where.push(`r.status=$${params.length}::referral_status`); }
  if (filters.campaignId) { params.push(filters.campaignId); where.push(`r.campaign_id=$${params.length}`); }
  if (filters.from) { params.push(filters.from); where.push(`r.created_at >= $${params.length}::timestamptz`); }
  if (filters.to) { params.push(filters.to); where.push(`r.created_at < $${params.length}::timestamptz + interval '1 day'`); }
  const referralWhere = where.join(" AND ");
  const offset = (filters.page - 1) * pageSize;

  const [overview, programme, campaignsResult, countResult, referralsResult, payoutsResult, flagsResult, auditResult, recentReferralsResult, recentPayoutsResult] = await Promise.all([
    sql.query<{ total: string; recent: string; previous: string; qualified: string; pending: string; available: string; paid: string; payouts: string; fraud: string }>(`SELECT
      (SELECT count(*) FROM referrals)::text total,
      (SELECT count(*) FROM referrals WHERE created_at >= now()-interval '30 days')::text recent,
      (SELECT count(*) FROM referrals WHERE created_at < now()-interval '30 days' AND created_at >= now()-interval '60 days')::text previous,
      (SELECT count(*) FROM referrals WHERE status IN ('QUALIFIED','PAYABLE','PAID_OUT'))::text qualified,
      COALESCE((SELECT sum(amount_minor) FROM reward_ledger WHERE type='CREDIT' AND status='PENDING'),0)::text pending,
      COALESCE((SELECT sum(amount_minor) FROM reward_ledger WHERE status='EFFECTIVE'),0)::text available,
      ABS(COALESCE((SELECT sum(amount_minor) FROM reward_ledger WHERE type='PAYOUT' AND status='EFFECTIVE'),0))::text paid,
      (SELECT count(*) FROM payout_requests WHERE status='REQUESTED')::text payouts,
      (SELECT count(*) FROM fraud_flags WHERE status IN ('OPEN','INVESTIGATING'))::text fraud`),
    sql.query<{ programme_enabled: boolean; minimum_withdrawal_minor: string }>("SELECT programme_enabled,minimum_withdrawal_minor::text FROM programme_settings ORDER BY version DESC LIMIT 1"),
    sql.query<{ id:string;version:number;name:string;is_active:boolean;starts_at:Date|string|null;ends_at:Date|string|null;friend_incentive_minor:string;referrer_reward_minor:string;holding_period_days:number;qualification_event:string;created_at:Date|string }>("SELECT id,version,name,is_active,starts_at,ends_at,friend_incentive_minor::text,referrer_reward_minor::text,holding_period_days,qualification_event,created_at FROM campaigns ORDER BY version DESC LIMIT 50"),
    sql.query<{ count: string }>(`SELECT count(*)::text count FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id JOIN referral_users ru ON ru.id=r.referrer_user_id WHERE ${referralWhere}`, params),
    sql.query<ReferralQueryRow>(`${referralSelect} WHERE ${referralWhere} ORDER BY r.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, params),
    sql.query<PayoutQueryRow>(`${payoutSelect} ${filters.payoutStatus && filters.payoutStatus !== "ALL" ? "WHERE p.status=$1::payout_request_status" : ""} ORDER BY p.requested_at DESC LIMIT 100`, filters.payoutStatus && filters.payoutStatus !== "ALL" ? [filters.payoutStatus] : []),
    sql.query<FraudQueryRow>(`${fraudSelect} ${filters.fraudStatus && filters.fraudStatus !== "ALL" ? "WHERE f.status=$1::fraud_flag_status" : ""} ORDER BY f.created_at DESC LIMIT 100`, filters.fraudStatus && filters.fraudStatus !== "ALL" ? [filters.fraudStatus] : []),
    sql.query<AuditQueryRow>(`SELECT l.id,l.action,l.subject_type,l.subject_id,l.before_data,l.after_data,l.created_at,CASE WHEN u.id IS NULL THEN 'System' WHEN u.role='FOUNDER' THEN 'Founder' ELSE 'Admin' END actor FROM admin_audit_log l LEFT JOIN admin_users u ON u.id=l.admin_user_id ${filters.auditSearch ? "WHERE l.action ILIKE $1 OR l.subject_type ILIKE $1 OR COALESCE(l.subject_id::text,'') ILIKE $1" : ""} ORDER BY l.created_at DESC LIMIT 150`, filters.auditSearch ? [`%${filters.auditSearch.replace(/[\\%_]/g, "\\$&")}%`] : []),
    sql.query<ReferralQueryRow>(`${referralSelect} ORDER BY r.created_at DESC LIMIT 6`),
    sql.query<PayoutQueryRow>(`${payoutSelect} ORDER BY p.requested_at DESC LIMIT 6`),
  ]);

  const campaigns = campaignsResult.rows.map(mapCampaign);
  const totals = overview.rows[0] ?? { total:"0",recent:"0",previous:"0",qualified:"0",pending:"0",available:"0",paid:"0",payouts:"0",fraud:"0" };
  const totalReferrals = Number(totals.total);
  const qualifiedReferrals = Number(totals.qualified);
  const referralCount = Number(countResult.rows[0]?.count ?? 0);
  const selectedReferral = filters.referralId ? await getReferralDetail(filters.referralId, sql) : null;
  return {
    overview: { totalReferrals, newReferrals:Number(totals.recent), previousNewReferrals:Number(totals.previous), qualifiedReferrals, conversionRate:totalReferrals ? qualifiedReferrals/totalReferrals : null, pendingRewardsMinor:money(totals.pending), availableRewardsMinor:money(totals.available), paidOutMinor:money(totals.paid), outstandingPayouts:Number(totals.payouts), openFraudFlags:Number(totals.fraud) },
    programme: { enabled:programme.rows[0]?.programme_enabled ?? false, minimumWithdrawalMinor:money(programme.rows[0]?.minimum_withdrawal_minor ?? 0) },
    activeCampaign: campaigns.find(item => item.active) ?? null, campaigns,
    referrals: referralsResult.rows.map(mapReferral), referralCount, referralPage:filters.page, referralPages:Math.max(1,Math.ceil(referralCount/pageSize)), selectedReferral,
    payouts:payoutsResult.rows.map(mapPayout), fraudFlags:flagsResult.rows.map(mapFraud), audit:auditResult.rows.map(mapAudit),
    recentReferrals:recentReferralsResult.rows.map(mapReferral), recentPayouts:recentPayoutsResult.rows.map(mapPayout),
  };
}

type ReferralQueryRow={id:string;public_attribution_id:string;patient_reference:string;referred_patient_reference:string|null;campaign_id:string;campaign_version:number;friend_incentive_minor:string;referrer_reward_minor:string;status:ReferralStatus;created_at:Date|string;qualified_at:Date|string|null;payout_status:string|null;fraud_status:string|null};
const referralSelect=`SELECT r.id,a.public_id public_attribution_id,ru.patient_reference,r.referred_patient_reference,r.campaign_id,r.campaign_version,r.friend_incentive_minor::text,r.referrer_reward_minor::text,r.status,r.created_at,(SELECT max(occurred_at) FROM referral_events e WHERE e.referral_id=r.id AND e.to_status='QUALIFIED') qualified_at,(SELECT p.status::text FROM payout_requests p WHERE p.referral_user_id=r.referrer_user_id ORDER BY p.requested_at DESC LIMIT 1) payout_status,(SELECT f.status::text FROM fraud_flags f WHERE f.referral_id=r.id ORDER BY f.created_at DESC LIMIT 1) fraud_status FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id JOIN referral_users ru ON ru.id=r.referrer_user_id`;
type PayoutQueryRow={id:string;patient_reference:string;amount_minor:string;status:string;iban_last4:string;requested_at:Date|string;paid_at:Date|string|null;available_balance:string};
const payoutSelect=`SELECT p.id,ru.patient_reference,p.amount_minor::text,p.status::text,pa.iban_last4,p.requested_at,p.paid_at,COALESCE((SELECT sum(l.amount_minor) FROM reward_ledger l WHERE l.referral_user_id=p.referral_user_id AND l.status='EFFECTIVE'),0)::text available_balance FROM payout_requests p JOIN payout_accounts pa ON pa.id=p.payout_account_id JOIN referral_users ru ON ru.id=p.referral_user_id`;
type FraudQueryRow={id:string;referral_id:string;type:FraudType;status:string;detail:unknown;created_at:Date|string;resolved_at:Date|string|null};
const fraudSelect="SELECT f.id,f.referral_id,f.type,f.status::text,f.detail,f.created_at,f.resolved_at FROM fraud_flags f";
type AuditQueryRow={id:string;actor:string;action:string;subject_type:string;subject_id:string|null;before_data:unknown;after_data:unknown;created_at:Date|string};

function mapCampaign(row: Awaited<ReturnType<SqlExecutor["query"]>>["rows"][number] & Record<string, unknown>): CampaignRow { return { id:String(row.id),version:Number(row.version),name:String(row.name),active:Boolean(row.is_active),startsAt:date(row.starts_at as Date|string|null),endsAt:date(row.ends_at as Date|string|null),friendIncentiveMinor:money(row.friend_incentive_minor as string),referrerRewardMinor:money(row.referrer_reward_minor as string),holdingPeriodDays:Number(row.holding_period_days),qualificationEvent:String(row.qualification_event),createdAt:date(row.created_at as Date|string) as Date }; }
function mapReferral(row: ReferralQueryRow): ReferralRow { return {id:row.id,publicAttributionId:row.public_attribution_id,referrerReference:privacyReference(row.patient_reference,"Referrer"),referredReference:privacyReference(row.referred_patient_reference,"Friend"),campaignId:row.campaign_id,campaignVersion:row.campaign_version,friendIncentiveMinor:money(row.friend_incentive_minor),referrerRewardMinor:money(row.referrer_reward_minor),status:row.status,createdAt:date(row.created_at) as Date,qualifiedAt:date(row.qualified_at),payoutStatus:row.payout_status,fraudStatus:row.fraud_status}; }
function mapPayout(row:PayoutQueryRow):PayoutRow{return{id:row.id,referrerReference:privacyReference(row.patient_reference,"Patient"),amountMinor:money(row.amount_minor),status:row.status,accountMask:`•••• ${row.iban_last4}`,requestedAt:date(row.requested_at) as Date,paidAt:date(row.paid_at),availableBalanceMinor:money(row.available_balance)}}
function mapFraud(row:FraudQueryRow):FraudRow{return{id:row.id,referralId:row.referral_id,type:row.type,status:row.status,detail:safeJson(row.detail),createdAt:date(row.created_at) as Date,resolvedAt:date(row.resolved_at)}}
function mapAudit(row:AuditQueryRow):AuditRow{return{id:row.id,actor:row.actor,action:row.action,subjectType:row.subject_type,subjectId:row.subject_id,beforeData:row.before_data?safeJson(row.before_data):null,afterData:row.after_data?safeJson(row.after_data):null,createdAt:date(row.created_at) as Date}}

async function getReferralDetail(id:string,sql:SqlExecutor):Promise<ReferralDetail|null>{
  const base=await sql.query<ReferralQueryRow>(`${referralSelect} WHERE r.id=$1`,[id]); if(!base.rows[0])return null;
  const [events,ledger,flags]=await Promise.all([
    sql.query<{id:string;from_status:string|null;to_status:string;source:string;occurred_at:Date|string}>("SELECT id,from_status::text,to_status::text,source,occurred_at FROM referral_events WHERE referral_id=$1 ORDER BY occurred_at",[id]),
    sql.query<{id:string;type:string;amount_minor:string;status:string;created_at:Date|string}>("SELECT id,type::text,amount_minor::text,status::text,created_at FROM reward_ledger WHERE referral_id=$1 ORDER BY created_at",[id]),
    sql.query<FraudQueryRow>(`${fraudSelect} WHERE f.referral_id=$1 ORDER BY f.created_at`,[id]),
  ]);
  return {...mapReferral(base.rows[0]),events:events.rows.map(row=>({id:row.id,fromStatus:row.from_status,toStatus:row.to_status,source:row.source,occurredAt:date(row.occurred_at) as Date})),ledger:ledger.rows.map(row=>({id:row.id,type:row.type,amountMinor:money(row.amount_minor),status:row.status,createdAt:date(row.created_at) as Date})),flags:flags.rows.map(mapFraud)};
}
