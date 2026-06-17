export function normalizeMemberPhone(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;

  let digits = raw.replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+/, "").replace(/\D/g, "");

  if (!digits) return null;
  if (digits.startsWith("00855")) digits = digits.slice(2);
  if (digits.startsWith("855")) return digits;

  if (digits.startsWith("0")) {
    const withoutLeadingZero = digits.replace(/^0+/, "");
    return withoutLeadingZero ? `855${withoutLeadingZero}` : null;
  }

  if (digits.length >= 8 && digits.length <= 10) {
    return `855${digits}`;
  }

  return digits;
}
