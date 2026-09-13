// trip-ai — eva-trip AI 代理 (Supabase Edge Function)
// 目的：OpenRouter key 留喺伺服器；瀏覽器只帶 x-client-info 暗號。
// secrets（同 meal-vision 共用，唔使另外加）：OPENROUTER_API_KEY、MEAL_KEY
// intent=plan／extract → 出 JSON 行程；intent=log → 出日誌散文
const OR = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const key = Deno.env.get("MEAL_KEY") ?? "";
  if (!key || req.headers.get("x-client-info") !== key) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const intent: string = body.intent ?? "plan";
  const prompt: string = String(body.prompt ?? "").slice(0, 20000);
  if (!prompt) {
    return new Response(JSON.stringify({ error: "empty prompt" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const system = intent === "log"
    ? "你係旅程日誌寫手。用書面中文（香港用詞），平實唔誇張，只可以照住用家俾嘅事實寫，唔准作嘢。只回覆日誌本身。"
    : "你係旅程規劃助手。只可以回覆一個 JSON object，唔准有 markdown code fence、唔准有任何解釋文字。";

  const r = await fetch(OR, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    return new Response(JSON.stringify({ error: "upstream", status: r.status, detail: detail.slice(0, 500) }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content ?? "";
  return new Response(JSON.stringify({ text }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
