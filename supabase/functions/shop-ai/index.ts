// shop-ai — the only two AI jobs in the shop app.
//   mode "part":    read a part number / brand off a PART photo the tech chose to send. Nothing else.
//   mode "cleanup": tidy a tech's talked note (spelling, punctuation) without adding facts.
// Regular progress photos never come here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PART_PROMPT = `You read photos of auto parts, part boxes, labels, tags and stamped numbers for a custom car shop.

Return ONLY a JSON object:
{"found": true|false, "part_number": "...", "brand": "...", "description": "..."}

Rules:
- Copy the part number EXACTLY as printed (keep dashes, letters, spacing). Never guess a digit you cannot read.
- brand = the manufacturer printed on the part or box (e.g. "NGK", "King Shocks", "Fox", "Yukon"). Omit if not printed.
- description = a short plain name of the part as a shop would write it on an invoice (e.g. "Spark plug, iridium", "2.5 in coilover shock"). Use only what is printed or obvious from the part itself.
- If you cannot read a part number or serial number anywhere in the photo, return {"found": false}.
- No markdown, no explanation, JSON only.`;

const CLEANUP_PROMPT = `You clean up a note a mechanic dictated into his phone at a custom car shop.
Fix spelling, punctuation, capitalization and obvious speech-to-text mistakes (car and parts terms included).
Do not add any facts, opinions, recommendations or details that are not in the note. Do not remove facts.
Keep it short and in his words. Return only the cleaned note text.`;

async function callClaude(model: string, system: string, content: unknown[], maxTokens: number) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("AI is not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) { const t = await res.text(); console.error("anthropic", res.status, t); let msg = ""; try { msg = JSON.parse(t)?.error?.message || ""; } catch (_) { /* raw */ } throw new Error(`AI request failed (${res.status}) ${msg}`.trim()); }
  const data = await res.json();
  return (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);

    const { shop_id, mode, image_base64, text } = await req.json();
    const { data: m } = await sb.from("shop_members").select("user_id")
      .eq("shop_id", shop_id).eq("user_id", u.user.id).eq("active", true).maybeSingle();
    if (!m) return json({ error: "Not a member of this shop." }, 403);

    if (mode === "cleanup") {
      if (!text || !String(text).trim()) return json({ text: "" });
      const out = await callClaude("claude-haiku-4-5", CLEANUP_PROMPT, [{ type: "text", text: String(text).slice(0, 4000) }], 600);
      return json({ text: out });
    }

    if (mode === "part") {
      if (!image_base64) return json({ error: "No photo" }, 400);
      const raw = String(image_base64).replace(/^data:[^;]+;base64,/, "");
      if (raw.length > 7 * 1024 * 1024) return json({ error: "Photo too large" }, 413);
      const mt = raw.startsWith("iVBOR") ? "image/png" : raw.startsWith("UklG") ? "image/webp" : "image/jpeg";
      const reply = await callClaude("claude-sonnet-4-6", PART_PROMPT, [
        { type: "image", source: { type: "base64", media_type: mt, data: raw } },
        { type: "text", text: "Read the part number off this photo. JSON only." },
      ], 300);
      let parsed: any = { found: false };
      try {
        const s = reply.indexOf("{"), e = reply.lastIndexOf("}");
        parsed = JSON.parse(reply.slice(s, e + 1));
      } catch (_) { /* keep found:false */ }
      if (!parsed.part_number) parsed.found = false;
      return json(parsed);
    }
    return json({ error: "Unknown mode" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
