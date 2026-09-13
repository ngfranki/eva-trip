// Supabase Edge Function：trip-ai
// deploy： supabase functions deploy trip-ai --no-verify-jwt
// secrets： supabase secrets set ANTHROPIC_API_KEY=sk-ant-... TRIP_GATE=你嘅暗號
//
// 前端會 POST {intent:'plan'|'extract'|'log', prompt:string}，回 {text:string}。
// API key 淨係喺 server，唔會落到個 HTML 度。

const MODEL = "claude-sonnet-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const gate = Deno.env.get("TRIP_GATE") ?? "";
  if (!gate || req.headers.get("x-client-info") !== gate) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: { intent?: string; prompt?: string };
  try { body = await req.json(); } catch { 
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  const prompt = String(body.prompt ?? "").slice(0, 20000);
  if (!prompt) {
    return new Response(JSON.stringify({ error: "empty prompt" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    return new Response(JSON.stringify({ error: "upstream", status: r.status, detail: detail.slice(0, 500) }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const j = await r.json();
  const text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  return new Response(JSON.stringify({ text }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
