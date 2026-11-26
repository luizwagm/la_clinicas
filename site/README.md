# LA Clínicas — site de vendas

Site do produto **LA Clínicas** (o sistema de gestão, na raiz deste mesmo repositório). Estático,
sem dependências, servido por um `server.js` mínimo que entrega **só** a pasta `public/`.

```
cd site && node server.js     # http://localhost:5213/
```

| Caminho | O quê |
|---|---|
| `/` | Página de vendas (uma página, com âncoras) |
| `/privacidade/` | Política de privacidade do site |
| `/marca/` | Manual da marca (noindex) — símbolo, cores, tipografia, voz |
| `/404.html` | Página de erro |

## Identidade "Ciclo"

Símbolo: anel aberto com um ponto na abertura (C de Clínicas · ciclo do
tratamento · a pessoa acompanhada). Linho `#FAF6F0` (fundo), Pinho `#16302B`
(estrutura), Terracota `#B4502A` (ação). Fraunces + Instrument Sans.
Tudo documentado em `/marca/`.

## Preços (decididos em 26/11/2026)

**Tudo incluído em todos os planos** — o que muda é só o número de profissionais
(recepção e administração não contam). Testes de rastreio por link: envios ilimitados.

| Plano | Profissionais | Mensal | Anual (10×) | Implantação |
|---|---|---|---|---|
| Consultório | até 3 | R$ 249 | R$ 2.490 | R$ 200 |
| Clínica | até 10 | R$ 449 | R$ 4.490 | R$ 200 |
| Centro Clínico | sem limite | R$ 790 | R$ 7.900 | R$ 200 |

**Módulo de vídeo (fora dos planos):** + R$ 19 por pessoa da equipe com o vídeo ligado, por mês.
Pacientes e convidados que entram pelo link não pagam. O preço está também em `VIDEO_POR_PESSOA`
(site.js) e no JSON-LD.

Os números aparecem em três lugares que precisam andar juntos: os cards de
`index.html` (atributos `data-mensal`/`data-anual`), o JSON-LD do `index.html`
e a tabela `PLANOS` do `assets/js/site.js` (calculadora).

**Regra do site: nada inventado.** A calculadora compara com o valor que o
visitante digita — não há preço de concorrente no site, porque nenhum foi
confirmado em fonte oficial. Números do sistema (13 testes, 38 atualizações,
290 verificações) saem do código e precisam ser conferidos ao mudar.

## Pendências antes de publicar

- Domínio: o site usa `https://laclinicas.com.br/` em canonical, OG, sitemap e
  JSON-LD — confirmar/registrar e trocar se for outro.
- O sistema ainda não limita o número de profissionais por plano (a única trava
  necessária, já que todos os planos têm tudo).

## Histórico

- **1.2.0 (26/11/2026)** — vídeo virou módulo opcional por pessoa (R$ 19/pessoa/mês), fora
  dos planos: seção própria, pergunta na FAQ, oferta no JSON-LD e opção na calculadora. O chat
  (mensagens) segue incluído em todos os planos.
- **1.1.0 (26/11/2026)** — planos com tudo incluído (muda só o número de profissionais),
  implantação de R$ 200 para todos, envios de teste ilimitados; nomes Consultório / Clínica /
  Centro Clínico. Revisão de veracidade: saíram o preço de mercado não confirmado, "o mais
  escolhido", "5 dias úteis", "30 minutos", "40+ versões", backup diário fora do servidor,
  "quem abriu qual prontuário", lançamentos "que não se apagam" e a vista semanal da agenda.
- **1.0.0 (26/11/2026)** — primeira versão: identidade, página de vendas,
  três planos, calculadora, manual da marca, privacidade.
