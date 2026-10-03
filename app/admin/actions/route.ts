import { NextResponse } from "next/server";
import { adminLoginOriginAllowed } from "@/lib/auth/admin-login-policy";
import { assertSessionCsrf, currentAdminSession } from "@/lib/auth/server";
import { hasAdminAccess } from "@/lib/auth/authorization";
import { createFraudFlag, markPayoutPaid, resolveFraudFlag, saveCampaign } from "@/lib/runtime/production-actions";
import type { FraudDecision, FraudType } from "@/lib/persistence/operations-postgres";

export const runtime = "nodejs";
const fraudTypes = new Set<FraudType>(["SELF_REFERRAL","DUPLICATE_REFERRED_USER","SAME_DEVICE","SUSPICIOUS_IP","HIGH_VELOCITY","REFUNDED_CONSULTATION","DUPLICATE_PAYMENT_EVENT","MANUAL_FLAG"]);
const fraudDecisions = new Set<FraudDecision>(["APPROVED","REJECTED","INVESTIGATING"]);
function destination(path:string){return new URL(path,process.env.NODE_ENV==="production"?"https://refer.ph7.health":"http://localhost:3000")}
function integer(form:FormData,name:string,min:number,max:number){const value=Number(form.get(name));if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error("Invalid value.");return value}
function uuid(value:FormDataEntryValue|null){const text=typeof value==="string"?value:"";if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text))throw new Error("Invalid reference.");return text}

export async function POST(request:Request){
  try{
    if(!adminLoginOriginAllowed(request)||Number(request.headers.get("content-length")??0)>8192)throw new Error("Rejected");
    const session=await currentAdminSession(); if(!hasAdminAccess(session))throw new Error("Rejected");
    const form=await request.formData(); const csrf=form.get("csrfToken"); assertSessionCsrf("ADMIN",session,typeof csrf==="string"?csrf:undefined);
    const actor={adminUserId:session.adminUserId,role:session.adminRole??null}; const action=String(form.get("action")??"");
    if(action==="campaign.save"){
      if(form.get("confirmation")!=="SAVE_CAMPAIGN")throw new Error("Confirmation required.");
      await saveCampaign(actor,{friendIncentiveMinor:integer(form,"friendIncentiveMinor",0,100000000),referrerRewardMinor:integer(form,"referrerRewardMinor",0,100000000),holdingPeriodDays:integer(form,"holdingPeriodDays",0,3650),active:form.get("active")==="true"});
      return NextResponse.redirect(destination("/admin?tab=campaigns&result=campaign-saved"),{status:303});
    }
    if(action==="payout.paid"){
      if(form.get("confirmation")!=="MARK_PAID")throw new Error("Confirmation required."); const payoutId=uuid(form.get("payoutId"));
      await markPayoutPaid(actor,payoutId,`admin:payout:paid:${payoutId}`); return NextResponse.redirect(destination("/admin?tab=payouts&result=payout-paid"),{status:303});
    }
    if(action==="fraud.flag"){
      const referralId=uuid(form.get("referralId")); const type=String(form.get("type")) as FraudType; if(!fraudTypes.has(type))throw new Error("Invalid fraud type.");
      await createFraudFlag(actor,referralId,type); return NextResponse.redirect(destination("/admin?tab=fraud&result=flag-created"),{status:303});
    }
    if(action==="fraud.resolve"){
      if(form.get("confirmation")!=="RESOLVE_FLAG")throw new Error("Confirmation required."); const flagId=uuid(form.get("flagId")); const decision=String(form.get("decision")) as FraudDecision; if(!fraudDecisions.has(decision))throw new Error("Invalid fraud decision.");
      await resolveFraudFlag(actor,flagId,decision); return NextResponse.redirect(destination("/admin?tab=fraud&result=flag-resolved"),{status:303});
    }
    throw new Error("Unknown action.");
  }catch{return NextResponse.redirect(destination("/admin?error=operation-failed"),{status:303,headers:{"Cache-Control":"no-store"}})}
}
