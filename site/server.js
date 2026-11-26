/* ==========================================================================
   server.js — site de vendas do LA Clínicas (estático)

   Entrega SÓ o que está em public/. Autorizar por LUGAR, e não por extensão:
   o próprio server.js, o package.json e o README moram fora dessa pasta e
   não existem para quem chega pela web.

   · Local:     http://localhost:5213/
   · Produção:  atrás do nginx; escuta só em 127.0.0.1.
   ========================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PUBLICO = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 5213;
const VERSAO = require("./package.json").version;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

/* CSP: nada de script de fora; fontes só do Google. O formulário de contato
   não envia nada para servidor nenhum — ele monta a mensagem e abre o
   WhatsApp, que é navegação, não conexão. */
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
  "form-action 'none'; img-src 'self' data:; script-src 'self'; connect-src 'self'; " +
  "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";

function cabecalhos(res, tipo, extra = {}) {
  res.setHeader("Content-Type", tipo);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  res.setHeader("Content-Security-Policy", CSP);
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}

function naoAchou(res) {
  const pagina = path.join(PUBLICO, "404.html");
  cabecalhos(res, MIME[".html"], { "Cache-Control": "no-cache" });
  res.writeHead(404);
  res.end(fs.existsSync(pagina) ? fs.readFileSync(pagina) : "404");
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }); return res.end();
  }
  if (req.headers["x-forwarded-proto"] === "https")
    res.setHeader("Strict-Transport-Security", "max-age=31536000");

  let caminho;
  try { caminho = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { return naoAchou(res); }
  // Barra invertida e byte nulo não têm o que fazer num endereço deste site.
  if (caminho.includes("\0") || caminho.includes("\\")) return naoAchou(res);

  let arq = path.normalize(path.join(PUBLICO, caminho));
  if (arq !== PUBLICO && !arq.startsWith(PUBLICO + path.sep)) return naoAchou(res);
  // Pastas e arquivos ocultos (.git, .env…) nunca, mesmo que um dia caiam aqui.
  if (path.relative(PUBLICO, arq).split(path.sep).some((p) => p.startsWith("."))) return naoAchou(res);

  try {
    if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, "index.html");
    if (!fs.existsSync(arq) || !fs.statSync(arq).isFile()) return naoAchou(res);
  } catch { return naoAchou(res); }

  const ext = path.extname(arq).toLowerCase();
  const tipo = MIME[ext];
  if (!tipo) return naoAchou(res);

  /* Cache longo SÓ para imagem e fonte. CSS e JS mudam sem trocar de nome —
     com cache de uma semana, quem já visitou ficaria uma semana sem ver uma
     correção. Eles são revalidados a cada visita; o 304 custa quase nada. */
  const longo = [".png", ".webp", ".svg", ".ico", ".woff2"].includes(ext);
  const modificado = fs.statSync(arq).mtime;
  modificado.setMilliseconds(0);
  const desde = Date.parse(req.headers["if-modified-since"] || "");
  cabecalhos(res, tipo, {
    "Cache-Control": longo ? "public, max-age=604800" : "no-cache",
    "Last-Modified": modificado.toUTCString(),
  });
  if (!Number.isNaN(desde) && modificado.getTime() <= desde) { res.writeHead(304); return res.end(); }
  res.writeHead(200);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(arq).pipe(res);
}).listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`\n  LA Clínicas — site de vendas v${VERSAO}`);
  console.log(`  · http://localhost:${PORT}/\n`);
});
