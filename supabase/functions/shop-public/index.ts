// shop-public — what the customer sees from their QR code. No login; the unguessable token is the key.
// Returns only what the shop shared: car basics, status, shared photos/notes, and sent invoices.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token } = await req.json();
    if (!token || !UUID.test(token)) return json({ error: "Link not found" }, 404);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: car } = await sb.from("shop_cars")
      .select("id, shop_id, customer_id, year, make, model, color, work_requested, status, intake_photo, created_at, updated_at")
      .eq("public_token", token).maybeSingle();
    if (!car) return json({ error: "Link not found" }, 404);

    const [{ data: shop }, { data: cust }, { data: entries }, { data: invoices }] = await Promise.all([
      sb.from("shops").select("name, phone, email, address, payment_url").eq("id", car.shop_id).single(),
      sb.from("shop_customers").select("name").eq("id", car.customer_id).single(),
      sb.from("shop_entries").select("id, kind, photo, body, author_name, created_at")
        .eq("car_id", car.id).eq("shared", true).in("kind", ["photo", "note", "status"])
        .order("created_at", { ascending: false }).limit(300),
      sb.from("shop_invoices").select("id, number, status, lines, tax_rate, subtotal, tax, total, notes, work_done, recommendations, sent_at, paid_at")
        .eq("car_id", car.id).in("status", ["sent", "paid"]).order("created_at", { ascending: false }),
    ]);

    const paths = [car.intake_photo, ...(entries || []).map((e: any) => e.photo)].filter(Boolean) as string[];
    const urls: Record<string, string> = {};
    if (paths.length) {
      const { data: signed } = await sb.storage.from("shop-photos").createSignedUrls(paths, 60 * 60 * 24);
      (signed || []).forEach((s: any) => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
    }

    return json({
      shop,
      customer_first: String(cust?.name || "").split(" ")[0],
      car: { ...car, id: undefined, shop_id: undefined, customer_id: undefined, intake_photo: car.intake_photo ? urls[car.intake_photo] : null },
      entries: (entries || []).map((e: any) => ({ ...e, photo: e.photo ? urls[e.photo] || null : null })),
      invoices: invoices || [],
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
