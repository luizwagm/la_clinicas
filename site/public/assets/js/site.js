/* ==========================================================================
   LA Clínicas — site de vendas. Sem biblioteca; tudo funciona sem JS
   (os links de WhatsApp já vêm prontos no HTML), e o JS só melhora.
   ========================================================================== */
const WHATSAPP = "5581971010607";
/* Sem "preço de mercado" aqui: a comparação usa o valor que o VISITANTE digita.
   Um número de concorrente que não conseguimos confirmar em fonte oficial não
   entra no site. */
const VIDEO_POR_PESSOA = 19;   // módulo opcional, fora dos planos
const PLANOS = [
  { nome: "Consultório",    ate: 3,        mensal: 249 },
  { nome: "Clínica",        ate: 10,       mensal: 449 },
  { nome: "Centro Clínico", ate: Infinity, mensal: 790 },
];

document.documentElement.classList.add("js");
const reais = (n) => "R$ " + Math.round(n).toLocaleString("pt-BR");

document.addEventListener("DOMContentLoaded", () => {
  /* ------------------------------------------------------------ ano */
  const ano = document.getElementById("ano");
  if (ano) ano.textContent = String(new Date().getFullYear());

  /* ------------------------------------------------------ topo e menu */
  const topo = document.getElementById("topo");
  const aoRolar = () => topo && topo.classList.toggle("rolou", window.scrollY > 8);
  aoRolar();
  window.addEventListener("scroll", aoRolar, { passive: true });

  const botao = document.querySelector(".menu-botao");
  const menu = document.getElementById("menu");
  if (botao && menu) {
    const fechar = () => { menu.classList.remove("aberto"); botao.setAttribute("aria-expanded", "false"); };
    botao.addEventListener("click", () => {
      const abre = !menu.classList.contains("aberto");
      menu.classList.toggle("aberto", abre);
      botao.setAttribute("aria-expanded", String(abre));
    });
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) fechar(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
  }

  /* ------------------------------------------- revelação ao rolar */
  const alvos = document.querySelectorAll("[data-revela], #fluxo");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) if (e.isIntersecting) { e.target.classList.add("visivel"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    alvos.forEach((el) => io.observe(el));
  } else {
    alvos.forEach((el) => el.classList.add("visivel"));
  }

  /* -------------------------------------------- mensal × anual */
  const botoesPeriodo = document.querySelectorAll("[data-periodo]");
  botoesPeriodo.forEach((b) => b.addEventListener("click", () => {
    const p = b.dataset.periodo;
    botoesPeriodo.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.querySelectorAll(".preco__valor, .preco__nota").forEach((el) => {
      if (el.dataset[p]) el.textContent = el.dataset[p];
    });
    document.querySelectorAll(".preco__mes").forEach((el) => {
      el.textContent = p === "anual" ? "/mês no anual" : "/mês";
    });
  }));

  /* ------------------------------------------------- calculadora */
  const n = document.getElementById("calc-n");
  if (n) {
    const saida = document.getElementById("calc-saida");
    const vMercado = document.getElementById("calc-mercado");
    const vLa = document.getElementById("calc-la");
    const nomePlano = document.getElementById("calc-plano");
    const bMercado = document.getElementById("calc-barra-mercado");
    const bLa = document.getElementById("calc-barra-la");
    const resultado = document.getElementById("calc-resultado");
    const campoPreco = document.getElementById("calc-preco");
    const linhaAtual = document.getElementById("calc-linha-atual");
    const comVideo = document.getElementById("calc-video");
    const destacar = (antes, valor, depois) => {
      resultado.textContent = "";
      const forte = document.createElement("strong");
      forte.textContent = valor;
      resultado.append(antes, forte, depois);
    };
    const atualizar = () => {
      const qtd = Number(n.value);
      const plano = PLANOS.find((p) => qtd <= p.ate);
      const video = comVideo && comVideo.checked ? qtd * VIDEO_POR_PESSOA : 0;
      const total = plano.mensal + video;
      const porProf = Number(String(campoPreco.value).replace(",", "."));
      const temValor = Number.isFinite(porProf) && porProf > 0;
      const hoje = temValor ? qtd * porProf : 0;
      saida.textContent = String(qtd);
      vLa.textContent = reais(total) + "/mês";
      nomePlano.textContent = "LA Clínicas — " + plano.nome + (video ? " + vídeo" : "");
      linhaAtual.hidden = !temValor;
      // CSSOM, não atributo style: a CSP do site não aceita estilo inline.
      if (!temValor) {
        bLa.style.width = "100%";
        const pessoas = `${qtd} ${qtd > 1 ? "profissionais" : "profissional"}`;
        resultado.textContent = video
          ? `Para ${pessoas}, o plano ${plano.nome} com vídeo sai por ${reais(total)} por mês (${reais(plano.mensal)} do plano + ${reais(video)} do vídeo). Digite quanto você paga hoje por profissional para comparar.`
          : `Para ${pessoas}, o plano ${plano.nome} sai por ${reais(plano.mensal)} por mês, com tudo incluído. Digite quanto você paga hoje por profissional para comparar.`;
        return;
      }
      const maior = Math.max(hoje, total, 1);
      vMercado.textContent = reais(hoje) + "/mês";
      bMercado.style.width = (hoje / maior * 100).toFixed(1) + "%";
      bLa.style.width = (total / maior * 100).toFixed(1) + "%";
      const dif = hoje - total;
      if (dif > 0) destacar("Você pagaria ", reais(dif) + " a menos por mês", ` — ${reais(dif * 12)} em um ano.`);
      else if (dif < 0) destacar("Para esse tamanho de equipe, o LA Clínicas custaria ", reais(-dif) + " a mais por mês", " do que você paga hoje.");
      else resultado.textContent = "Os valores empatam para esse tamanho de equipe.";
    };
    n.addEventListener("input", atualizar);
    campoPreco.addEventListener("input", atualizar);
    if (comVideo) comVideo.addEventListener("change", atualizar);
    atualizar();
  }

  /* ----------------------------------- formulário → WhatsApp */
  const form = document.getElementById("form-demo");
  if (form) {
    const erro = document.getElementById("form-erro");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      const nome = String(d.nome || "").trim();
      const clinica = String(d.clinica || "").trim();
      if (!nome || !clinica) {
        erro.textContent = "Conte pelo menos o seu nome e o da clínica.";
        (nome ? form.clinica : form.nome).focus();
        return;
      }
      erro.textContent = "";
      const texto = [
        "Olá! Quero agendar uma demonstração do LA Clínicas.",
        "",
        "Nome: " + nome,
        "Clínica: " + clinica,
        "Profissionais: " + d.equipe,
        "Área: " + d.area,
      ].join("\n");
      window.open("https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
    });
  }
});
