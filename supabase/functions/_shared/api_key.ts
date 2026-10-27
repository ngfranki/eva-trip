// Legacy service_role lives in SUPABASE_SERVICE_ROLE_KEY (a JWT Supabase injects,
// and removes when legacy JWT keys are disabled). The replacement is
// SUPABASE_SECRET_KEYS: a JSON object of name → sb_secret_… . The key created
// in the dashboard is named "default".
//
// sb_* keys are not JWTs. Send them on the apikey header only. Putting one in
// Authorization: Bearer makes the gateway try to parse it as a JWT.

export function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const bag = parsed as Record<string, unknown>;
        const named = bag.default;
        if (typeof named === "string" && named) return named;
        for (const v of Object.values(bag)) {
          if (typeof v === "string" && v.startsWith("sb_")) return v;
        }
      }
    } catch {
      if (raw.startsWith("sb_")) return raw;
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

export function restHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  return headers;
}
