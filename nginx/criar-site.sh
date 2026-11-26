#!/usr/bin/env bash
# ==========================================================================
#  criar-site.sh — instala o LA Clínicas num servidor (nginx + systemd + TLS)
#
#  USO (como root, de dentro da pasta do projeto):
#
#      sudo bash nginx/criar-site.sh laclinicas.projetos.luizaugust.me
#      sudo bash nginx/criar-site.sh laclinicas.projetos.luizaugust.me sistema.clinica-cliente.com.br
#
#  Opções: --porta N (padrão 5204) · --usuario NOME (padrão deploy) · --sem-tls
#  E-mail do Let's Encrypt: o da conta que o certbot já tem neste servidor.
#  Para outro, rode com  EMAIL_TLS=<endereço> sudo -E bash nginx/criar-site.sh ...
#
#  PRÉ-REQUISITOS (o script confere e para com a instrução se faltar):
#    · o banco laclinicas_gestao e o papel laclinicas criados no Postgres
#    · /etc/laclinicas.env com PGPASSWORD e DADOS_CHAVE (640 root:deploy)
#    · o registro A de cada domínio apontando para este servidor
#
#  O SISTEMA INTEIRO É NOINDEX: é gestão clínica, nada aqui deve aparecer em
#  busca. O X-Robots-Tag vai em toda resposta, de todos os endereços.
#
#  A ORDEM IMPORTA: um bloco com ssl_certificate apontando para arquivo que
#  ainda não existe faz o `nginx -t` FALHAR. Por isso:
#      1. nginx só em HTTP, com o caminho do desafio ACME aberto
#      2. certbot emite (certonly --webroot: não encosta na configuração)
#      3. só então entra a configuração definitiva, com HTTPS
# ==========================================================================
set -euo pipefail

APP="laclinicas"
DESTINO="${DESTINO:-$(cd "$(dirname "$0")/.." && pwd)}"
USUARIO="${USUARIO:-deploy}"
GRUPO="${GRUPO:-deploy}"
PORTA="${PORTA:-5204}"
ARQ_ENV="/etc/${APP}.env"
EMAIL_TLS="${EMAIL_TLS:-}"
RAIZ_ACME="/var/www/certbot"
COM_TLS=1
DOMINIOS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --sem-tls)  COM_TLS=0; shift ;;
    --porta)    PORTA="${2:-}"; shift 2 ;;
    --usuario)  USUARIO="${2:-}"; GRUPO="${2:-}"; shift 2 ;;
    -h|--ajuda|--help) sed -n '2,27p' "$0" | sed 's/^#\s\?//'; exit 0 ;;
    -*) echo "opção desconhecida: $1" >&2; exit 1 ;;
    *)  DOMINIOS+=("$1"); shift ;;
  esac
done

msg()   { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
erro()  { printf "\n\033[1;31m✖ %s\033[0m\n" "$*" >&2; exit 1; }
aviso() { printf "\033[1;33m%s\033[0m\n" "$*"; }
bom()   { printf "\033[1;32m%s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || erro "rode como root:  sudo bash nginx/criar-site.sh <domínio>"
[ "${#DOMINIOS[@]}" -gt 0 ] || erro "falta o domínio.  Uso: sudo bash nginx/criar-site.sh laclinicas.projetos.luizaugust.me"
for d in "${DOMINIOS[@]}"; do case "$d" in *.*) : ;; *) erro "\"$d\" não parece um domínio" ;; esac; done
case "$PORTA" in ''|*[!0-9]*) erro "porta inválida: $PORTA" ;; esac

temCertificado() { [ -f "/etc/letsencrypt/live/$1/fullchain.pem" ]; }
# `|| true`: sem conexão o curl imprime 000 E sai com erro; com `|| echo 000`
# a saída virava "000000".
codigo() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-8}" "$1" 2>/dev/null || true; }
enderecosDaMaquina() { ip -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1; }
lerEnv() { sed -n "s/^$1=//p" "$ARQ_ENV" 2>/dev/null | tail -1; }

