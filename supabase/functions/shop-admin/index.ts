// shop-admin — the shop owner adds crew logins (name + email + password).
// Crew accounts are tagged app=shop so they never show up as MDR profiles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function findUserId(sb: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users || []).find((x: any) => (x.email || "").toLowerCase() === email);
    if (hit) return hit.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

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
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.display_name || "").trim();
      const role = body.role === "owner" ? "owner" : "tech";
      if (!email.includes("@") || !name) return json({ error: "Name and email are required." }, 400);
      let uid = await findUserId(sb, email);
      if (!uid) {
        const pw = String(body.password || "");
        if (pw.length < 8) return json({ error: "Password needs at least 8 characters." }, 400);
        const { data: created, error } = await sb.auth.admin.createUser({
          email, password: pw, email_confirm: true, user_metadata: { app: "shop", full_name: name },
        });
        if (error) return json({ error: error.message }, 400);
        uid = created.user.id;
      }
      const { error: e2 } = await sb.from("shop_members").upsert(
        { shop_id, user_id: uid, display_name: name, role, active: true }, { onConflict: "shop_id,user_id" });
      if (e2) return json({ error: e2.message }, 400);
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
