# RAW Shop

Shop app for RAW Motorsports. Phone-first, no build step.

- `index.html`: the crew app (sign in, cars in the shop, check-in with waiver signature and QR code, photos, part photos, notes, parts list, invoices, crew logins, shop settings)
- `car.html?t=<token>`: the customer page the QR code opens (status, shared photos and notes, invoice with pay or call)
- `supabase/functions/*`: server functions (`shop-ai`, `shop-public`, `shop-send`, `shop-admin`), deployed to the MDR Supabase project
- Data lives in the `shop_*` tables with row-level security by shop membership. Photos are in the private `shop-photos` bucket.

Multi-shop ready: everything is keyed by `shop_id`, so a second shop is one new `shops` row plus an owner login.