# www. só existe em domínio RAIZ (empresa.com, empresa.com.br). Pedir
# www.<subdomínio> faz o certbot falhar o LOTE INTEIRO.
ehDominioRaiz() {
  local d="$1" rotulos
  rotulos=$(printf '%s' "$d" | tr '.' '\n' | grep -c .)
  case "$d" in
    *.com.br|*.net.br|*.org.br|*.gov.br|*.edu.br|*.co.uk|*.com.au) [ "$rotulos" -eq 3 ] ;;
    *) [ "$rotulos" -eq 2 ] ;;
  esac
}

# HTTP/2: a diretiva mudou no nginx 1.25.1 (listen ... http2  →  http2 on).
# A forma errada faz o nginx recusar a configuração INTEIRA.
versaoNginx() { nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9][0-9.]*\).*#\1#p'; }
http2Separado() {
  local a b c; IFS=. read -r a b c <<< "$(versaoNginx)"
  a=${a:-0}; b=${b:-0}; c=${c:-0}
  [ "$a" -gt 1 ] && return 0; [ "$a" -lt 1 ] && return 1
  [ "$b" -gt 25 ] && return 0; [ "$b" -lt 25 ] && return 1
  [ "$c" -ge 1 ]
}
linhasListen443() {
  if http2Separado; then printf '    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;'
  else printf '    listen 443 ssl http2;\n    listen [::]:443 ssl http2;'; fi
}

# ==========================================================================
msg "1/8  Conferindo o que precisa existir"
for prog in nginx node npm psql pg_dump curl; do
  command -v "$prog" >/dev/null || erro "$prog não está instalado"
done
node -e 'process.exit(process.versions.node.split(".")[0] >= 20 ? 0 : 1)' \
  || erro "Node 20 ou mais novo é necessário (achei $(node -v))"
[ -f "$DESTINO/server.js" ] && [ -f "$DESTINO/restrito.js" ] || erro "$DESTINO não parece o LA Clínicas"
id "$USUARIO" >/dev/null 2>&1 || erro "o usuário $USUARIO não existe neste servidor"

# PORTA LIVRE AQUI ≠ PORTA LIVRE LÁ. O servidor tem serviços que não existem
# na máquina de desenvolvimento, e um proxy para a porta de outro devolve a
# resposta do VIZINHO, não um erro. Se a porta está ocupada por outro
# processo que não este serviço, para aqui.
if ss -ltnH "( sport = :$PORTA )" 2>/dev/null | grep -q .; then
  if ! systemctl is-active --quiet "$APP" 2>/dev/null; then
    ss -ltnpH "( sport = :$PORTA )" 2>/dev/null | sed 's/^/      /'
    erro "a porta $PORTA já está em uso por outro processo. Escolha outra:  --porta 5214"
  fi
fi

[ -f "$ARQ_ENV" ] || erro "falta $ARQ_ENV — veja o passo 3 do SUBIR.md"
[ -n "$(lerEnv PGPASSWORD)" ] || erro "$ARQ_ENV não tem PGPASSWORD"
CHAVE="$(lerEnv DADOS_CHAVE)"
[ -n "$CHAVE" ] || erro "$ARQ_ENV não tem DADOS_CHAVE"
case "$CHAVE" in cole-aqui*|*troque*) erro "DADOS_CHAVE ainda é o texto de exemplo — gere com: openssl rand -base64 32" ;; esac
[ "$(stat -c '%a' "$ARQ_ENV")" = "640" ] || aviso "    atenção: $ARQ_ENV deveria ser 640 (está $(stat -c '%a' "$ARQ_ENV"))"

echo "    projeto  : $DESTINO"
echo "    dono     : $USUARIO:$GRUPO"
echo "    porta    : $PORTA"
echo "    endereços: ${DOMINIOS[*]}"

