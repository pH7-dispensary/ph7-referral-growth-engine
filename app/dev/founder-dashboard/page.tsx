import { notFound } from "next/navigation";
import { FounderDashboard } from "@/components/admin/founder-dashboard";
import type { FounderDashboardData, FounderSection } from "@/lib/admin/data";

export const dynamic="force-dynamic";
const now=new Date("2026-10-03T12:00:00.000Z");
const old=new Date("2026-09-18T09:30:00.000Z");
const campaign={id:"11111111-1111-4111-8111-111111111111",version:4,name:"Autumn referral programme",active:true,startsAt:new Date("2026-10-01T00:00:00.000Z"),endsAt:null,friendIncentiveMinor:1500,referrerRewardMinor:2000,holdingPeriodDays:14,qualificationEvent:"consultation.paid",createdAt:now};
const previous={...campaign,id:"55555555-5555-4555-8555-555555555555",version:3,name:"Launch referral programme",active:false,friendIncentiveMinor:1000,referrerRewardMinor:1000,createdAt:old};
const referrals:FounderDashboardData["referrals"]=[
  {id:"22222222-2222-4222-8222-222222222222",publicAttributionId:"attr_5f9211ea66724119bf792c87",referrerReference:"Referrer •••004218",referredReference:"Friend •••092771",campaignId:campaign.id,campaignVersion:4,friendIncentiveMinor:1500,referrerRewardMinor:2000,status:"QUALIFIED",createdAt:now,qualifiedAt:now,payoutStatus:null,fraudStatus:null},
  {id:"66666666-6666-4666-8666-666666666666",publicAttributionId:"attr_24b816833bbe49938f0891a1",referrerReference:"Referrer •••007129",referredReference:"Friend •••086341",campaignId:previous.id,campaignVersion:3,friendIncentiveMinor:1000,referrerRewardMinor:1000,status:"BOOKED",createdAt:old,qualifiedAt:null,payoutStatus:null,fraudStatus:"OPEN"},
  {id:"77777777-7777-4777-8777-777777777777",publicAttributionId:"attr_99a621833bbe49938f0712ab",referrerReference:"Referrer •••003518",referredReference:"Friend •••015226",campaignId:campaign.id,campaignVersion:4,friendIncentiveMinor:1500,referrerRewardMinor:2000,status:"ATTRIBUTED",createdAt:new Date("2026-10-02T11:15:00Z"),qualifiedAt:null,payoutStatus:null,fraudStatus:null},
];
const data:FounderDashboardData={overview:{totalReferrals:38,newReferrals:12,previousNewReferrals:8,qualifiedReferrals:14,conversionRate:14/38,pendingRewardsMinor:6000,availableRewardsMinor:12400,paidOutMinor:18600,outstandingPayouts:2,openFraudFlags:1},programme:{enabled:true,minimumWithdrawalMinor:1000},activeCampaign:campaign,campaigns:[campaign,previous],referrals,referralCount:38,referralPage:1,referralPages:2,selectedReferral:{...referrals[0],events:[{id:"event-1",fromStatus:"PAID",toStatus:"QUALIFIED",source:"WEBHOOK",occurredAt:now}],ledger:[{id:"ledger-1",type:"CREDIT",amountMinor:2000,status:"EFFECTIVE",createdAt:now}],flags:[]},payouts:[{id:"33333333-3333-4333-8333-333333333333",referrerReference:"Patient •••004218",amountMinor:2000,status:"REQUESTED",accountMask:"•••• 7631",requestedAt:now,paidAt:null,availableBalanceMinor:4000},{id:"88888888-8888-4888-8888-888888888888",referrerReference:"Patient •••003518",amountMinor:1000,status:"PAID",accountMask:"•••• 2084",requestedAt:old,paidAt:new Date("2026-09-19T10:00:00Z"),availableBalanceMinor:0}],fraudFlags:[{id:"44444444-4444-4444-8444-444444444444",referralId:referrals[1].id,type:"DUPLICATE_REFERRED_USER",status:"OPEN",detail:{reason:"Duplicate referred-user reference"},createdAt:old,resolvedAt:null}],audit:[{id:"audit-1",actor:"Founder",action:"PROGRAMME_UPDATED",subjectType:"campaign",subjectId:campaign.id,beforeData:{version:3,friendIncentiveMinor:1000,referrerRewardMinor:1000},afterData:{version:4,friendIncentiveMinor:1500,referrerRewardMinor:2000},createdAt:now},{id:"audit-2",actor:"Founder",action:"PAYOUT_PAID",subjectType:"payout_request",subjectId:"88888888-8888-4888-8888-888888888888",beforeData:null,afterData:null,createdAt:old}],recentReferrals:referrals,recentPayouts:[]};

export default async function FounderDashboardReview({searchParams}:{searchParams:Promise<{tab?:string}>}){
  if(process.env.NODE_ENV!=="development")notFound();
  const {tab}=await searchParams;const section=(["overview","campaigns","referrals","payouts","fraud","audit"].includes(tab??"")?tab:"overview") as FounderSection;
  return <FounderDashboard data={data} tab={section} csrfToken="development-review-only" filters={{}}/>;
}
