import "server-only";
import { getLocalReferralEngine } from "@/lib/local/engine";
export const behaviouralEvents = ["referral_portal_view", "referral_share_clicked", "referral_link_copied", "referral_qr_viewed", "referral_landing_view", "referral_cta_clicked", "referral_registered", "referral_booked", "referral_paid", "referral_qualified", "withdrawal_started", "withdrawal_requested"] as const;
export type BehaviouralEvent = (typeof behaviouralEvents)[number];
export interface AnalyticsAdapter { emit(name: BehaviouralEvent, context?: Record<string, string>): void; }
export const localAnalytics: AnalyticsAdapter = { emit(name, context = {}) { getLocalReferralEngine().recordAnalytics(name, context); } };
