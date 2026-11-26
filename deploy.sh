#!/usr/bin/env bash
# ==========================================================================
#  deploy.sh — atualiza o LA Clínicas no servidor
#
#      cd /var/www/projetos/LA-Clinicas && sudo bash deploy.sh
#
#  Ordem: o que vem → CÓPIA DO BANCO → git pull → dependências → reinicia →
#  espera o sistema ficar pronto (as migrations rodam no boot) → confere.
#
#  SEM CÓPIA, SEM ATUALIZAÇÃO: se o pg_dump falhar, para aqui. É prontuário de
#  paciente; uma migration nova sem cópia anterior não tem volta.
#  Por sua conta e risco:  SEM_BACKUP_PG=1 sudo -E bash deploy.sh
#
#  O SITE DE VENDAS (pasta site/) mora no mesmo repositório, em serviço
#  próprio (laclinicas-site). Se ele já foi instalado (criar-site-vendas.sh),
#  é reiniciado e conferido junto; se não, é ignorado.
#
#  O que o git NÃO toca (está no .gitignore): restrito/arquivos/ (anexos),
#  backups/, data/ e o .env. O banco mora no Postgres, fora da pasta.
# ==========================================================================
set -euo pipefail

APP="laclinicas"
SITE="laclinicas-site"
DESTINO="$(cd "$(dirname "$0")" && pwd)"
ARQ_ENV="/etc/${APP}.env"

msg()   { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
erro()  { printf "\n\033[1;31m✖ %s\033[0m\n" "$*" >&2; exit 1; }
bom()   { printf "\033[1;32m%s\033[0m\n" "$*"; }
lerEnv() { sed -n "s/^$1=//p" "$ARQ_ENV" 2>/dev/null | tail -1; }
codigo() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-5}" "$1" 2>/dev/null || true; }

[ "$(id -u)" -eq 0 ] || erro "rode como root:  sudo bash deploy.sh"
systemctl cat "$APP" >/dev/null 2>&1 || erro "o serviço $APP não está instalado — a primeira subida é pelo nginx/criar-site.sh"

# Dono e porta saem da unit instalada: um lugar só dizendo isso.
USUARIO="$(systemctl show -p User --value "$APP")"; USUARIO="${USUARIO:-deploy}"
PORTA="$(systemctl show -p Environment --value "$APP" | tr ' ' '\n' | sed -n 's/^PORT=//p')"
PORTA="${PORTA:-5204}"
TEM_SITE=0; PORTA_SITE=""
if systemctl cat "$SITE" >/dev/null 2>&1; then
  TEM_SITE=1
  PORTA_SITE="$(systemctl show -p Environment --value "$SITE" | tr ' ' '\n' | sed -n 's/^PORT=//p')"
  PORTA_SITE="${PORTA_SITE:-5213}"
fi
cd "$DESTINO"
comoDono() { sudo -u "$USUARIO" "$@"; }

# --------------------------------------------------------------------------
msg "1/6  O que vem"
comoDono git fetch --quiet
if [ -n "$(comoDono git status --porcelain --untracked-files=no)" ]; then
  comoDono git status --short --untracked-files=no
  erro "há arquivos do projeto alterados NO SERVIDOR — o pull os atropelaria. Resolva antes (git diff)."
fi
NOVOS="$(comoDono git log --oneline HEAD..@{u})"
if [ -z "$NOVOS" ] && [ -z "${FORCAR:-}" ]; then
  bom "    já está na última versão ($(comoDono git log -1 --format='%h %s'))"
  echo "    para reinstalar mesmo assim:  FORCAR=1 sudo -E bash deploy.sh"
  exit 0
fi
printf '%s\n' "$NOVOS" | sed 's/^/    /'

