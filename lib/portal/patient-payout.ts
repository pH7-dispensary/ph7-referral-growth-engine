import "server-only";
import { hasPatientAccess } from "@/lib/auth/authorization";
import type { StoredSession } from "@/lib/auth/types";
import type { SqlExecutor } from "@/lib/persistence/postgres";
import { PostgresOperationalRepository } from "@/lib/persistence/operations-postgres";
import { isValidIban, normaliseIban } from "@/lib/portal/payout";
import { encryptPayoutIban, payoutStorageConfigured } from "@/lib/portal/payout-encryption";

/** Called only after the action verifies the session and its CSRF token. */
export async function requestPatientCashPayout(sql: SqlExecutor, session: StoredSession | null, form: FormData) {
  if (!hasPatientAccess(session)) throw new Error("Patient authorisation is required.");
  if (!payoutStorageConfigured()) throw new Error("Secure payout storage is unavailable.");
  const amountMinor = Number(form.get("amountMinor"));
  const key = form.get("requestKey");
  if (typeof key !== "string" || !/^[a-f0-9-]{36}$/.test(key) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Invalid withdrawal request.");
  const referralUserId = session.referralUserId;
  const payoutAccountId = form.get("payoutAccountId");
  const base = { referralUserId, amountMinor, idempotencyKey: `patient:payout:${referralUserId}:${key}`, enforceProgrammeRules: true };
  if (typeof payoutAccountId === "string" && payoutAccountId) {
    if (!/^[a-f0-9-]{36}$/.test(payoutAccountId)) throw new Error("Invalid payout account.");
    return new PostgresOperationalRepository(sql).requestPayout({ ...base, payoutAccountId });
  }
  const holder = form.get("accountHolderName");
  const rawIban = form.get("iban");
  if (typeof holder !== "string" || holder.trim().length < 2 || holder.trim().length > 120 || typeof rawIban !== "string" || rawIban.length > 80 || !isValidIban(rawIban)) throw new Error("Invalid bank details.");
  const iban = normaliseIban(rawIban);
  return new PostgresOperationalRepository(sql).requestPayout({ ...base, bankDetails: {
    accountHolderName: holder.trim(), ibanEncrypted: encryptPayoutIban(iban, referralUserId), ibanLast4: iban.slice(-4),
  } });
}
