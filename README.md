# LA Clínicas

Sistema de gestão clínica — agenda, pacientes, prontuário cifrado, testes de
rastreio respondidos pelo paciente por link, auditoria e chat de equipe
(módulo LA-Chat, opcional). Node puro + PostgreSQL, sem framework e sem passo
de build.

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
| `restrito/arquivos/` | Anexos enviados — dado sensível, fora do git |
| `pg.js` | Pool do PostgreSQL + leitura do `.env` |
| `cripto.js` | Cifra dos dados sensíveis (`DADOS_CHAVE`) |
| `migrar.js` + `migrations/` | Migrações do esquema (rodam sozinhas no boot) |
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

## Produção (quando chegar a hora)

- Variáveis via systemd: `EnvironmentFile=/etc/laclinicas.env` (root:root, 600).
- O listen é só em 127.0.0.1 — quem fala com o mundo é o nginx (HTTPS antes de
  tudo: sob `*.projetos.luizaugust.me` o navegador recusa `http://` por HSTS).
- Chat em produção exige o bloco `location /restrito/chat/ws` no nginx.
- `PERDER A DADOS_CHAVE TORNA O BANCO ILEGÍVEL` — guarde cópia fora do servidor.
