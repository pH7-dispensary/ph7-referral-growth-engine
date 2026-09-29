import "server-only";

import type { StoredSession } from "@/lib/auth/types";

/** Pure policy check shared by pages and action composition. */
export function hasAdminAccess(session: StoredSession | null): session is StoredSession & { kind: "ADMIN"; adminUserId: string; adminRole: "FOUNDER" | "ADMIN" } {
  return session !== null && session.kind === "ADMIN" && (session.adminRole === "FOUNDER" || session.adminRole === "ADMIN");
}

export function hasPatientAccess(session: StoredSession | null): session is StoredSession & { kind: "PATIENT"; referralUserId: string } {
  return session !== null && session.kind === "PATIENT";
}
