export function toMinorUnits(value: unknown, label = "money amount"): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return value;
  } else if (typeof value === "bigint") {
    const numeric = Number(value);
    if (BigInt(numeric) === value && Number.isSafeInteger(numeric)) return numeric;
  } else if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  throw new Error(`${label} must be a safe integer minor-unit value.`);
}

export function sumMinorUnits(values: Iterable<unknown>, label = "money amount"): number {
  let total = 0;
  for (const value of values) total += toMinorUnits(value, label);
  if (!Number.isSafeInteger(total)) throw new Error(`${label} sum exceeds the safe integer range.`);
  return total;
}
