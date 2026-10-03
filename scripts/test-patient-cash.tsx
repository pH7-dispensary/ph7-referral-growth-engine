import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";
import { PostgresOperationalRepository } from "@/lib/persistence/operations-postgres";
import { getPostgresPatientPortalData } from "@/lib/portal/postgres-data";
import { requestPatientCashPayout } from "@/lib/portal/patient-payout";
import { decryptPayoutIban, encryptPayoutIban } from "@/lib/portal/payout-encryption";
import type { StoredSession } from "@/lib/auth/types";
import { PortalDashboard } from "@/components/portal/portal-dashboard";
import { renderToStaticMarkup } from "react-dom/server";

// Intentionally no dotenv loading. This harness can ONLY use the disposable local database.
process.env.REFERRAL_DATABASE_URL = `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:55473/ph7_release_test`;
process.env.PAYOUT_DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
let stage = "local-identity";
export async function testPatientCashIntegration() {
  let sql = getPostgresExecutor();
  assert.equal((await sql.query<{name:string}>("SELECT current_database() AS name")).rows[0].name,"ph7_release_test");
  let repo = new PostgresOperationalRepository(sql);
  await sql.query("INSERT INTO programme_settings(version,programme_enabled,minimum_withdrawal_minor) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM programme_settings),true,1000)");
  const marker=`synthetic-cash-${randomUUID()}`;
  const user = (await sql.query<{id:string}>("INSERT INTO referral_users(patient_reference,email_hash) VALUES ($1,'synthetic-cash-hash') RETURNING id",[marker])).rows[0].id;
  const other = (await sql.query<{id:string}>("INSERT INTO referral_users(patient_reference,email_hash) VALUES ($1,'synthetic-other-hash') RETURNING id",[`${marker}-other`])).rows[0].id;
  const code = `CA${randomUUID().replaceAll("-","").slice(0,10).toUpperCase()}`;
  const codeId=(await sql.query<{id:string}>("INSERT INTO referral_codes(referral_user_id,code) VALUES ($1,$2) RETURNING id",[user,code])).rows[0].id;
  await sql.query("INSERT INTO referral_codes(referral_user_id,code) VALUES ($1,$2)",[other,`OT${randomUUID().replaceAll("-","").slice(0,10).toUpperCase()}`]);
  const session:StoredSession={kind:"PATIENT",referralUserId:user,id:randomUUID(),tokenHash:"synthetic",csrfTokenHash:"synthetic",expiresAt:new Date(Date.now()+60_000),invalidatedAt:null};
  async function credit(amount:number) {
    const offer=(await sql.query<{id:string;version:number;friend_incentive_minor:string;referrer_reward_minor:string}>("SELECT id,version,friend_incentive_minor,referrer_reward_minor FROM campaigns WHERE is_active")).rows[0];
    const version=(await sql.query<{version:number}>("SELECT version FROM programme_settings ORDER BY version DESC LIMIT 1")).rows[0].version;
    const publicId=`attr_${randomUUID().replaceAll("-","")}`;
    const attr=(await sql.query<{id:string}>(`INSERT INTO referral_attributions(referral_code_id,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,public_id,journey_context_hash)
      VALUES ($1,$2,$3,$4,$5,$6,'EUR','consultation.paid',0,$7,$8) RETURNING id`,[codeId,offer.id,offer.version,version,offer.friend_incentive_minor,offer.referrer_reward_minor,publicId,randomUUID()])).rows[0].id;
    const ref=(await sql.query<{id:string}>(`INSERT INTO referrals(referrer_user_id,attribution_id,status,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days)
      VALUES ($1,$2,'PAYABLE',$3,$4,$5,$6,$7,'EUR','consultation.paid',0) RETURNING id`,[user,attr,offer.id,offer.version,version,offer.friend_incentive_minor,offer.referrer_reward_minor])).rows[0].id;
    await sql.query("INSERT INTO reward_ledger(referral_user_id,referral_id,type,amount_minor,idempotency_key) VALUES ($1,$2,'CREDIT',$3,$4)",[user,ref,amount,randomUUID()]);
    return ref;
  }
  stage="dynamic-offer-history";
  await repo.setCampaign({friendIncentiveMinor:1000,referrerRewardMinor:1000,active:true,holdingPeriodDays:0});
  const historical=await credit(1000);
  let data=await getPostgresPatientPortalData(sql,user); assert(data);
  assert(renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg/>"/>).includes("Get €10 cash."));
  await repo.setCampaign({friendIncentiveMinor:1500,referrerRewardMinor:2000,active:true,holdingPeriodDays:0});
  const newer=await credit(2000);
  data=await getPostgresPatientPortalData(sql,user); assert(data);
  const html=renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg/>"/>);
  assert(html.includes("Give €15.")&&html.includes("Get €20 cash."));
  assert.equal(data.minimumWithdrawalMinor,1000); assert.equal(data.availableBalanceMinor,3000);
  assert.equal(data.referrals.find(r=>r.id===historical)?.economics.referrerRewardMinor,1000);
  await assert.rejects(sql.transaction(async tx=>{await tx.query("UPDATE referrals SET referrer_reward_minor=9999 WHERE id=$1",[historical]);}));
  function form(amount:number,key=randomUUID(),account?:string) {
    const f=new FormData(); f.set("requestKey",key);f.set("amountMinor",String(amount));
    f.set("referralUserId",other); // Deliberate attempted identity override: must be ignored.
    if(account)f.set("payoutAccountId",account); else {f.set("accountHolderName","Synthetic Cash Test");f.set("iban","GB82 WEST 1234 5698 7654 32");}
    return f;
  }
  stage="payout-validation-and-duplicates";
  await assert.rejects(requestPatientCashPayout(sql,null,form(1000)));
  await assert.rejects(requestPatientCashPayout(sql,session,form(500)));
  await assert.rejects(requestPatientCashPayout(sql,session,form(4000)));
  const foreignAccount=(await sql.query<{id:string}>("INSERT INTO payout_accounts(referral_user_id,account_holder_name,iban_encrypted,iban_last4) VALUES ($1,'Synthetic Other',$2,'3000') RETURNING id",[other,encryptPayoutIban("DE89370400440532013000",other)])).rows[0].id;
  // This owner has sufficient cash: rejection must come from account ownership.
  await assert.rejects(requestPatientCashPayout(sql,session,form(1000,randomUUID(),foreignAccount)));
  const flag=await repo.flagFraud(historical,"MANUAL_FLAG");
  await assert.rejects(requestPatientCashPayout(sql,session,form(1000)));
  await repo.resolveFraud(flag.id,"APPROVED");
  const duplicate=form(1000);
  const requests=await Promise.all([requestPatientCashPayout(sql,session,duplicate),requestPatientCashPayout(sql,session,duplicate)]);
  assert.equal(requests[0].id,requests[1].id);
  assert.equal((await sql.query<{count:string}>("SELECT count(*) FROM payout_accounts WHERE referral_user_id=$1",[user])).rows[0].count,"1");
  let account=(await sql.query<{id:string;iban_encrypted:Buffer}>("SELECT id,iban_encrypted FROM payout_accounts WHERE referral_user_id=$1",[user])).rows[0];
  assert.equal(decryptPayoutIban(account.iban_encrypted,user),"GB82WEST12345698765432");
  assert(!account.iban_encrypted.includes(Buffer.from("GB82")));
  await assert.rejects(requestPatientCashPayout(sql,{...session,referralUserId:other},form(1000,randomUUID(),account.id)));
  assert.equal((await getPostgresPatientPortalData(sql,user))?.withdrawableBalanceMinor,2000);
  stage="concurrent-reservations";
  const updatedBankA=form(2000),updatedBankB=form(2000);
  updatedBankA.set("iban","DE89 3704 0044 0532 0130 00");updatedBankB.set("iban","DE89 3704 0044 0532 0130 00");
  const competing=await Promise.allSettled([requestPatientCashPayout(sql,session,updatedBankA),requestPatientCashPayout(sql,session,updatedBankB)]);
  assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await sql.query<{count:string}>("SELECT count(*) FROM payout_accounts WHERE referral_user_id=$1",[user])).rows[0].count,"2");
  assert.equal((await getPostgresPatientPortalData(sql,user))?.withdrawableBalanceMinor,0);
  stage="restart-persistence";
  await resetPostgresExecutorForTest();sql=getPostgresExecutor();repo=new PostgresOperationalRepository(sql);
  data=await getPostgresPatientPortalData(sql,user); assert(data);assert.equal(data.payouts.length,2);assert.equal(data.payoutAccount?.accountMask,"•••• 3000");
  assert.equal(data.payouts.find(p=>p.id===requests[0].id)?.accountMask,"•••• 5432");
  assert.equal(data.withdrawableBalanceMinor,0);
  const otherData=await getPostgresPatientPortalData(sql,other);assert(otherData);assert.deepEqual(otherData.payouts,[]);assert.equal(otherData.payoutAccount?.id,foreignAccount);assert.notEqual(otherData.payoutAccount?.id,data.payoutAccount?.id);
  stage="concurrent-paid-debit";
  const lateFlag=await repo.flagFraud(newer,"MANUAL_FLAG");
  await assert.rejects(repo.markPayoutPaid(requests[0].id,`${marker}:review-paid`));
  await repo.resolveFraud(lateFlag.id,"APPROVED");
  const usedKey=(await sql.query<{idempotency_key:string}>("SELECT idempotency_key FROM reward_ledger WHERE referral_id=$1 LIMIT 1",[historical])).rows[0].idempotency_key;
  await assert.rejects(repo.markPayoutPaid(requests[0].id,usedKey));
  assert.equal((await sql.query<{status:string}>("SELECT status FROM payout_requests WHERE id=$1",[requests[0].id])).rows[0].status,"REQUESTED");
  const paid=await Promise.all([repo.markPayoutPaid(requests[0].id,`${marker}:paid`),repo.markPayoutPaid(requests[0].id,`${marker}:paid`)]);
  assert(paid.every(p=>p.status==="PAID"));
  assert.equal((await sql.query<{count:string}>("SELECT count(*) FROM reward_ledger WHERE payout_request_id=$1",[requests[0].id])).rows[0].count,"1");
  await resetPostgresExecutorForTest();sql=getPostgresExecutor();repo=new PostgresOperationalRepository(sql);
  assert.equal((await getPostgresPatientPortalData(sql,user))?.payouts.find(p=>p.id===requests[0].id)?.status,"PAID");
  stage="refund-idempotency";
  const publicId=(await sql.query<{public_id:string}>("SELECT a.public_id FROM referral_attributions a JOIN referrals r ON r.attribution_id=a.id WHERE r.id=$1",[newer])).rows[0].public_id;
  const refund={eventId:`${marker}:refund`,eventType:"consultation.refunded" as const,attributionPublicId:publicId};
  await repo.processWebhook(refund);assert.equal((await repo.processWebhook(refund)).duplicate,true);
  assert.equal((await sql.query<{count:string}>("SELECT count(*) FROM reward_ledger WHERE referral_id=$1 AND type='REVERSAL'",[newer])).rows[0].count,"1");
  await assert.rejects(repo.markPayoutPaid(data.payouts.find(p=>p.id!==requests[0].id)!.id,`${marker}:second-paid`));
  assert.equal((await getPostgresPatientPortalData(sql,user))?.availableBalanceMinor,0);
  console.log("Patient cash integration passed: dynamic offers, immutable snapshots, ledger balances, encrypted bank details, patient scoping, reservations, duplicate/concurrent requests, restart persistence, one payout debit and idempotent reversal. Fixtures exist ONLY in the disposable loopback database.");
}
if (!process.env.VITEST) testPatientCashIntegration().catch(()=>{console.error(`Patient cash integration failed at ${stage}; diagnostics redacted.`);process.exitCode=1;}).finally(resetPostgresExecutorForTest);
