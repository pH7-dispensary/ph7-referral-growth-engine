import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { describe,expect,it } from "vitest";
import { getFounderDashboardData } from "@/lib/admin/data";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";

const enabled=process.env.PH7_LOCAL_ADMIN_INTEGRATION==="true";
describe.skipIf(!enabled)("founder dashboard PostgreSQL read model",()=>{
  it("composes live campaign, snapshots, lifecycle, ledger, payout, fraud and audit without writes",async()=>{
    process.env.REFERRAL_DATABASE_URL=`postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:55473/ph7_release_test`;
    const sql=getPostgresExecutor();const marker=randomUUID();const rollback=new Error("ROLLBACK_ADMIN_FIXTURE");
    try{await sql.transaction(async tx=>{
      await tx.query("UPDATE campaigns SET is_active=false WHERE is_active");
      const campaign=(await tx.query<{id:string}>("INSERT INTO campaigns(version,name,is_active,friend_incentive_minor,referrer_reward_minor,holding_period_days) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM campaigns),$1,true,1500,2000,14) RETURNING id",[`Admin integration ${marker}`])).rows[0];
      const settings=(await tx.query<{version:number}>("INSERT INTO programme_settings(version,programme_enabled,minimum_withdrawal_minor) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM programme_settings),true,1000) RETURNING version")).rows[0];
      const user=(await tx.query<{id:string}>("INSERT INTO referral_users(patient_reference,email_hash) VALUES ($1,'synthetic-admin-hash') RETURNING id",[`synthetic-admin-${marker}`])).rows[0];
      const code=(await tx.query<{id:string}>("INSERT INTO referral_codes(referral_user_id,code) VALUES ($1,$2) RETURNING id",[user.id,`AD${marker.replaceAll("-","").slice(0,10).toUpperCase()}`])).rows[0];
      const attr=(await tx.query<{id:string}>(`INSERT INTO referral_attributions(referral_code_id,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,public_id,journey_context_hash) VALUES ($1,$2,(SELECT version FROM campaigns WHERE id=$2),$3,1500,2000,'EUR','consultation.paid',14,$4,$5) RETURNING id`,[code.id,campaign.id,settings.version,`attr_${marker.replaceAll("-","")}`,marker])).rows[0];
      const referral=(await tx.query<{id:string}>(`INSERT INTO referrals(referrer_user_id,attribution_id,referred_patient_reference,status,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days) VALUES ($1,$2,$3,'QUALIFIED',$4,(SELECT version FROM campaigns WHERE id=$4),$5,1500,2000,'EUR','consultation.paid',14) RETURNING id`,[user.id,attr.id,`synthetic-friend-${marker}`,campaign.id,settings.version])).rows[0];
      await tx.query("INSERT INTO referral_events(referral_id,from_status,to_status,source,idempotency_key) VALUES ($1,'PAID','QUALIFIED','WEBHOOK',$2)",[referral.id,`event-${marker}`]);
      await tx.query("INSERT INTO reward_ledger(referral_user_id,referral_id,type,amount_minor,idempotency_key) VALUES ($1,$2,'CREDIT',2000,$3)",[user.id,referral.id,`credit-${marker}`]);
      const account=(await tx.query<{id:string}>("INSERT INTO payout_accounts(referral_user_id,account_holder_name,iban_encrypted,iban_last4) VALUES ($1,'Synthetic Admin',decode('0001','hex'),'T154') RETURNING id",[user.id])).rows[0];
      await tx.query("INSERT INTO payout_requests(referral_user_id,payout_account_id,amount_minor,idempotency_key) VALUES ($1,$2,1000,$3)",[user.id,account.id,`payout-${marker}`]);
      await tx.query("INSERT INTO fraud_flags(referral_id,type,detail) VALUES ($1,'MANUAL_FLAG',$2::jsonb)",[referral.id,JSON.stringify({reason:"Synthetic integration evidence",secret:"must be hidden"})]);
      const admin=(await tx.query<{id:string}>("INSERT INTO admin_users(email_hash,role) VALUES ($1,'FOUNDER') RETURNING id",[`synthetic-admin-${marker}`])).rows[0];
      await tx.query("INSERT INTO admin_audit_log(admin_user_id,action,subject_type,subject_id,before_data,after_data) VALUES ($1,'PROGRAMME_UPDATED','campaign',$2,$3::jsonb,$4::jsonb)",[admin.id,campaign.id,JSON.stringify({friendIncentiveMinor:1000}),JSON.stringify({friendIncentiveMinor:1500,secret:"hidden"})]);
      const data=await getFounderDashboardData({referralId:referral.id},tx);
      expect(data.activeCampaign).toMatchObject({friendIncentiveMinor:1500,referrerRewardMinor:2000});
      expect(data.selectedReferral?.ledger).toHaveLength(1);expect(data.selectedReferral?.events[0].toStatus).toBe("QUALIFIED");
      expect(data.payouts.find(row=>row.accountMask==="•••• T154")?.status).toBe("REQUESTED");
      expect(data.fraudFlags[0].detail).toEqual({reason:"Synthetic integration evidence"});
      expect(data.audit[0].afterData).toEqual({friendIncentiveMinor:1500});
      throw rollback;
    });}catch(error){if(error!==rollback)throw error;}finally{await resetPostgresExecutorForTest();}
  });
});
