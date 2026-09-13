// trip-ai — eva-trip AI 代理 (Supabase Edge Function)
// 目的：OpenRouter key 留喺伺服器；瀏覽器只帶 x-client-info 暗號。
// secrets（同 meal-vision 共用，唔使另外加）：OPENROUTER_API_KEY、MEAL_KEY
//
// 兩種用法：
//   {intent:'plan'|'extract'|'log', prompt:string}   一次過（第一浪嗰啲）
//   {messages:[{role,content}...]}                   對話（AI 助手）
// 兩種都回 {text:string}
const OR = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const key = Deno.env.get("MEAL_KEY") ?? "";
  if (!key || req.headers.get("x-client-info") !== key) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));

  let messages: Array<{ role: string; content: string }>;
  let maxTokens = 4000;

  if (Array.isArray(body.messages) && body.messages.length) {
    // 對話模式：client 自己砌晒（包 system）。限返長度免爆。
    messages = body.messages
      .filter((m: any) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(m.role))
      .slice(-24)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 24000) }));
    if (!messages.length) return json({ error: "empty messages" }, 400);
  } else {
    const prompt = String(body.prompt ?? "").slice(0, 20000);
    if (!prompt) return json({ error: "empty prompt" }, 400);
    const intent = String(body.intent ?? "plan");
    const system = intent === "log"
      ? "你係旅程日誌寫手。用書面中文（香港用詞），平實唔誇張，只可以照住用家俾嘅事實寫，唔准作嘢。只回覆日誌本身。"
      : "你係旅程規劃助手。只可以回覆一個 JSON object，唔准有 markdown code fence、唔准有任何解釋文字。";
    messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
  }

  const r = await fetch(OR, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
  });

  if (!r.ok) {
    const detail = await r.text();
    return json({ error: "upstream", status: r.status, detail: detail.slice(0, 500) }, 502);
  }

  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content ?? "";
  return json({ text });
});