# ==========================================================================
msg "2/8  O banco responde com as credenciais do serviço?"
# Conferir AQUI, antes de instalar o serviço: senão ele sobe, serve 503
# "banco indisponível" para sempre, e o erro real fica escondido no journal.
PGH="$(lerEnv PGHOST)"; PGU="$(lerEnv PGUSER)"; PGD="$(lerEnv PGDATABASE)"
ERR_PSQL=$(mktemp)
if ! PGPASSWORD="$(lerEnv PGPASSWORD)" psql -h "${PGH:-127.0.0.1}" -U "${PGU:-laclinicas}" \
      -d "${PGD:-laclinicas_gestao}" -tAc 'SELECT 1' >/dev/null 2>"$ERR_PSQL"; then
  sed 's/^/      /' "$ERR_PSQL"; rm -f "$ERR_PSQL"
  erro "não consegui entrar no banco ${PGD:-laclinicas_gestao} como ${PGU:-laclinicas} — veja o passo 2 do SUBIR.md"
fi
rm -f "$ERR_PSQL"
echo "    conectou em ${PGD:-laclinicas_gestao} como ${PGU:-laclinicas}"

# ==========================================================================
msg "3/8  Dependências e permissões"
cd "$DESTINO"
mkdir -p data backups restrito/arquivos "$RAIZ_ACME"
chown -R "$USUARIO:$GRUPO" "$DESTINO"
sudo -u "$USUARIO" npm ci --omit=dev --no-audit --no-fund
# Anexos do prontuário e cópias do banco: dado sensível de paciente.
chmod 750 data backups restrito/arquivos

# ==========================================================================
msg "4/8  Serviço do systemd"
sed -e "s#__DESTINO__#${DESTINO}#g" -e "s#__USUARIO__#${USUARIO}#g" \
    -e "s#__GRUPO__#${GRUPO}#g"     -e "s#__PORTA__#${PORTA}#g" \
    "$DESTINO/${APP}.service" > "/etc/systemd/system/${APP}.service"
chmod 644 "/etc/systemd/system/${APP}.service"
systemctl daemon-reload
systemctl enable "$APP" >/dev/null
systemctl restart "$APP"

# A porta abre na hora, mas o sistema só atende depois de conectar no banco e
# aplicar as migrations — até lá responde 503. Espera o 200 de verdade.
cod=""
for _ in $(seq 1 45); do
  cod=$(codigo "http://127.0.0.1:${PORTA}/restrito/" 3)
  [ "$cod" = "200" ] && break
  systemctl is-active --quiet "$APP" || break
  sleep 1
done
if [ "$cod" != "200" ]; then
  journalctl -u "$APP" -n 40 --no-pager
  erro "o sistema não ficou pronto (último código: ${cod:-nenhum}) — veja o log acima"
fi
echo "    sistema no ar em 127.0.0.1:$PORTA"
journalctl -u "$APP" -n 40 --no-pager -o cat | grep -E "Login: admin|migration aplicada|sistema de gestão v" | sed 's/^/    /' || true

# ==========================================================================
# GERADOR DO BLOCO DO NGINX — $1 domínio · $2 sim|nao (tem certificado)
# ==========================================================================
corpo_proxy() {
  # X-Real-IP: é o cabeçalho que o app LÊ para a trava de senha. O nginx o
  # SOBRESCREVE a cada requisição (o X-Forwarded-For ele só acrescenta).
  # error_page SEM proxy_intercept_errors: só vale para o 502/504 que o PRÓPRIO
  # nginx gera quando o app não responde. O 503 do app (banco fora, com recado
  # e JSON para a tela) passa intacto.
  cat <<PROXY
    location / {
        proxy_pass http://127.0.0.1:${PORTA};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
        error_page 502 504 =503 @caiu;
    }
    location @caiu { root ${DESTINO}; try_files /manutencao.html =503; internal; }
PROXY
}

