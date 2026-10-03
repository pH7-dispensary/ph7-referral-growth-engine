import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { claimAdminLoginAttempt } from "@/lib/auth/admin-login-policy";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";
import { PostgresAuthRepository } from "@/lib/auth/postgres";
import { ReferralSessionService } from "@/lib/auth/session";

it.skipIf(process.env.PH7_LOCAL_ADMIN_INTEGRATION !== "true")("persists bounded concurrent login claims and founder sessions across pool restart", async () => {
  process.env.REFERRAL_DATABASE_URL=`postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:55473/ph7_release_test`;
  let sql=getPostgresExecutor();
  expect((await sql.query<{name:string}>("SELECT current_database() AS name")).rows[0].name).toBe("ph7_release_test");
  const subject=randomUUID();
  // Only the test supplies its isolated namespace; the HTTP route never accepts one.
  const concurrent=await Promise.allSettled(Array.from({length:16},()=>claimAdminLoginAttempt(sql,subject)));
  expect(concurrent.filter(x=>x.status==="fulfilled"&&x.value).length).toBeLessThanOrEqual(12);
  for(let n=0;n<12;n++)await claimAdminLoginAttempt(sql,subject);
  expect(await claimAdminLoginAttempt(sql,subject)).toBe(false);
  expect((await sql.query<{count:string}>("SELECT count(*)::text AS count FROM admin_audit_log WHERE subject_type='ADMIN_LOGIN' AND subject_id=$1",[subject])).rows[0].count).toBe("12");
  const options={adminSessionSecret:"synthetic-admin-secret".repeat(3),patientSessionSecret:"synthetic-patient-secret".repeat(3),handoffVerifier:{verify:async()=>{throw new Error("Not used for admin login");}}};
  const service=new ReferralSessionService(new PostgresAuthRepository(sql),options);
  const session=await service.beginAdminSession({emailHash:randomUUID().replaceAll("-","").repeat(2),role:"FOUNDER"});
  await resetPostgresExecutorForTest(); sql=getPostgresExecutor();
  expect(await claimAdminLoginAttempt(sql,subject)).toBe(false);
  const fresh=new ReferralSessionService(new PostgresAuthRepository(sql),options);
  expect(await fresh.readAdminSession(session.token)).toMatchObject({kind:"ADMIN",adminRole:"FOUNDER"});
  expect(await fresh.readPatientSession(session.token)).toBeNull();
  await fresh.endAdminSession(session.token);
  expect(await fresh.readAdminSession(session.token)).toBeNull();
  await resetPostgresExecutorForTest();
},30_000);
