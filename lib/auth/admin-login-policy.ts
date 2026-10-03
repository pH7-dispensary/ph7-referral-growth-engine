import "server-only";
import type { SqlExecutor } from "@/lib/persistence/postgres";

const loginSubject = "00000000-0000-4000-8000-000000000001";
export function adminLoginOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (process.env.NODE_ENV === "production") return origin === "https://refer.ph7.health";
  try { const url = new URL(origin); return url.origin === new URL(request.url).origin && ["localhost", "127.0.0.1"].includes(url.hostname); } catch { return false; }
}
/** Durable global throttle for the sole founder. No IP, email or password in audit data. */
export async function claimAdminLoginAttempt(sql: SqlExecutor, subjectId = loginSubject): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sql.transaction(async tx => {
        await tx.query("SELECT pg_advisory_xact_lock(11830115)");
        const count = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM admin_audit_log WHERE subject_type='ADMIN_LOGIN' AND subject_id=$1 AND action='admin.login.attempt' AND created_at > now() - interval '15 minutes'", [subjectId]);
        if (Number(count.rows[0]?.count ?? 0) >= 12) return false;
        await tx.query("INSERT INTO admin_audit_log (action,subject_type,subject_id) VALUES ('admin.login.attempt','ADMIN_LOGIN',$1)", [subjectId]);
        return true;
      });
    } catch (error) {
      if (attempt === 2 || !["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw new Error("Sign-in unavailable.");
    }
  }
  return false;
}
