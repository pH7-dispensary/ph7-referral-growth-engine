export async function readHandoffToken(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  let token: unknown;
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null) as { token?: unknown } | null;
    token = body?.token;
  } else {
    const form = await request.formData().catch(() => null);
    token = form?.get("token");
  }
  if (typeof token !== "string" || token.length < 16 || token.length > 8_192) throw new Error("Rejected hand-off.");
  return token;
}
