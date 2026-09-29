import { z } from "zod";

const ibanPattern = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

function ibanMod97(value: string): number {
  let remainder = 0;
  for (const character of value) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

export function normaliseIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isValidIban(value: string): boolean {
  const iban = normaliseIban(value);
  return ibanPattern.test(iban) && ibanMod97(`${iban.slice(4)}${iban.slice(0, 4)}`) === 1;
}

export function maskIban(value: string): string {
  const iban = normaliseIban(value);
  return iban.length >= 4 ? `•••• ${iban.slice(-4)}` : "••••";
}

export const payoutRequestSchema = z.object({
  accountHolderName: z.string().trim().min(2).max(120),
  iban: z.string().transform(normaliseIban).refine(isValidIban, "Enter a valid IBAN."),
  amountMinor: z.number().int().positive(),
  availableBalanceMinor: z.number().int().nonnegative(),
  minimumWithdrawalMinor: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.amountMinor < value.minimumWithdrawalMinor) {
    context.addIssue({ code: "custom", path: ["amountMinor"], message: "Amount is below the withdrawal minimum." });
  }
  if (value.amountMinor > value.availableBalanceMinor) {
    context.addIssue({ code: "custom", path: ["amountMinor"], message: "Amount exceeds the available balance." });
  }
});

export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;
