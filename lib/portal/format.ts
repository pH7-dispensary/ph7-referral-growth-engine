import { toMinorUnits } from "@/lib/portal/money";

export function formatEuro(minor: number): string {
  const amount = toMinorUnits(minor, "euro amount");
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
