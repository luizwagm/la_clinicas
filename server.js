/* ==========================================================================
   server.js — LA Clínicas: sistema de gestão clínica (/restrito)

   NASCIDO DA BemEstarClinic (02/09/2026): este projeto é o /restrito daquele
   site promovido a produto próprio. Lá, o mesmo processo servia também o site
   público e o painel /admin (ambos em SQLite); aqui só existe a gestão, que
   vive INTEIRA no PostgreSQL. Por isso este server é curto: ele é transporte
   — cabeçalhos, limites e rotas públicas do paciente — e toda a regra de
   negócio continua no restrito.js.

   O PREFIXO /restrito FOI MANTIDO de propósito, mesmo sendo o único app:
   a sessão é gravada com `Path=/restrito` DENTRO do restrito.js, e traduzir
   prefixo é mão dupla (caminho na ida, Path do cookie na volta) — meia
   tradução parece "sistema vazio", não quebrado. A raiz redireciona.

   · Sistema:  http://localhost:5204/restrito/
   · Paciente: http://localhost:5204/answer/<código>   (link enviado no WhatsApp)
   ========================================================================== */
/* O FUSO DO PROCESSO, antes de qualquer data ser calculada.
   O servidor (Hetzner) roda em UTC, e o restrito.js monta "hoje" pelos
   componentes LOCAIS do relógio — que, em UTC, viram o dia seguinte às 21h de
   Caruaru: o painel contava a agenda de amanhã e alta, abertura de prontuário
   e lançamentos saíam datados com o dia seguinte. Fixado aqui, e não na unit,
   porque o código viaja com o produto; outra cidade troca por TZ no ambiente. */
process.env.TZ = process.env.TZ || "America/Recife";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { criarLimitador } = require("./limitador");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5204;   // PORT por env permite subir uma cópia de teste

/* Versão — lida do package.json, a fonte única. Escrita à mão aqui ela ficou
   para trás na 0.5.0 (o log do servidor anunciava 0.4.1). Toda alteração
   sobe a versão: 2ª casa = feature, 3ª = correção. */
const APP_VERSION = require("./package.json").version;

/* O .env é lido ANTES do require do restrito.js: aquele módulo monta a conexão
   do Postgres a partir das variáveis de ambiente. Em produção quem as entrega
   é o systemd (EnvironmentFile) e este carregarEnv não acha arquivo — certo. */
const { Q, carregarAmbiente } = require("./pg");
carregarAmbiente(__dirname);
const { handleRestrito, iniciarRestrito, sessao: sessaoRestrito,
        registrarEncerrarPainel, aoMudarEquipe,
        estadoDoLink, iniciarTeste, concluirTeste, salvarRascunho,
        abrirComNascimento, dadosPublicosDaClinica } = require("./restrito");

/* Não existe painel /admin neste projeto — o restrito chama este gancho ao
   sair, e aqui ele simplesmente não tem o que encerrar. */
registrarEncerrarPainel(() => false);

/* ==========================================================================
   LA CHAT — módulo instalado, não biblioteca copiada
   `lachat.js` é o conector do projeto LA-Chat. Sem CHAT_URL e
   CHAT_SEGREDO_PASSE no ambiente ele fica INATIVO e o sistema roda igual.
   Mora SOB /restrito por causa do cookie (Path=/restrito).
   ========================================================================== */
const conectorChat = require("./lachat");
const CARGO_POR_PERFIL = {
  admin: "Administração", secretaria: "Recepção", profissional: "Profissional de saúde",
};
/* Administração e profissional criam link de reunião; a recepção, não.
   Uma regra só, com nome, usada no login E no elenco. */
const PERFIS_COM_REUNIAO = new Set(["admin", "profissional"]);
const podeCriarReuniao = (perfil) => PERFIS_COM_REUNIAO.has(String(perfil || ""));
const chat = conectorChat({
  url: process.env.CHAT_URL || "http://127.0.0.1:5197",
  segredo: process.env.CHAT_SEGREDO_PASSE,
  contexto: "la-clinicas",          // separa os dados desta instalação das outras
  prefixo: "restrito/chat",
  usuario(req) {
    /* SÍNCRONO por contrato — o conector não espera Promise. */
    const s = sessaoRestrito(req);
    if (!s || !s.userId) return null;
    return {
      id: s.userId,
      /* QUEM A PESSOA É, não que conta ela usa: `profissional_id` sobrevive à
         troca de conta. Quem não é profissional é identificado pela conta. */
      identidade: s.profissionalId ? `prof-${s.profissionalId}` : `conta-${s.userId}`,
      nome: s.nome,
      cargo: CARGO_POR_PERFIL[s.perfil] || "Equipe",
      papel: s.perfil === "admin" ? "admin" : "membro",
      podeSala: podeCriarReuniao(s.perfil),
    };
  },
});

