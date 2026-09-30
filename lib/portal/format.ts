import { toMinorUnits } from "@/lib/portal/money";

export function formatEuro(minor: number): string {
  const amount = toMinorUnits(minor, "euro amount");
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}
