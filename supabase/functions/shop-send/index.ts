// shop-send — emails the customer from the shop.
//   kind "link":    their car page link + QR (after intake)
//   kind "invoice": the invoice PDF attached, plus a link to view/pay
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);

    const { shop_id, car_id, kind, invoice_id, pdf_base64, page_url } = await req.json();
    const { data: m } = await sb.from("shop_members").select("user_id")
      .eq("shop_id", shop_id).eq("user_id", u.user.id).eq("active", true).maybeSingle();
    if (!m) return json({ error: "Not a member of this shop." }, 403);

    const { data: car } = await sb.from("shop_cars").select("*").eq("id", car_id).eq("shop_id", shop_id).single();
    const { data: cust } = await sb.from("shop_customers").select("*").eq("id", car.customer_id).single();
    const { data: shop } = await sb.from("shops").select("*").eq("id", shop_id).single();
    if (!cust?.email) return json({ error: "This customer has no email on file." }, 400);

    const link = String(page_url || "");
    if (!/^https:\/\//.test(link)) return json({ error: "Bad page link" }, 400);
    const carName = [car.year, car.make, car.model].filter(Boolean).join(" ") || "your vehicle";
    const first = String(cust.name || "").split(" ")[0];

    const KEY = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("FROM_EMAIL") || "reports@mydailyreports.org";
    if (!KEY) return json({ error: "Email is not configured" }, 500);

    let subject = "", inner = "";
    const payload: Record<string, unknown> = {
      from: `${shop.name} <${FROM}>`,
      to: [cust.email],
      reply_to: shop.email || undefined,
    };

    if (kind === "link") {
      subject = `Your ${carName} at ${shop.name}`;
      inner = `<p>Hi ${esc(first)},</p>
        <p>Thanks for leaving your ${esc(carName)} with us. You can follow along here: photos and updates from the shop show up on this page as we work.</p>
        <p style="margin:22px 0"><a href="${esc(link)}" style="background:#c8202b;color:#fff;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:bold">See your car</a></p>`;
    } else if (kind === "invoice") {
      const { data: inv } = await sb.from("shop_invoices").select("*").eq("id", invoice_id).eq("car_id", car_id).single();
      if (!inv) return json({ error: "Invoice not found" }, 404);
      subject = `Invoice #${inv.number} from ${shop.name} — ${carName}`;
      inner = `<p>Hi ${esc(first)},</p>
        <p>Your invoice for the ${esc(carName)} is attached.</p>
        <p style="font-size:18px"><strong>Total: ${money(inv.total)}</strong></p>
        <p style="margin:22px 0"><a href="${esc(link)}" style="background:#c8202b;color:#fff;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:bold">View &amp; pay invoice</a></p>`;
      if (pdf_base64) {
        payload.attachments = [{ filename: `${shop.name.replace(/\W+/g, "_")}_Invoice_${inv.number}.pdf`, content: String(pdf_base64).replace(/^data:[^;]+;base64,/, "") }];
      }
      await sb.from("shop_invoices").update({ status: inv.status === "paid" ? "paid" : "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", inv.id);
    } else {
      return json({ error: "Unknown kind" }, 400);
    }

    payload.subject = subject;
    payload.html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#222">
      <div style="background:#1b1b1b;color:#fff;padding:16px 22px;font-weight:bold;font-size:18px;letter-spacing:.04em">${esc(shop.name.toUpperCase())}</div>
      <div style="padding:20px 22px;border:1px solid #ddd;border-top:none;font-size:15px;line-height:1.5">${inner}
        <p style="color:#666;font-size:13px;margin-top:24px">${esc(shop.name)} · ${esc(shop.phone || "")}<br>${esc(shop.address || "")}</p>
      </div></div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { console.error("resend", r.status, await r.text()); return json({ error: "Email didn't send. Try again." }, 502); }
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
