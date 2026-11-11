/* Tiny Supabase client for the shop app: auth, tables, photos, server functions.
   No build step, no outside library. */
(function () {
  const URL_ = "https://wluvkmpncafugdbunlkw.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdXZrbXBuY2FmdWdkYnVubGt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDU1MTUsImV4cCI6MjA4Nzg4MTUxNX0.HZpQ2xVGpf4EQ0BVDmIEuPqW5T_eNG5OqBNAqT03rH8";
  const KEY = "rawshop.session";
  const BUCKET = "shop-photos";

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
  function save(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (_) {} }
  let session = load();

  async function authCall(path, body) {
    const r = await fetch(`${URL_}/auth/v1/${path}`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "Sign-in failed");
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user };
  }

  async function token() {
    if (!session) throw new Error("signed_out");
    if (session.expires_at - 60 < Date.now() / 1000) {
      try { session = await authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token }); save(session); }
      catch (e) { session = null; save(null); throw new Error("signed_out"); }
    }
    return session.access_token;
  }

  async function headers(extra) {
    return Object.assign({ apikey: ANON, Authorization: `Bearer ${await token()}` }, extra || {});
  }

  async function rest(method, path, body, prefer) {
    const h = await headers({ "Content-Type": "application/json" });
    if (prefer) h.Prefer = prefer;
    const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { session = null; save(null); throw new Error("signed_out"); }
    const text = await r.text();
    const j = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || `Request failed (${r.status})`);
    return j;
  }

  const api = {
    url: URL_,
    get user() { return session && session.user; },
    signedIn() { return !!session; },
    async signIn(email, password) { session = await authCall("token?grant_type=password", { email, password }); save(session); return session.user; },
    signOut() { session = null; save(null); },

    select: (table, query) => rest("GET", `${table}?${query || "select=*"}`),
    insert: (table, row) => rest("POST", table, row, "return=representation").then((r) => Array.isArray(row) ? r : r[0]),
    update: (table, match, patch) => rest("PATCH", `${table}?${match}`, patch, "return=representation"),
    remove: (table, match) => rest("DELETE", `${table}?${match}`),
    rpc: (fn, args) => rest("POST", `rpc/${fn}`, args || {}),

    async upload(path, blob) {
      const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST", headers: await headers({ "Content-Type": blob.type || "image/jpeg", "x-upsert": "false" }), body: blob,
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || "Photo upload failed"); }
      return path;
    },
    async signed(paths) {
      const list = [...new Set(paths.filter(Boolean))];
      if (!list.length) return {};
      const r = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}`, {
        method: "POST", headers: await headers({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: 60 * 60 * 6, paths: list }),
      });
      const j = await r.json().catch(() => []);
      const out = {};
      (Array.isArray(j) ? j : []).forEach((x) => { if (x.signedURL) out[x.path] = `${URL_}/storage/v1${x.signedURL}`; });
      return out;
    },
    async removePhoto(path) {
      await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
        method: "DELETE", headers: await headers({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: [path] }),
      });
    },

    async fn(name, body, anonymous) {
      const h = anonymous ? { apikey: ANON, Authorization: `Bearer ${ANON}` } : await headers();
      h["Content-Type"] = "application/json";
      const r = await fetch(`${URL_}/functions/v1/${name}`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Server error (${r.status})`);
      return j;
    },
  };
  window.api = api;
})();