/* FREIO CONTRA ADIVINHAÇÃO — ver limitador.js. Soma por IP e POR CONTA e
   persiste em disco. O arquivo é configurável por ambiente PARA AS SUÍTES:
   elas erram senha de propósito e não podem empilhar bloqueio entre execuções. */
const limite = criarLimitador({
  arquivo: process.env.LIMITES_ARQUIVO || path.join(ROOT, "data", "limites.json"),
});
limite.carregar();
process.on("exit", () => limite.gravar());
setInterval(() => limite.limpar(), 10 * 60 * 1000).unref();

/* O IP REAL. Atrás do nginx o socket é 127.0.0.1 e o IP chega por cabeçalho —
   que é texto do cliente. Só aceitamos cabeçalho vindo do proxy local, e dele
   o X-Real-IP (que o nginx SOBRESCREVE) ou o ÚLTIMO item do X-Forwarded-For,
   o único que o nginx escreveu. Ler o primeiro anularia a trava de força bruta. */
const DO_PROXY = /^(?:::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
function clientIp(req) {
  const direto = String(req.socket.remoteAddress || "");
  if (!DO_PROXY.test(direto)) return direto;
  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real;
  const lista = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return lista.length ? lista[lista.length - 1] : direto;
}

const MIME_HTML = "text/html; charset=utf-8";
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, bad) => {
  let d = "", n = 0;
  req.on("data", (c) => { n += c.length; if (n > 25e6) { bad(new Error("payload muito grande")); req.destroy(); } d += c; });
  req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { bad(new Error("JSON inválido")); } });
});

/* ==========================================================================
   CONSULTA DE CEP — o cadastro de pacientes preenche o endereço pelo CEP.

   Ficou para trás quando o sistema saiu do servidor do site de origem (era lá
   que a rota morava), e a tela seguiu chamando /api/cep: o preenchimento
   automático estava quebrado em silêncio desde a 0.1.0.

   Fonte: ViaCEP (base dos Correios, aberta e sem chave), com a BrasilAPI de
   reserva. Pelo servidor, e não direto do navegador: a CSP da gestão só deixa
   a tela falar com a própria origem, e o IP de quem digita não vai para
   terceiro. Cache de 30 dias e 60 consultas por minuto por IP.
   ========================================================================== */
const cacheCep = new Map();               // cep -> { dados, ts }
const CEP_TTL = 30 * 24 * 3600e3;
const cepPorIp = new Map();               // ip -> { n, ts }
const CEP_MAX = 60, CEP_JANELA = 60e3;
function podeConsultarCep(ip) {
  const t = cepPorIp.get(ip);
  if (!t || Date.now() - t.ts > CEP_JANELA) { cepPorIp.set(ip, { n: 1, ts: Date.now() }); return true; }
  t.n++;
  return t.n <= CEP_MAX;
}
setInterval(() => { const lim = Date.now() - CEP_JANELA; for (const [k, v] of cepPorIp) if (v.ts < lim) cepPorIp.delete(k); }, 5 * 60e3).unref();

async function pegarJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "LA-Clinicas/1.0" } });
    if (!r.ok) return null;
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function buscarCep(cep) {
  try {
    const v = await pegarJson(`https://viacep.com.br/ws/${cep}/json/`);
    if (v && !v.erro && v.localidade) {
      return { cep, logradouro: v.logradouro || "", complemento: v.complemento || "",
        bairro: v.bairro || "", cidade: v.localidade, uf: v.uf || "" };
    }
    if (v && v.erro) return null;                        // CEP inexistente: não adianta a segunda fonte
  } catch { /* cai para a segunda fonte */ }
  const b = await pegarJson(`https://brasilapi.com.br/api/cep/v1/${cep}`);
  if (b && b.city) {
    return { cep, logradouro: b.street || "", complemento: "",
      bairro: b.neighborhood || "", cidade: b.city, uf: b.state || "" };
  }
  return null;
}

