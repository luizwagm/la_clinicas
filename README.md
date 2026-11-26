# LA Clínicas

Sistema de gestão clínica — agenda, pacientes, prontuário cifrado, testes de
rastreio respondidos pelo paciente por link, auditoria e chat de equipe
(módulo LA-Chat, opcional). Node puro + PostgreSQL, sem framework e sem passo
de build.

**Este repositório tem duas partes**, cada uma com o seu serviço: o sistema
(raiz) e o **site de vendas** (`site/`, estático, porta 5213 — ver
`site/README.md`). Mesmo git e mesmo `deploy.sh`; processos separados.

**Origem:** este projeto nasceu em 02/09/2026 como cópia do sistema `/restrito`
da BemEstarClinic, promovido a produto próprio para evoluir de forma
independente. O site público e o painel `/admin` daquele projeto (SQLite)
ficaram para trás — aqui só existe a gestão, 100% PostgreSQL.

## Rodar

```
npm install
# crie o banco:  CREATE DATABASE laclinicas_gestao
# copie .env.exemplo para .env e preencha (PG* e DADOS_CHAVE)
npm start
```

- Sistema: http://localhost:5204/restrito/
- Página do paciente (link de teste): http://localhost:5204/answer/<código>
- Primeiro boot semeia o acesso inicial — login `admin`, senha `laclinicas-gestao`
  (o console avisa; troque no primeiro acesso).

A raiz `/` redireciona para `/restrito/`. O prefixo foi mantido de propósito:
a sessão é gravada com `Path=/restrito` dentro do `restrito.js`, e traduzir
prefixo é mão dupla (caminho na ida, `Path` do cookie na volta).

## Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `server.js` | Transporte: cabeçalhos, limites, rotas públicas do paciente (`/answer`), 503 com religamento automático do banco |
| `restrito.js` | TODA a regra de negócio: login, sessão, agenda, pacientes, prontuário, testes, auditoria, backup (pg_dump) |
| `restrito/app.html` | A aplicação (tela única) |
| `restrito/answer.html` | A página que o paciente abre pelo link |
| `restrito/favicon.svg` | A marca (provisória) do sistema — servida em `/assets/img/favicon.svg`, o endereço que a tela pede |
| `laclinicas.service`, `nginx/criar-site.sh`, `deploy.sh` | Produção do sistema: molde da unit, instalador (nginx + TLS + systemd) e atualização (que também reinicia o site) |
| `site/` | O site de vendas: `server.js` que entrega só `site/public/` |
| `laclinicas-site.service`, `nginx/criar-site-vendas.sh` | Produção do site de vendas: molde da unit e instalador próprio (sem banco, sem segredo) |
| `restrito/arquivos/` | Anexos enviados — dado sensível, fora do git |
| `pg.js` | Pool do PostgreSQL + leitura do `.env` |
| `cripto.js` | Cifra dos dados sensíveis (`DADOS_CHAVE`) |
| `migrar.js` + `migrations/` | Migrações do esquema (rodam sozinhas no boot) |
| `catalogo-inicial.js` | O que instalação nova já traz: procedimentos por área (com cor, duração e anamnese) e convênios |
| `desafios.js`, `testes-modelos.js` | Testes de rastreio: modelos e interpretação |
| `limitador.js` | Trava de força bruta por IP + por conta, persistida em disco |
| `imagem.js` | Tratamento de foto (sharp): EXIF fora, WEBP |
| `lachat.js` | Conector do LA-Chat (inativo sem `CHAT_SEGREDO_PASSE`) |

## Testes

```
npm run testar
```

As suítes sobem o servidor numa porta da faixa 52xx com banco e arquivo de
limites próprios — não tocam nos dados de desenvolvimento.

## Histórico

- **0.5.1 (26/11/2026) — correções da primeira instalação.** O log anunciava v0.4.1: `APP_VERSION`
  (server.js) e `SISTEMA_VERSION` (restrito.js) eram escritos à mão — agora os dois leem o
  `package.json`. E o ensaio do desafio ACME dos dois instaladores rodava logo depois do
  `reload` do nginx, que é assíncrono: caía nos processos antigos e falhava com o DNS certo.
  Agora tenta por até 10 s.