escrever_conf() {
  local dom="$1" comHttps="$2"
  local arq="/etc/nginx/sites-available/${dom}.conf"
  local nomes="$dom"
  if ehDominioRaiz "$dom"; then nomes="$dom www.$dom"; fi

  {
    echo "# =========================================================================="
    echo "#  ${dom} · ${APP}"
    echo "#  GERADO por nginx/criar-site.sh — editar aqui é perder na próxima execução."
    echo "#  Projeto: ${DESTINO}   ·   app em 127.0.0.1:${PORTA}"
    echo "# =========================================================================="
    echo "server {"
    echo "    listen 80;"
    echo "    listen [::]:80;"
    echo "    server_name ${nomes};"
    echo "    location /.well-known/acme-challenge/ { root ${RAIZ_ACME}; }"
    if [ "$comHttps" = "sim" ]; then
      echo '    location / { return 301 https://$host$request_uri; }'
      echo "}"
    else
      echo '    add_header X-Robots-Tag "noindex, nofollow" always;'
      echo "    client_max_body_size 12m;"
      corpo_proxy
      echo "}"
    fi

    # `if`, NUNCA `return` aqui dentro: `{ … } > arquivo` é grupo, não
    # subshell, e um return sairia da função inteira pulando o `ln -sf` lá
    # embaixo — o bloco nunca seria ligado e nenhum certificado sairia.
    if [ "$comHttps" = "sim" ]; then
      if ehDominioRaiz "$dom"; then
        cat <<WWW

server {
$(linhasListen443)
    server_name www.${dom};
    ssl_certificate     /etc/letsencrypt/live/${dom}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${dom}/privkey.pem;
    return 301 https://${dom}\$request_uri;
}
WWW
      fi
      cat <<SSL

server {
$(linhasListen443)
    server_name ${dom};

    ssl_certificate     /etc/letsencrypt/live/${dom}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${dom}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # O HSTS quem emite é o app (ele sabe quando veio por HTTPS).
    add_header X-Robots-Tag "noindex, nofollow" always;

    # Anexo do prontuário: o app aceita até 8 MB em base64.
    client_max_body_size 12m;
    access_log /var/log/nginx/${APP}.access.log;
    error_log  /var/log/nginx/${APP}.error.log;

    gzip on;
    gzip_vary on;
    gzip_min_length 512;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # Login barrado na borda: mais barato que acordar o Node.
    location = /restrito/api/login {
        limit_req zone=${APP}_login burst=4 nodelay;
        proxy_pass http://127.0.0.1:${PORTA};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # WebSocket do chat da equipe (LA-Chat). Inerte enquanto o chat estiver
    # desligado; sem este bloco, ligado, o chat autentica e nunca recebe
    # mensagem em tempo real — sem erro visível.
    location /restrito/chat/ws {
        proxy_pass http://127.0.0.1:${PORTA};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }

SSL
      corpo_proxy
      echo ""
      echo '    location ~ /\.                                     { deny all; }'
      # SEM js/json aqui: o cliente do chat é /restrito/chat/cliente.js, e esta
      # regex vence o `location /` — o chat quebraria em silêncio. Os arquivos do
      # projeto (server.js, restrito.js, package.json) o próprio app devolve 404.
      echo '    location ~* \.(sql|sh|service|env|log)$ { deny all; }'
      echo "}"
    fi
  } > "$arq"

  ln -sf "$arq" "/etc/nginx/sites-enabled/${dom}.conf"
}

confirmarBlocoAtivo() {
  # `nginx -t` só diz que nada está QUEBRADO; um bloco que o nginx nem inclui
  # passa no teste. `nginx -T` mostra a configuração realmente montada.
  local dom="$1"
  nginx -T 2>/dev/null | grep -qE "server_name[^;]*\b${dom//./\\.}\b" && return 0
  aviso "    ✖ o nginx NÃO carrega o bloco de ${dom} — confira:"
  aviso "      ls -la /etc/nginx/sites-enabled/ ;  grep -n include /etc/nginx/nginx.conf"
  return 1
}

# ==========================================================================
msg "5/8  nginx"
sed "s/__APP__/${APP}/g" "$DESTINO/nginx/${APP}-limites.conf" > "/etc/nginx/conf.d/${APP}-limites.conf"
chmod 644 "/etc/nginx/conf.d/${APP}-limites.conf"

# Um vhost ruim deixado ligado derruba o PRÓXIMO reload de QUALQUER site da
# máquina. Guardamos o que havia e, se o teste falhar, devolvemos.
RESERVA=$(mktemp -d)
guardar() { for dom in "${DOMINIOS[@]}"; do
  if [ -f "/etc/nginx/sites-available/${dom}.conf" ]; then cp "/etc/nginx/sites-available/${dom}.conf" "$RESERVA/"; fi
done; }
desfazer() { for dom in "${DOMINIOS[@]}"; do
  if [ -f "$RESERVA/${dom}.conf" ]; then cp "$RESERVA/${dom}.conf" "/etc/nginx/sites-available/${dom}.conf"
  else rm -f "/etc/nginx/sites-enabled/${dom}.conf" "/etc/nginx/sites-available/${dom}.conf"; fi
done; }

guardar
for dom in "${DOMINIOS[@]}"; do
  if temCertificado "$dom"; then escrever_conf "$dom" sim; echo "    ${dom}: HTTPS (certificado já existe)"
  else escrever_conf "$dom" nao; echo "    ${dom}: provisório em HTTP"; fi
done
if ! nginx -t; then desfazer; erro "a configuração do nginx tem erro — desfeito, nada foi recarregado"; fi
systemctl reload nginx || erro "o nginx não recarregou — veja: systemctl status nginx"

BLOCOS_ATIVOS=1
for dom in "${DOMINIOS[@]}"; do confirmarBlocoAtivo "$dom" || BLOCOS_ATIVOS=0; done
if [ "$BLOCOS_ATIVOS" -eq 1 ]; then echo "    o nginx carrega os blocos deste sistema"; fi

# ==========================================================================
if [ "$COM_TLS" -eq 1 ] && [ "$BLOCOS_ATIVOS" -eq 0 ]; then
  msg "6/8  Certificado TLS — pulado (o nginx não carrega o bloco; o desafio daria 404)"
  COM_TLS=0
fi
if [ "$COM_TLS" -eq 1 ]; then
  msg "6/8  Certificado TLS"
  command -v certbot >/dev/null || erro "certbot não está instalado (apt install -y certbot)"

  # ENSAIO DO DESAFIO antes de pedir: o Let's Encrypt limita tentativas por
  # semana, e descobrir um 404 gastando emissão de verdade é caro.
  ensaiarDesafio() {
    local dom="$1" nome arq corpo ip
    nome="ensaio-$$-$(date +%s)"
    arq="${RAIZ_ACME}/.well-known/acme-challenge/${nome}"
    mkdir -p "$(dirname "$arq")"; echo "ensaio-criar-site" > "$arq"; chmod 644 "$arq"
    # O reload do nginx é ASSÍNCRONO: logo depois dele, os processos antigos
    # ainda atendem sem o bloco novo, e o primeiro pedido cai em outro site.
    # Foi o que aconteceu na primeira instalação (DNS certo, ensaio falhou,
    # e um minuto depois o mesmo endereço respondia). Tenta por até 10 s.
    corpo=""
    for _ in 1 2 3 4 5; do
      corpo=$(curl -s --max-time 10 "http://${dom}/.well-known/acme-challenge/${nome}" 2>/dev/null || true)
      [ "$corpo" = "ensaio-criar-site" ] && break
      sleep 2
    done
    rm -f "$arq"
    if [ "$corpo" = "ensaio-criar-site" ]; then return 0; fi
    ip=$(getent hosts "$dom" 2>/dev/null | awk '{print $1}' | head -1)
    if [ -z "$ip" ]; then
      aviso "    $dom: o nome não resolve — falta o registro A para este servidor."
    elif ! enderecosDaMaquina | grep -qx "$ip"; then
      aviso "    $dom: resolve para $ip, que NÃO é desta máquina (registro A errado, ou proxy/nuvem laranja do Cloudflare na frente)."
    else
      aviso "    $dom: o DNS está certo e o desafio falhou — confira o firewall (ufw allow 'Nginx Full') e:"
      aviso "      sudo nginx -T 2>&1 | grep -n -B3 -A10 '$dom'"
    fi
    return 1
  }

  CONTA=(--agree-tos)
  if [ -n "$EMAIL_TLS" ]; then CONTA+=(-m "$EMAIL_TLS"); fi
  for dom in "${DOMINIOS[@]}"; do
    if temCertificado "$dom"; then echo "    $dom: já tem certificado"; continue; fi
    if ! ensaiarDesafio "$dom"; then aviso "      → sem certificado para $dom. Corrija e rode de novo."; continue; fi
    extra=()
    if ehDominioRaiz "$dom"; then extra=(-d "www.${dom}"); fi
    # Um certificado POR ENDEREÇO: se um sair do ar, a renovação do outro segue.
    if certbot certonly --webroot -w "$RAIZ_ACME" -d "$dom" "${extra[@]}" --non-interactive "${CONTA[@]}"; then
      bom "    $dom: certificado emitido"
    else
      aviso "    $dom: não consegui emitir — confira com:  dig +short $dom"
      aviso "      (se o certbot pedir e-mail, este servidor não tem conta: rode com EMAIL_TLS=...)"
    fi
  done

  msg "7/8  Configuração definitiva, agora com HTTPS"
  rm -f "$RESERVA"/*.conf; guardar
  for dom in "${DOMINIOS[@]}"; do
    if temCertificado "$dom"; then escrever_conf "$dom" sim; echo "    ${dom}: HTTPS ligado"
    else
      aviso "    ${dom}: segue em HTTP, sem certificado."
      aviso "      Sob *.projetos.luizaugust.me o navegador RECUSA http:// (HSTS do domínio-pai):"
      aviso "      o endereço só abre depois que o certificado sair."
    fi
  done
  if ! nginx -t; then desfazer; erro "a configuração definitiva tem erro — devolvi o provisório"; fi
  systemctl reload nginx

  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/recarregar-nginx.sh
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/recarregar-nginx.sh
else
  msg "6/8 e 7/8  TLS pulado — o sistema está em HTTP"
fi
rm -rf "$RESERVA"

# ==========================================================================
msg "8/8  Conferindo"
falhou=0
confere() {  # rótulo · url · código esperado
  local cod; cod=$(codigo "$2")
  printf "    %-44s %s (esperado %s)\n" "$1" "${cod:-sem resposta}" "$3"
  if [ "$cod" != "$3" ]; then falhou=1; fi
}
confere "o sistema"              "http://127.0.0.1:${PORTA}/restrito/"                200
confere "página do paciente"     "http://127.0.0.1:${PORTA}/answer/AAAAAAAA"          200
confere "código fonte pela web"  "http://127.0.0.1:${PORTA}/server.js"                404
confere "regras pela web"        "http://127.0.0.1:${PORTA}/restrito.js"              404
confere "credenciais pela web"   "http://127.0.0.1:${PORTA}/.env"                     404
confere "anexo sem login"        "http://127.0.0.1:${PORTA}/restrito/arquivos/x.png"  403
for dom in "${DOMINIOS[@]}"; do
  cod=$(codigo "https://${dom}/restrito/" 12)
  printf "    %-44s %s\n" "https://${dom}/restrito/" "${cod:-sem resposta (certificado ainda não emitido?)}"
done

echo
if [ "$falhou" -eq 0 ]; then bom "  Pronto."; else aviso "  Subiu com pendências — veja acima."; fi
cat <<FIM

  Sistema  : https://${DOMINIOS[0]}/restrito/
  Projeto  : ${DESTINO}   (dono ${USUARIO}:${GRUPO}, porta ${PORTA})
  Serviço  : systemctl status ${APP}   ·   journalctl -u ${APP} -f

  LOGIN INICIAL: admin / laclinicas-gestao
  Ela é pública no repositório — troque no PRIMEIRO acesso.

FIM