const servidor = http.createServer(async (req, res) => {
  /* LA Chat — antes de qualquer coisa, e é assim que o módulo pede. */
  if (chat.rota(req, res)) return;

  const p = new URL(req.url, `http://localhost:${PORT}`).pathname;

  // Cabeçalhos de segurança em toda resposta
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  /* CÂMERA E MICROFONE SÓ NO /restrito — a reunião por vídeo obedece à
     política da PÁGINA; uma Permissions-Policy fechada faz o navegador recusar
     ANTES de perguntar, e a falha é 100% silenciosa. */
  res.setHeader("Permissions-Policy", p.startsWith("/restrito")
    ? "camera=(self), microphone=(self), display-capture=(self), geolocation=(), interest-cohort=()"
    : "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  /* HSTS só sob HTTPS: emitir em HTTP puro travaria o ambiente sem certificado. */
  if (req.headers["x-forwarded-proto"] === "https")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  /* Banco fora do ar: 503 com recado claro, tentando religar antes de desistir.
     É o que transforma queda de banco em soluço — quem chega depois que o
     PostgreSQL voltou já entra normalmente, sem ninguém mexer no servidor. */
  if (ERRO_GESTAO && (p === "/" || p === "/restrito" || p.startsWith("/restrito/") || p.startsWith("/answer") || p.startsWith("/api/")) && !(await gestaoNoAr())) {
    const api = p.startsWith("/restrito/api/") || p.startsWith("/api/");
    res.writeHead(503, {
      "Content-Type": api ? "application/json; charset=utf-8" : MIME_HTML,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Retry-After": "300",
    });
    return res.end(api
      ? JSON.stringify({ error: "O sistema está indisponível: o banco de dados não respondeu. Avise o suporte." })
      : `<!doctype html><meta charset="utf-8"><title>Sistema indisponível</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#FAF6F0;color:#1E2623;
display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem}
.c{max-width:34rem;background:#fff;border:1px solid #E6DCCD;border-radius:16px;padding:2rem;
box-shadow:0 10px 30px rgba(22,48,43,.08)}h1{font-size:1.3rem;margin:0 0 .8rem;color:#16302B}
p{line-height:1.6;margin:.6rem 0}small{color:#55605B}</style>
<div class="c"><h1>Sistema indisponível</h1>
<p>O banco de dados não respondeu. <b>Nenhum dado foi perdido</b> — o sistema volta
assim que a conexão for restabelecida.</p>
<p>Se você é da equipe, avise o suporte técnico.</p>
<p><small>Detalhe para o suporte: falha ao conectar no PostgreSQL no boot do serviço.
Consulte <code>journalctl -u laclinicas -n 40</code>.</small></p></div>`);
  }

  /* A raiz leva para o sistema — este servidor não tem site público. */
  if (p === "/" || p === "/index.html") {
    res.writeHead(302, { Location: "/restrito/" });
    return res.end();
  }

  /* O sistema de gestão. Toda a regra vive no restrito.js. */
  try { if (handleRestrito(req, res, p)) return; }
  catch (e) {
    console.error("  ✖ /restrito:", e.message);
    if (!res.headersSent) { res.writeHead(500); res.end("Erro interno"); }
    return;
  }

  try {
    /* -------------- Teste de rastreio respondido pelo paciente ----------
       PÚBLICO: quem chega tem um link no WhatsApp e não tem login. As regras
       de quem pode abrir vivem no restrito.js, junto dos dados — aqui só há
       o transporte.

       O FREIO: um código de 8 a 11 caracteres é adivinhável por força bruta
       se puder ser tentado sem limite. SÓ O BALDE POR IP na descoberta de
       código (`conta` nula — um balde fixo seria negação de serviço mundial;
       um balde por código nunca encheria, o atacante troca de código). */
    /* Nome, cidade e WhatsApp da clínica para a página do paciente — os mesmos
       para qualquer link, então não dizem nada sobre quem é paciente. */
    const mcep = p.match(/^\/api\/cep\/(\d{8})$/);
    if (mcep && req.method === "GET") {
      const cep = mcep[1];
      const emCache = cacheCep.get(cep);
      if (emCache && Date.now() - emCache.ts < CEP_TTL) return json(res, 200, emCache.dados);
      if (!podeConsultarCep(clientIp(req))) return json(res, 429, { error: "Muitas consultas de CEP. Aguarde um instante." });
      try {
        const dados = await buscarCep(cep);
        if (!dados) return json(res, 404, { error: "CEP não encontrado." });
        cacheCep.set(cep, { dados, ts: Date.now() });
        if (cacheCep.size > 5000) cacheCep.delete(cacheCep.keys().next().value);
        return json(res, 200, dados);
      } catch (e) {
        console.warn("  ⚠ consulta de CEP falhou:", e.message);
        return json(res, 503, { error: "Não consegui consultar o CEP agora. Preencha o endereço à mão." });
      }
    }
    // CEP mal formatado: responde sem sair para a internet
    if (/^\/api\/cep\//.test(p)) return json(res, 400, { error: "Informe um CEP com 8 dígitos." });

    if (p === "/api/clinica" && req.method === "GET") {
      res.setHeader("Cache-Control", "no-cache");
      return json(res, 200, await dadosPublicosDaClinica());
    }

    const mans = p.match(/^\/api\/answer\/([0-9A-Za-z]{8,11})(?:\/(iniciar|concluir|entrar|rascunho))?$/);
    if (mans) {
      const codigo = mans[1], acao = mans[2] || "";
      const ipA = clientIp(req);
      const vA = limite.verificar("answer", ipA, null);
      if (!vA.ok) { res.setHeader("Retry-After", String(vA.esperar)); return json(res, 429, { error: vA.mensagem }); }

      /* O PASSE DO APARELHO — cookie com `Path=/api/answer`: só as rotas do
         link o recebem. O NOME carrega o código porque um celular pode ter
         dois desafios de dois familiares. */
      const nomeCookie = "acesso_" + codigo;
      const passe = (() => {
        const bruto = req.headers.cookie || "";
        const m = new RegExp("(?:^|;\\s*)" + nomeCookie + "=([^;]*)").exec(bruto);
        return m ? decodeURIComponent(m[1]) : "";
      })();

      if (acao === "entrar" && req.method === "POST") {
        /* AQUI o balde por CÓDIGO é a defesa inteira: o atacante tem UM
           código e vai tentar datas — poucas dezenas de milhares plausíveis. */
        const vC = limite.verificar("answer-data", ipA, codigo);
        if (!vC.ok) { res.setHeader("Retry-After", String(vC.esperar)); return json(res, 429, { error: vC.mensagem }); }

        const b = await readBody(req);
        const r = await abrirComNascimento(codigo, b && b.nascimento);
        if (!r.ok) {
          limite.errou("answer-data", ipA, codigo);
          /* Uma resposta só para "código não existe", "data errada" e
             "sem data cadastrada": distinguir diria a quem tem o link se
             aquela pessoa é paciente da clínica. */
          return json(res, 401, { estado: "verificar", erro: "A data não confere." });
        }
        limite.acertou("answer-data", ipA, codigo);
        res.setHeader("Set-Cookie",
          `${nomeCookie}=${encodeURIComponent(r.passe)}; Path=/api/answer; Max-Age=${45 * 24 * 3600}` +
          `; HttpOnly; SameSite=Strict${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`);
        return json(res, 200, await estadoDoLink(codigo, r.passe));
      }

      if (!acao && req.method === "GET") {
        const r = await estadoDoLink(codigo, passe);
        if (r.estado === "inexistente") { limite.errou("answer", ipA, null); return json(res, 404, r); }
        limite.acertou("answer", ipA, null);
        return json(res, 200, r);
      }
      if (acao === "iniciar" && req.method === "POST") {
        const r = await iniciarTeste(codigo, passe);
        if (r.erro) { if (r.erro === "inexistente") limite.errou("answer", ipA, null);
          return json(res, r.erro === "inexistente" ? 404 : r.erro === "verificar" ? 401 : 409,
            { estado: r.erro }); }
        return json(res, 200, r);
      }
      if (acao === "rascunho" && req.method === "POST") {
        const b = await readBody(req);
        const r = await salvarRascunho(codigo, b && b.respostas, passe);
        if (r.erro) return json(res, r.erro === "inexistente" ? 404 : r.erro === "verificar" ? 401 : 409,
          { estado: r.erro });
        return json(res, 200, r);
      }
      if (acao === "concluir" && req.method === "POST") {
        const b = await readBody(req);
        const r = await concluirTeste(codigo, b && b.respostas, passe);
        if (r.erro) return json(res, r.erro === "inexistente" ? 404 : r.erro === "verificar" ? 401 : 409,
          { estado: r.erro, faltam: r.faltam || 0 });
        return json(res, 200, r);
      }
      return json(res, 405, { error: "Método não permitido." });
    }
    // Código fora do formato: recusado sem consultar o banco.
    if (/^\/api\/answer\//.test(p)) return json(res, 404, { estado: "inexistente" });

    /* ------------------- /answer/<codigo> — a página do paciente ---------
       Servida por ROTA, não como arquivo: o HTML mora em restrito/answer.html
       e é o mesmo para todos; quem decide o que mostrar é a API.
       `noindex` no cabeçalho ALÉM da meta tag: um buscador que só faça HEAD
       não chega a ler o HTML, e este endereço nunca pode aparecer em busca. */
    const mAnswer = p.match(/^\/answer\/[0-9A-Za-z]{8,11}\/?$/);
    if (mAnswer && req.method === "GET") {
      const arq = path.join(ROOT, "restrito", "answer.html");
      if (!fs.existsSync(arq)) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, {
        "Content-Type": MIME_HTML,
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        /* CSP fechada: a página não carrega nada de fora e não deve poder.
           `font-src data:` porque a fonte do logotipo vem EMBUTIDA na página. */
        "Content-Security-Policy":
          "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; " +
          "style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; font-src data:",
      });
      return res.end(fs.readFileSync(arq));
    }
    /* Código fora do formato não vira busca de arquivo. */
    if (/^\/answer(\/|$)/.test(p)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404"); }

    /* A marca do sistema (0.2.0). A tela pede /assets/img/favicon.svg — no
       BemEstar esse arquivo é do SITE, que não veio para cá, e o login e a
       barra lateral mostravam imagem quebrada desde a cópia. Um arquivo só,
       por rota explícita: autorizar por LUGAR, e não abrir a pasta /assets. */
    if (p === "/assets/img/favicon.svg" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff" });
      return res.end(req.method === "HEAD" ? undefined : fs.readFileSync(path.join(ROOT, "restrito", "favicon.svg")));
    }

    /* Não há árvore de arquivos estáticos: tudo que o sistema serve sai do
       handleRestrito. O que chegou aqui não existe. */
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404");
  } catch (e) {
    // detalhe do erro só no log: mensagem de exceção revela caminho e estrutura
    console.error(`  ✖ erro em ${p}:`, e.message);
    if (!res.headersSent) json(res, 500, { error: "Erro interno" });
  }
});

/* ==========================================================================
   SUBIDA — a porta abre JÁ, e a gestão inicializa em paralelo com tentativas.
   Enquanto o banco não responde, o handler acima serve 503 com recado claro
   (nunca um 500 "Erro interno" para quem estava salvando). A queda de banco
   por upgrade de madrugada dura ~5s; a inicialização é TENTATIVA repetida,
   não decisão única — quem religa é o próprio processo.
   ========================================================================== */
let ERRO_GESTAO = null;
let religando = null;
let proximaTentativa = 0;
const ESPERA_ENTRE_TENTATIVAS = 15_000;

async function ligarGestao() {
  await iniciarRestrito();
  ERRO_GESTAO = null;
  /* Com a gestão de pé, o chat já pode saber quem é a equipe. Sem await:
     sincronizar é conveniência, o sistema não espera por ela para atender. */
  sincronizarElencoDoChat("boot");
  ligarElencoContinuo();
}

/* Liga os gatilhos de reenvio UMA vez — cada religação do banco roda
   `ligarGestao` de novo, e sem a trava cada queda deixaria mais um relógio. */
let elencoContinuoLigado = false;
function ligarElencoContinuo() {
  if (elencoContinuoLigado || !chat.ligado) return;
  elencoContinuoLigado = true;
  aoMudarEquipe((motivo) => agendarElencoDoChat(motivo));
  const relogio = setInterval(() => sincronizarElencoDoChat("periódico"), 5 * 60_000);
  if (relogio.unref) relogio.unref();
}

/* QUEM É A EQUIPE, para o chat: manda o elenco no boot e a cada mudança.
   Idempotente, barato, e NUNCA derruba nada — o chat é conveniência. */
async function sincronizarElencoDoChat(motivo = "boot") {
  if (!chat.ligado || typeof chat.sincronizarElenco !== "function") return;
  try {
    /* Só quem pode entrar no sistema entra no chat (`ativo = 1`). */
    const equipe = await Q.all(
      `SELECT id, nome, email, perfil, foto, profissional_id
         FROM g_usuarios WHERE ativo = 1 ORDER BY nome`);
    const r = await chat.sincronizarElenco(equipe.map((u) => ({
      id: u.id,
      /* QUEM A PESSOA É, não que conta ela usa — `profissional_id` sobrevive
         à troca de conta; o prefixo evita colisão dos dois espaços de nome. */
      identidade: u.profissional_id ? `prof-${u.profissional_id}` : `conta-${u.id}`,
      nome: u.nome,
      cargo: CARGO_POR_PERFIL[u.perfil] || "Equipe",
      papel: u.perfil === "admin" ? "admin" : "membro",
      podeSala: podeCriarReuniao(u.perfil),
      /* Caminho RELATIVO: resolve na origem da página, chega autenticado pelo
         cookie do /restrito, e funciona igual em localhost e produção. */
      avatar: u.foto || "",
    })));
    if (r && r.ok && (motivo === "boot" || r.mudou)) {
      console.log(`  · LA Chat: ${r.sincronizados} pessoa(s) da equipe no chat` +
        (r.desativados ? `, ${r.desativados} desativada(s)` : "") +
        (motivo === "boot" ? "." : ` (${motivo}).`));
    } else if (r && !r.ok && r.motivo) {
      console.log(`  · LA Chat: elenco não sincronizado (${r.motivo}).`);
    }
  } catch (e) {
    console.warn("  ⚠ LA Chat: falha ao sincronizar o elenco —", e.message);
  }
}

/* Debounce de 2 s: salvar um usuário dispara uma escrita e às vezes duas. */
let elencoAgendado = null;
function agendarElencoDoChat(motivo) {
  if (elencoAgendado) clearTimeout(elencoAgendado);
  elencoAgendado = setTimeout(() => {
    elencoAgendado = null;
    sincronizarElencoDoChat(motivo);
  }, 2000);
  if (elencoAgendado.unref) elencoAgendado.unref();
}

/* true se a gestão está no ar — religando antes, se for a hora de tentar.
   A trava `religando` impede dez acessos simultâneos de abrir dez reconexões. */
async function gestaoNoAr() {
  if (!ERRO_GESTAO) return true;
  if (Date.now() < proximaTentativa) return false;
  if (!religando) {
    proximaTentativa = Date.now() + ESPERA_ENTRE_TENTATIVAS;
    religando = ligarGestao()
      .then(() => console.log("  · /restrito: banco de volta — sistema religado sozinho."))
      .catch((e) => { ERRO_GESTAO = e; })
      .finally(() => { religando = null; });
  }
  await religando;
  return !ERRO_GESTAO;
}

(async () => {
  /* No boot vale insistir: o serviço sobe junto com a máquina e o PostgreSQL
     pode ainda estar abrindo. As esperas somam ~30s. */
  const ESPERAS = [1000, 2000, 4000, 8000, 15000];
  for (let i = 0; ; i++) {
    try { await ligarGestao(); break; }
    catch (e) {
      ERRO_GESTAO = e;
      if (i >= ESPERAS.length) break;
      console.error(`  · /restrito: banco não respondeu (${e.message}) — nova tentativa em ${ESPERAS[i] / 1000}s`);
      await new Promise((r) => setTimeout(r, ESPERAS[i]));
    }
  }
  if (!ERRO_GESTAO) return;
  const e = ERRO_GESTAO;
  console.error("\n  ✖ O SISTEMA NÃO INICIALIZOU: " + e.message);
  console.error("    · o serviço está no ar?   systemctl status postgresql");
  console.error("    · as credenciais chegaram? (PGHOST/PGUSER/PGPASSWORD/PGDATABASE)");
  console.error("    · o banco existe e o usuário tem acesso?");
  console.error("    Corrigido o problema, NÃO é preciso reiniciar: o sistema");
  console.error("    religa sozinho no primeiro acesso.\n");
})();

/* LA Chat — a SEGUNDA linha do conector, e a que mais se esquece: `upgrade` é
   um evento separado, não passa pelo handler nem por chat.rota(). Sem ela o
   chat autentica e nunca recebe mensagem em tempo real. */
chat.conectarUpgrade(servidor);

// Escuta só no localhost: quem fala com o mundo é o nginx.
// Para expor direto (ambiente sem proxy), rode com HOST=0.0.0.0
servidor.listen(PORT, process.env.HOST || "127.0.0.1", async () => {
  console.log(`\n  LA Clínicas — sistema de gestão v${APP_VERSION}`);
  console.log(`  · Sistema:  http://localhost:${PORT}/restrito/`);
  if (ERRO_GESTAO) {
    console.log(`  · Banco:    ✖ INDISPONÍVEL — servindo aviso 503 até o PostgreSQL responder`);
  } else {
    try {
      const v = await Q.versao();
      console.log(`  · Banco:    PostgreSQL — ${v.d} (usuário ${v.u})`);
    } catch (e) { console.log(`  · Banco:    ✖ ${e.message.split("\n")[0]}`); }
  }
  console.log("");
});
