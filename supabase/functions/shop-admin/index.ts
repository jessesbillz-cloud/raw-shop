// shop-admin — the shop owner adds crew (name + 4-digit PIN), resets PINs, turns logins off.
// Crew accounts are tagged app=shop so they never show up as MDR profiles.
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
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);

    const { shop_id } = body;
    const { data: me } = await sb.from("shop_members").select("role")
      .eq("shop_id", shop_id).eq("user_id", u.user.id).eq("active", true).maybeSingle();
    if (me?.role !== "owner") return json({ error: "Only the shop owner can manage crew." }, 403);

    if (body.action === "add_member") {
      // crew sign in with a 4-digit PIN; the email is an internal placeholder that never gets mail
      const name = String(body.display_name || "").trim();
      const role = body.role === "owner" ? "owner" : "tech";
      const pin = String(body.pin || "");
      if (!name) return json({ error: "Name is required." }, 400);
      if (!/^\d{4}$/.test(pin)) return json({ error: "PIN is 4 numbers." }, 400);
      const email = `crew-${crypto.randomUUID().slice(0, 12)}@crew.mydailyreports.org`;
      const { data: created, error } = await sb.auth.admin.createUser({
        email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true,
        user_metadata: { app: "shop", full_name: name },
      });
      if (error) return json({ error: error.message }, 400);
      const uid = created.user.id;
      const { error: e2 } = await sb.from("shop_members").insert({ shop_id, user_id: uid, display_name: name, role, active: true });
      if (e2) return json({ error: e2.message }, 400);
      const { error: e3 } = await sb.rpc("shop_set_pin", { p_shop: shop_id, p_user: uid, p_pin: pin });
      if (e3) return json({ error: e3.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "set_pin") {
      const pin = String(body.pin || "");
      if (!/^\d{4}$/.test(pin)) return json({ error: "PIN is 4 numbers." }, 400);
      const { error } = await sb.rpc("shop_set_pin", { p_shop: shop_id, p_user: body.user_id, p_pin: pin });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "set_active") {
      if (body.user_id === u.user.id) return json({ error: "You can't turn off your own login." }, 400);
      await sb.from("shop_members").update({ active: !!body.active }).eq("shop_id", shop_id).eq("user_id", body.user_id);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
