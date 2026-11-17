#!/usr/bin/env node
/* =====================================================================
   ÁREA 41 SHOP — API do catálogo e do /consoleadmin
   Sem dependências: só Node.js (12+).
   Uso:
     node server.js                 inicia a API (porta 4141)
     node server.js set-password    define a senha do painel (pergunta no terminal
                                    ou usa a variável ADMIN_PASSWORD)
   Variáveis:
     PORT        (padrão 4141)
     DATA_DIR    (padrão /var/lib/area41)  onde ficam catalog.json, uploads/, auth.json
     STATIC_DIR  (opcional) serve os arquivos do site — só para testar sem nginx
   ===================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4141);
const DATA_DIR = process.env.DATA_DIR || "/var/lib/area41";
const STATIC_DIR = process.env.STATIC_DIR || "";
const SEED = path.join(__dirname, "..", "data", "catalog.seed.json");
const CATALOG = path.join(DATA_DIR, "catalog.json");
const AUTH = path.join(DATA_DIR, "auth.json");
const UPLOADS = path.join(DATA_DIR, "uploads");
const SESSION_DAYS = 7;

fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------------- arquivos ---------------- */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}
function loadCatalog() {
  let c = readJSON(CATALOG, null);
  if (!c) {
    c = readJSON(SEED, { version: 1, config: {}, categories: [], products: [] });
    writeJSON(CATALOG, c);
    backup(c);
  }
  return c;
}
function backup(c) {
  const dir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(dir, "catalog-" + stamp + ".json"), JSON.stringify(c));
  // mantém os 30 mais recentes
  const files = fs.readdirSync(dir).filter(f => f.startsWith("catalog-")).sort();
  files.slice(0, Math.max(0, files.length - 30)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
}