# --------------------------------------------------------------------------
msg "2/6  Cópia do banco ANTES de mexer"
mkdir -p backups
PGU="$(lerEnv PGUSER)"; PGD="$(lerEnv PGDATABASE)"; PGH="$(lerEnv PGHOST)"
BANCO="${PGD:-laclinicas_gestao}"
COPIA="backups/${BANCO}.$(date +%Y-%m-%d_%H%M%S).sql"
if PGPASSWORD="$(lerEnv PGPASSWORD)" pg_dump -h "${PGH:-127.0.0.1}" -U "${PGU:-laclinicas}" \
     --no-owner --no-privileges -f "$COPIA" "$BANCO"; then
  chown "$USUARIO:$USUARIO" "$COPIA"; chmod 640 "$COPIA"
  echo "    $COPIA ($(du -h "$COPIA" | cut -f1))"
else
  rm -f "$COPIA"
  if [ -n "${SEM_BACKUP_PG:-}" ]; then echo "    ⚠ pg_dump falhou — seguindo SEM cópia (SEM_BACKUP_PG=1)"
  else erro "o pg_dump falhou — nada foi atualizado. Veja a mensagem acima."; fi
fi

# --------------------------------------------------------------------------
msg "3/6  Código novo"
comoDono git pull --ff-only --quiet
echo "    agora em $(comoDono git log -1 --format='%h %s')"

msg "4/6  Dependências"
comoDono npm ci --omit=dev --no-audit --no-fund --loglevel=error

# A unit pode ter mudado no repositório; reinstalar mantém dono, pasta e porta.
sed -e "s#__DESTINO__#${DESTINO}#g" -e "s#__USUARIO__#${USUARIO}#g" \
    -e "s#__GRUPO__#${USUARIO}#g"   -e "s#__PORTA__#${PORTA}#g" \
    "${APP}.service" > "/etc/systemd/system/${APP}.service"
if [ "$TEM_SITE" -eq 1 ]; then
  sed -e "s#__DESTINO__#${DESTINO}#g" -e "s#__USUARIO__#${USUARIO}#g" \
      -e "s#__GRUPO__#${USUARIO}#g"   -e "s#__PORTA__#${PORTA_SITE}#g" \
      "${SITE}.service" > "/etc/systemd/system/${SITE}.service"
fi
systemctl daemon-reload

# --------------------------------------------------------------------------
msg "5/6  Reiniciando (as migrations novas rodam agora)"
systemctl restart "$APP"
cod=""
for _ in $(seq 1 60); do
  cod=$(codigo "http://127.0.0.1:${PORTA}/restrito/" 3)
  [ "$cod" = "200" ] && break
  sleep 1
done
if [ "$cod" != "200" ]; then
  journalctl -u "$APP" -n 50 --no-pager
  erro "o sistema não ficou pronto (último código: ${cod:-nenhum}). A cópia do banco está em ${COPIA:-—}."
fi

if [ "$TEM_SITE" -eq 1 ]; then
  echo "    site de vendas: reiniciando"
  systemctl restart "$SITE"
  cod=""
  for _ in $(seq 1 20); do
    cod=$(codigo "http://127.0.0.1:${PORTA_SITE}/" 3)
    [ "$cod" = "200" ] && break
    sleep 1
  done
  if [ "$cod" != "200" ]; then
    journalctl -u "$SITE" -n 30 --no-pager
    erro "o SISTEMA está no ar, mas o site de vendas não respondeu (último código: ${cod:-nenhum})."
  fi
fi

# --------------------------------------------------------------------------
msg "6/6  Conferindo"
journalctl -u "$APP" --since "-2 min" --no-pager -o cat | grep -E "sistema de gestão v|migration aplicada|✖" | sed 's/^/    /' || true
for alvo in /server.js /.env /restrito.js; do
  c=$(codigo "http://127.0.0.1:${PORTA}${alvo}")
  [ "$c" = "404" ] || erro "${alvo} respondeu ${c} pela web (tinha de ser 404)"
done
if [ "$TEM_SITE" -eq 1 ]; then
  for alvo in /server.js /package.json; do
    c=$(codigo "http://127.0.0.1:${PORTA_SITE}${alvo}")
    [ "$c" = "404" ] || erro "site: ${alvo} respondeu ${c} pela web (tinha de ser 404)"
  done
  bom "  Sistema e site de vendas atualizados e no ar."
else
  bom "  Atualizado e no ar."
fi