- **0.5.0 (26/11/2026) — cadastros prontos para começar.** Instalação nova traz o catálogo
  de procedimentos do mercado (`catalogo-inicial.js`: 258 itens, 162 tratamentos em 13 áreas —
  as 29 práticas da PNPIC, as especialidades médicas de consultório, psicologia, fisio, fono,
  nutrição, TO, enfermagem, estética e odonto), cada um com cor, duração e anamnese; e 50
  convênios (Particular, nacionais, autogestões, odontológicos, cartões). Valor e registro ANS
  ficam em branco (seriam inventados). Salas e profissionais NÃO são semeados. Saíram as
  "cores oficiais" e o mapa nome→anamnese herdados (o catálogo já grava os dois). Menu ⋮ com
  **Ativar/Desativar** e filtro de situação em Procedimentos, Convênios e Salas. "Sobre o
  sistema" passa a contar só a história do LA Clínicas (0.1.0 → 0.5.0); a "cópia diária
  automática" saiu das tecnologias (o app não agenda backup — só o download pelo admin).
  As sementes só rodam com a tabela VAZIA: banco que já existia não muda sozinho.
- **0.4.1 (26/11/2026) — busca de CEP de volta.** A tela de pacientes chama `/api/cep/<cep>`,
  mas essa rota morava no servidor do site de origem e não veio na cópia: o endereço pelo
  CEP estava quebrado em silêncio desde a 0.1.0. Rota portada (ViaCEP + BrasilAPI, cache de
  30 dias, 60 consultas/min por IP).
- **0.4.0 (26/11/2026) — identidade Ciclo e dados da clínica.** A tela, as impressões e a
  página do paciente saíram do violeta da clínica de origem para a identidade do produto
  (linho, pinho, terracota; Fraunces + Instrument Sans; símbolo Ciclo). **Dados da clínica**
  (nome, especialidades, CNPJ, WhatsApp, e-mail, site, cidade) passaram do código para o
  banco de cada instalação: menu da conta → Dados da clínica (só administrador). Saíram o
  CNPJ e o WhatsApp de outra empresa do timbre, o logotipo e a marca d’água dela das
  impressões, a fonte embutida (20 KB) da página do paciente, os dois profissionais e os
  convênios semeados no primeiro boot, e o atalho para um painel de site que não existe.
  Rota pública `GET /api/clinica` (nome, cidade, WhatsApp) para a página do paciente e o login.
- **0.3.0 (26/11/2026) — pronto para o servidor.** Conferido: o `/restrito` do BemEstar
  não mudou desde a 0.2.0 (base `685fdce`, gestão 1.43.0) — continua em dia.
  **Correção de data:** "hoje" era cortado em UTC em 5 pontos do servidor e 2 da tela —
  depois das 21h de Caruaru o painel contava a agenda de amanhã, e alta, abertura de
  prontuário, lançamentos e anamneses saíam com a data do dia seguinte. Agora tudo usa
  componentes locais, e o processo fixa `TZ=America/Recife` (o servidor roda em UTC).
  **Kit de produção:** `laclinicas.service`, `nginx/criar-site.sh`, `deploy.sh`,
  `manutencao.html`, `.gitattributes` e o passo a passo em `SUBIR.md`.
- **0.2.0 (15/11/2026) — em dia com o BemEstar (gestão 1.43.0).** Tudo o que o `/restrito`
  do BemEstar ganhou desde a cópia (tela, prontuário, desafios — commits `bded2ed` e
  `5044cb4` de lá) entrou por **junção de três vias** a partir do estado da cópia
  (BemEstar `7919a7e`, 02/09/2026): o rebatismo do LA Clínicas ficou intacto, sem
  conflito. A suíte de desafios veio junto e as 2 falhas de "vencido" da 0.1.0 sumiram.
  Marca provisória própria (a tela pedia o `favicon.svg` do SITE do BemEstar, que não
  existe aqui: imagem quebrada no login desde a cópia). Repositório git criado.
- **0.1.0 (02/09/2026)** — cópia do `/restrito` do BemEstar 1.42.0.

**Para trazer do BemEstar de novo:** a base da próxima junção é o commit do BemEstar
registrado aqui (hoje `685fdce`); `git merge-file` arquivo a arquivo, nunca cópia por cima.

## Produção

Passo a passo completo, do servidor ao primeiro login: **[SUBIR.md](SUBIR.md)**.
Atualizar depois: `sudo bash deploy.sh` (cópia do banco antes, sempre).

`PERDER A DADOS_CHAVE TORNA O BANCO ILEGÍVEL` — guarde cópia fora do servidor.