/* ---------------- senha e sessão ---------------- */
function getAuth() {
  let a = readJSON(AUTH, null);
  if (!a) { a = { secret: crypto.randomBytes(32).toString("hex"), hash: null, salt: null }; writeJSON(AUTH, a); try { fs.chmodSync(AUTH, 0o600); } catch (e) {} }
  if (!a.secret) { a.secret = crypto.randomBytes(32).toString("hex"); writeJSON(AUTH, a); }
  return a;
}
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString("hex"); }
function setPassword(pw) {
  const a = getAuth();
  a.salt = crypto.randomBytes(16).toString("hex");
  a.hash = hashPassword(pw, a.salt);
  a.secret = crypto.randomBytes(32).toString("hex"); // derruba sessões antigas
  writeJSON(AUTH, a); try { fs.chmodSync(AUTH, 0o600); } catch (e) {}
}
function checkPassword(pw) {
  const a = getAuth();
  if (!a.hash || typeof pw !== "string") return false;
  const h = Buffer.from(hashPassword(pw, a.salt), "hex");
  const ref = Buffer.from(a.hash, "hex");
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
const b64u = b => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function makeToken() {
  const payload = b64u(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = b64u(crypto.createHmac("sha256", getAuth().secret).update(payload).digest());
  return payload + "." + sig;
}
function validToken(tok) {
  if (!tok || tok.indexOf(".") < 0) return false;
  const parts = tok.split(".");
  const sig = b64u(crypto.createHmac("sha256", getAuth().secret).update(parts[0]).digest());
  if (sig.length !== parts[1].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[1]))) return false;
  try { return JSON.parse(Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()).exp > Date.now(); } catch (e) { return false; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isHttps(req) { return (req.headers["x-forwarded-proto"] || "").indexOf("https") === 0; }
function sessionCookie(req, value, maxAge) {
  return "a41_admin=" + value + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (isHttps(req) ? "; Secure" : "");
}

/* tentativas de login por IP */
const attempts = new Map();
function clientIp(req) { return (req.headers["x-real-ip"] || req.socket.remoteAddress || "").toString(); }
function tooMany(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60e3) { attempts.delete(ip); return false; }
  return a.count >= 8;
}
function failed(ip) {
  const a = attempts.get(ip) || { count: 0, first: Date.now() };
  a.count++; attempts.set(ip, a);
}

/* ---------------- validação do catálogo ---------------- */
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 120);
const num = (v, min, max) => { const n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const slug = v => str(v, 60).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const imgPath = v => { const s = str(v, 200); return /^(img\/|\/uploads\/)[A-Za-z0-9_\-./]+$/.test(s) && s.indexOf("..") < 0 ? s : ""; };
const digits = v => str(v, 20).replace(/\D/g, "");

function sanitize(input) {
  if (!input || typeof input !== "object") throw new Error("Catálogo inválido.");
  const ids = new Set();
  const products = (Array.isArray(input.products) ? input.products : []).slice(0, 500).map(p => {
    let id = slug(p.id || p.name) || "produto";
    let base = id, k = 2; while (ids.has(id)) id = base + "-" + (k++);
    ids.add(id);
    const name = str(p.name, 80);
    if (!name) throw new Error("Tem produto sem nome.");
    const price = Math.round(num(p.price, 0, 100000) * 100) / 100;
    let old = p.old == null || p.old === "" ? null : Math.round(num(p.old, 0, 100000) * 100) / 100;
    if (old !== null && old <= price) old = null;
    const flavors = (Array.isArray(p.flavors) ? p.flavors : []).slice(0, 200)
      .map(f => ({ name: str(f && f.name, 60), stock: Math.round(num(f && f.stock, 0, 99999)) }))
      .filter(f => f.name);
    let rating = null;
    if (p.rating && Number(p.rating.value) > 0) rating = { value: Math.round(num(p.rating.value, 0, 5) * 10) / 10, count: Math.round(num(p.rating.count, 0, 1e6)) };
    return { id, name, brand: str(p.brand, 40), puffs: Math.round(num(p.puffs, 0, 1e6)), img: imgPath(p.img), price, old,
      best: !!p.best, rating, active: p.active !== false, description: str(p.description, 600), flavors };
  });
  const catIds = new Set();
  const categories = (Array.isArray(input.categories) ? input.categories : []).slice(0, 60).map(c => {
    let id = slug(c.id || c.name) || "categoria";
    let base = id, k = 2; while (catIds.has(id)) id = base + "-" + (k++);
    catIds.add(id);
    const name = str(c.name, 60);
    if (!name) throw new Error("Tem categoria sem nome.");
    const items = (Array.isArray(c.items) ? c.items : []).map(String).filter((x, i, a) => ids.has(x) && a.indexOf(x) === i);
    return { id, name, note: str(c.note, 60), promo: !!c.promo, items };
  });
  const ci = input.config || {};
  const config = {
    nome: str(ci.nome, 60) || "ÁREA 41 SHOP",
    whatsapp: digits(ci.whatsapp),
    cidade: str(ci.cidade, 60),
    instagram: str(ci.instagram, 40).replace(/^@/, ""),
    giftEnabled: ci.giftEnabled !== false,
    giftMin: Math.round(num(ci.giftMin, 1, 99)) || 2,
    giftName: str(ci.giftName, 60) || "Chaveiro Área 41",
    giftImg: imgPath(ci.giftImg) || "img/chaveiro.webp",
    groupUrl: /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/.test(str(ci.groupUrl, 200)) ? str(ci.groupUrl, 200) : "",
    suggested: (Array.isArray(ci.suggested) ? ci.suggested : []).map(String).filter(x => ids.has(x)).slice(0, 6)
  };
  return { config, categories, products };
}
function publicCatalog(c) {
  const active = new Set(c.products.filter(p => p.active).map(p => p.id));
  return {
    version: c.version,
    config: c.config,
    categories: c.categories.map(cat => Object.assign({}, cat, { items: cat.items.filter(id => active.has(id)) })),
    products: c.products.filter(p => p.active)
  };
}

/* ---------------- HTTP ---------------- */
function send(res, status, body, headers) {
  const h = Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, headers || {});
  res.writeHead(status, h);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(Object.assign(new Error("Arquivo muito grande."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(Object.assign(new Error("JSON inválido."), { status: 400 })); } });
    req.on("error", reject);
  });
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "Não encontrado." });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  });
}
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.indexOf("/uploads/") === 0) return serveFile(res, path.join(UPLOADS, path.basename(p)));
  if (p === "/consoleadmin") { res.writeHead(301, { Location: "/consoleadmin/" }); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(STATIC_DIR, p));
  if (file.indexOf(path.normalize(STATIC_DIR)) !== 0) return send(res, 403, { error: "Proibido." });
  serveFile(res, file);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/api/catalog" && req.method === "GET") {
      return send(res, 200, publicCatalog(loadCatalog()), { "Cache-Control": "no-cache" });
    }
    if (p.indexOf("/api/admin/") === 0) {
      // proteção extra contra requisições vindas de outros sites
      if (req.method !== "GET" && req.headers["x-requested-with"] !== "a41") return send(res, 403, { error: "Requisição recusada." });
      const ip = clientIp(req);

      if (p === "/api/admin/login" && req.method === "POST") {
        if (!getAuth().hash) return send(res, 503, { error: "Senha do painel ainda não foi criada. Rode na VPS: bash /var/www/area41-shop/deploy/senha.sh" });
        if (tooMany(ip)) return send(res, 429, { error: "Muitas tentativas. Espere 15 minutos." });
        const body = await readBody(req, 10e3);
        if (!checkPassword(body.password)) { failed(ip); return send(res, 401, { error: "Senha incorreta." }); }
        attempts.delete(ip);
        return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, makeToken(), SESSION_DAYS * 86400) });
      }
      if (p === "/api/admin/logout" && req.method === "POST") {
        return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
      }

      if (!validToken(cookies(req).a41_admin)) return send(res, 401, { error: "Faça login novamente." });

      if (p === "/api/admin/me") return send(res, 200, { ok: true });
      if (p === "/api/admin/catalog" && req.method === "GET") return send(res, 200, loadCatalog());
      if (p === "/api/admin/catalog" && req.method === "PUT") {
        const body = await readBody(req, 2e6);
        const cur = loadCatalog();
        if (body.baseVersion && Number(body.baseVersion) !== Number(cur.version)) return send(res, 409, { error: "O catálogo foi alterado em outra aba. Recarregue a página para ver a versão mais nova.", version: cur.version });
        const clean = sanitize(body.catalog);
        clean.version = (Number(cur.version) || 0) + 1;
        clean.updatedAt = new Date().toISOString();
        writeJSON(CATALOG, clean);
        backup(clean);
        return send(res, 200, clean);
      }
      if (p === "/api/admin/upload" && req.method === "POST") {
        const body = await readBody(req, 12e6);
        const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
        if (!m) return send(res, 400, { error: "Envie uma imagem JPG, PNG ou WEBP." });
        const buf = Buffer.from(m[2], "base64");
        const magic = buf.slice(0, 12).toString("hex");
        const okMagic = (m[1] === "png" && magic.indexOf("89504e47") === 0) || (m[1] === "jpeg" && magic.indexOf("ffd8ff") === 0) || (m[1] === "webp" && magic.slice(16, 24) === "57454250");
        if (!okMagic) return send(res, 400, { error: "Arquivo de imagem inválido." });
        const name = Date.now().toString(36) + "-" + crypto.randomBytes(5).toString("hex") + "." + (m[1] === "jpeg" ? "jpg" : m[1]);
        fs.writeFileSync(path.join(UPLOADS, name), buf);
        return send(res, 200, { url: "/uploads/" + name });
      }
      if (p === "/api/admin/password" && req.method === "POST") {
        const body = await readBody(req, 10e3);
        if (!checkPassword(body.current)) return send(res, 401, { error: "A senha atual está errada." });
        if (typeof body.next !== "string" || body.next.length < 8) return send(res, 400, { error: "A nova senha precisa ter pelo menos 8 caracteres." });
        setPassword(body.next);
        return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, makeToken(), SESSION_DAYS * 86400) });
      }
      return send(res, 404, { error: "Não encontrado." });
    }
    if (STATIC_DIR) return serveStatic(req, res, url);
    send(res, 404, { error: "Não encontrado." });
  } catch (e) {
    send(res, e.status || 400, { error: e.message || "Erro." });
  }
});

/* ---------------- linha de comando ---------------- */
if (process.argv[2] === "set-password") {
  const done = pw => {
    if (!pw || pw.length < 8) { console.error("A senha precisa ter pelo menos 8 caracteres."); process.exit(1); }
    setPassword(pw); console.log("✅ Senha do /consoleadmin salva."); process.exit(0);
  };
  if (process.env.ADMIN_PASSWORD) done(process.env.ADMIN_PASSWORD);
  else {
    process.stdout.write("Crie a senha do /consoleadmin (mínimo 8 caracteres): ");
    const stdin = process.stdin; let pw = "";
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", ch => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { process.stdout.write("\n"); if (stdin.isTTY) stdin.setRawMode(false); return done(pw); }
        if (c === "\u0003") process.exit(1);
        if (c === "\u007f") pw = pw.slice(0, -1); else pw += c;
      }
    });
  }
} else {
  loadCatalog(); getAuth();
  server.listen(PORT, "127.0.0.1", () => console.log("ÁREA 41 API em http://127.0.0.1:" + PORT));
}
