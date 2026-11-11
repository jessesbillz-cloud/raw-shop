// shop-login — shop code + tap your name + 4-digit PIN. No emails or passwords for the crew.
//   action "crew": { code }                  -> shop name and the names to tap
//   action "pin":  { code, user_id, pin }    -> a normal signed-in session for that crew member
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const code = String(body.code || "").trim().toLowerCase();
    if (!code) return json({ error: "Enter the shop code." }, 400);
    const { data: shop } = await admin.from("shops").select("id, name").eq("code", code).maybeSingle();
    if (!shop) return json({ error: "That shop code isn't right." }, 404);

    if (body.action === "crew") {
      const { data: crew } = await admin.from("shop_members").select("user_id, display_name")
        .eq("shop_id", shop.id).eq("active", true).not("pin_hash", "is", null).order("display_name");
      return json({ shop: shop.name, crew: (crew || []).map((c: any) => ({ id: c.user_id, name: c.display_name })) });
    }

    if (body.action === "pin") {
      const pin = String(body.pin || "");
      if (!/^\d{4}$/.test(pin)) return json({ error: "PIN is 4 numbers." }, 400);
      const { data: verdict, error: e1 } = await admin.rpc("shop_check_pin", { p_shop: shop.id, p_user: body.user_id, p_pin: pin });
      if (e1) return json({ error: "Sign-in failed. Try again." }, 500);
      if (verdict === "locked") return json({ error: "Too many wrong tries. Wait 15 minutes or ask the owner to reset your PIN." }, 429);
      if (verdict !== "ok") return json({ error: "Wrong PIN." }, 401);

      const { data: u } = await admin.auth.admin.getUserById(body.user_id);
      const email = u?.user?.email;
      if (!email) return json({ error: "This login needs to be set up again by the owner." }, 400);
      const { data: link, error: e2 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (e2 || !link?.properties?.hashed_token) return json({ error: "Sign-in failed. Try again." }, 500);
      const pub = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
      const { data: s, error: e3 } = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
      if (e3 || !s?.session) return json({ error: "Sign-in failed. Try again." }, 500);
      return json({
        access_token: s.session.access_token, refresh_token: s.session.refresh_token,
        expires_in: s.session.expires_in, user: { id: s.session.user.id },
      });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
