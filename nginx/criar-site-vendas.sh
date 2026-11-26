#!/usr/bin/env bash
# ==========================================================================
#  criar-site-vendas.sh — instala o SITE DE VENDAS (pasta site/) num servidor
#  (nginx + systemd + TLS). O sistema da clínica é outro instalador:
#  nginx/criar-site.sh. Mesmo repositório, dois serviços.
#
#  USO (como root, de dentro da pasta do projeto):
#
#      sudo bash nginx/criar-site-vendas.sh laclinicas-site.projetos.luizaugust.me
#      sudo bash nginx/criar-site-vendas.sh laclinicas.com.br
#
#  Opções: --porta N (padrão 5213) · --usuario NOME (padrão deploy) · --sem-tls
#          --noindex (fora do Google; LIGADO sozinho em *.projetos.luizaugust.me,
#          que é endereço de trabalho e não pode concorrer com o domínio real)
#  E-mail do Let's Encrypt: o da conta que o certbot já tem neste servidor.
#  Para outro:  EMAIL_TLS=<endereço> sudo -E bash nginx/criar-site-vendas.sh ...
#
#  PRÉ-REQUISITO: o registro A de cada domínio apontando para este servidor.
#  O site NÃO usa banco nem segredo nenhum.
#
#  A ORDEM IMPORTA: um bloco com ssl_certificate apontando para arquivo que
#  ainda não existe faz o `nginx -t` FALHAR. Por isso: HTTP com o desafio ACME
#  aberto → certbot (certonly --webroot) → configuração definitiva com HTTPS.
# ==========================================================================
set -euo pipefail

APP="laclinicas-site"
DESTINO="${DESTINO:-$(cd "$(dirname "$0")/.." && pwd)}"
USUARIO="${USUARIO:-deploy}"
GRUPO="${GRUPO:-deploy}"
PORTA="${PORTA:-5213}"
EMAIL_TLS="${EMAIL_TLS:-}"
RAIZ_ACME="/var/www/certbot"
COM_TLS=1
NOINDEX=0
DOMINIOS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --sem-tls)  COM_TLS=0; shift ;;
    --noindex)  NOINDEX=1; shift ;;
    --porta)    PORTA="${2:-}"; shift 2 ;;
    --usuario)  USUARIO="${2:-}"; GRUPO="${2:-}"; shift 2 ;;
    -h|--ajuda|--help) sed -n '2,25p' "$0" | sed 's/^#\s\?//'; exit 0 ;;
    -*) echo "opção desconhecida: $1" >&2; exit 1 ;;
    *)  DOMINIOS+=("$1"); shift ;;
  esac
done

msg()   { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
erro()  { printf "\n\033[1;31m✖ %s\033[0m\n" "$*" >&2; exit 1; }
aviso() { printf "\033[1;33m%s\033[0m\n" "$*"; }
bom()   { printf "\033[1;32m%s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || erro "rode como root:  sudo bash nginx/criar-site-vendas.sh <domínio>"
[ "${#DOMINIOS[@]}" -gt 0 ] || erro "falta o domínio.  Uso: sudo bash nginx/criar-site-vendas.sh laclinicas-site.projetos.luizaugust.me"
for d in "${DOMINIOS[@]}"; do
  case "$d" in *.*) : ;; *) erro "\"$d\" não parece um domínio" ;; esac
  case "$d" in *.projetos.luizaugust.me) NOINDEX=1 ;; esac
done
case "$PORTA" in ''|*[!0-9]*) erro "porta inválida: $PORTA" ;; esac

temCertificado() { [ -f "/etc/letsencrypt/live/$1/fullchain.pem" ]; }
codigo() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-8}" "$1" 2>/dev/null || true; }
enderecosDaMaquina() { ip -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1; }

# www. só existe em domínio RAIZ. Pedir www.<subdomínio> faz o certbot falhar
# o LOTE INTEIRO.
ehDominioRaiz() {
  local d="$1" rotulos
  rotulos=$(printf '%s' "$d" | tr '.' '\n' | grep -c .)
  case "$d" in
    *.com.br|*.net.br|*.org.br|*.gov.br|*.edu.br|*.co.uk|*.com.au) [ "$rotulos" -eq 3 ] ;;
    *) [ "$rotulos" -eq 2 ] ;;
  esac
}

# HTTP/2: a diretiva mudou no nginx 1.25.1 (listen ... http2  →  http2 on).
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
msg "1/7  Conferindo o que precisa existir"
for prog in nginx node curl; do
  command -v "$prog" >/dev/null || erro "$prog não está instalado"
done
node -e 'process.exit(process.versions.node.split(".")[0] >= 20 ? 0 : 1)' \
  || erro "Node 20 ou mais novo é necessário (achei $(node -v))"
[ -f "$DESTINO/site/server.js" ] && [ -f "$DESTINO/site/public/index.html" ] \
  || erro "$DESTINO/site não parece o site de vendas do LA Clínicas"
[ -f "$DESTINO/${APP}.service" ] || erro "falta o molde $DESTINO/${APP}.service"
id "$USUARIO" >/dev/null 2>&1 || erro "o usuário $USUARIO não existe neste servidor"

# PORTA LIVRE AQUI ≠ PORTA LIVRE LÁ: um proxy para a porta de outro serviço
# devolve a página do VIZINHO, não um erro.
if ss -ltnH "( sport = :$PORTA )" 2>/dev/null | grep -q .; then
  if ! systemctl is-active --quiet "$APP" 2>/dev/null; then
    ss -ltnpH "( sport = :$PORTA )" 2>/dev/null | sed 's/^/      /'
    erro "a porta $PORTA já está em uso por outro processo. Escolha outra:  --porta 5215"
  fi
fi

echo "    projeto  : $DESTINO/site"
echo "    dono     : $USUARIO:$GRUPO"
echo "    porta    : $PORTA"
echo "    endereços: ${DOMINIOS[*]}"
if [ "$NOINDEX" -eq 1 ]; then echo "    busca    : FORA do Google (noindex)"; else echo "    busca    : indexável"; fi

# ==========================================================================
msg "2/7  Serviço do systemd"
mkdir -p "$RAIZ_ACME"
chown -R "$USUARIO:$GRUPO" "$DESTINO/site"
sed -e "s#__DESTINO__#${DESTINO}#g" -e "s#__USUARIO__#${USUARIO}#g" \
    -e "s#__GRUPO__#${GRUPO}#g"     -e "s#__PORTA__#${PORTA}#g" \
    "$DESTINO/${APP}.service" > "/etc/systemd/system/${APP}.service"
chmod 644 "/etc/systemd/system/${APP}.service"
systemctl daemon-reload
systemctl enable "$APP" >/dev/null
systemctl restart "$APP"

cod=""
for _ in $(seq 1 20); do
  cod=$(codigo "http://127.0.0.1:${PORTA}/" 3)
  [ "$cod" = "200" ] && break
  systemctl is-active --quiet "$APP" || break
  sleep 1
done
if [ "$cod" != "200" ]; then
  journalctl -u "$APP" -n 30 --no-pager
  erro "o site não respondeu (último código: ${cod:-nenhum}) — veja o log acima"
fi
echo "    site no ar em 127.0.0.1:$PORTA"

# ==========================================================================
# GERADOR DO BLOCO DO NGINX — $1 domínio · $2 sim|nao (tem certificado)
# ==========================================================================
linhaRobots() {
  if [ "$NOINDEX" -eq 1 ]; then echo '    add_header X-Robots-Tag "noindex, nofollow" always;'; fi
}
corpo_proxy() {
  cat <<PROXY
    location / {
        proxy_pass http://127.0.0.1:${PORTA};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Domínio próprio = site na raiz. Vazio aqui apaga o cabeçalho que o
        # visitante mandar: quem diz onde o site está montado é o nginx.
        proxy_set_header X-Forwarded-Prefix "";
        proxy_read_timeout 30s;
    }
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
    echo "#  GERADO por nginx/criar-site-vendas.sh — editar aqui é perder na próxima execução."
    echo "#  Projeto: ${DESTINO}/site   ·   app em 127.0.0.1:${PORTA}"
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
      linhaRobots
      corpo_proxy
      echo "}"
    fi

    # `if`, NUNCA `return` aqui dentro: `{ … } > arquivo` é grupo, não
    # subshell, e um return pularia o `ln -sf` lá embaixo.
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

    # HSTS e os demais cabeçalhos de segurança quem emite é o app.
    access_log /var/log/nginx/${APP}.access.log;
    error_log  /var/log/nginx/${APP}.error.log;

    gzip on;
    gzip_vary on;
    gzip_min_length 512;
    gzip_types text/plain text/css application/javascript application/xml image/svg+xml application/manifest+json;

SSL
      linhaRobots
      corpo_proxy
      echo ""
      echo '    location ~ /\.  { deny all; }'
      echo "}"
    fi
  } > "$arq"

  ln -sf "$arq" "/etc/nginx/sites-enabled/${dom}.conf"
}

confirmarBlocoAtivo() {
  # `nginx -t` só diz que nada está QUEBRADO; `nginx -T` mostra o que carrega.
  local dom="$1"
  nginx -T 2>/dev/null | grep -qE "server_name[^;]*\b${dom//./\\.}\b" && return 0
  aviso "    ✖ o nginx NÃO carrega o bloco de ${dom} — confira:"
  aviso "      ls -la /etc/nginx/sites-enabled/ ;  grep -n include /etc/nginx/nginx.conf"
  return 1
}

# ==========================================================================
msg "3/7  nginx"
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
if [ "$BLOCOS_ATIVOS" -eq 1 ]; then echo "    o nginx carrega os blocos do site"; fi

# ==========================================================================
if [ "$COM_TLS" -eq 1 ] && [ "$BLOCOS_ATIVOS" -eq 0 ]; then
  msg "4/7  Certificado TLS — pulado (o nginx não carrega o bloco; o desafio daria 404)"
  COM_TLS=0
fi
if [ "$COM_TLS" -eq 1 ]; then
  msg "4/7  Certificado TLS"
  command -v certbot >/dev/null || erro "certbot não está instalado (apt install -y certbot)"

  # ENSAIO DO DESAFIO antes de pedir: o Let's Encrypt limita tentativas.
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
      aviso "    $dom: resolve para $ip, que NÃO é desta máquina (registro A errado, ou proxy do Cloudflare na frente)."
    else
      aviso "    $dom: o DNS está certo e o desafio falhou — confira o firewall (ufw allow 'Nginx Full')."
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
    if certbot certonly --webroot -w "$RAIZ_ACME" -d "$dom" "${extra[@]}" --non-interactive "${CONTA[@]}"; then
      bom "    $dom: certificado emitido"
    else
      aviso "    $dom: não consegui emitir — confira com:  dig +short $dom"
      aviso "      (se o certbot pedir e-mail, este servidor não tem conta: rode com EMAIL_TLS=...)"
    fi
  done

  msg "5/7  Configuração definitiva, agora com HTTPS"
  rm -f "$RESERVA"/*.conf; guardar
  for dom in "${DOMINIOS[@]}"; do
    if temCertificado "$dom"; then escrever_conf "$dom" sim; echo "    ${dom}: HTTPS ligado"
    else
      aviso "    ${dom}: segue em HTTP, sem certificado."
      aviso "      Sob *.projetos.luizaugust.me o navegador RECUSA http:// (HSTS do domínio-pai)."
    fi
  done
  if ! nginx -t; then desfazer; erro "a configuração definitiva tem erro — devolvi o provisório"; fi
  systemctl reload nginx

  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/recarregar-nginx.sh
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/recarregar-nginx.sh
else
  msg "4/7 e 5/7  TLS pulado — o site está em HTTP"
fi
rm -rf "$RESERVA"

# ==========================================================================
msg "6/7  Conferindo"
falhou=0
confere() {  # rótulo · url · código esperado
  local cod; cod=$(codigo "$2")
  printf "    %-36s %s (esperado %s)\n" "$1" "${cod:-sem resposta}" "$3"
  if [ "$cod" != "$3" ]; then falhou=1; fi
}
confere "a página de vendas"     "http://127.0.0.1:${PORTA}/"              200
confere "privacidade"            "http://127.0.0.1:${PORTA}/privacidade/"  200
confere "código do site pela web" "http://127.0.0.1:${PORTA}/server.js"     404
confere "package.json pela web"  "http://127.0.0.1:${PORTA}/package.json"  404
confere "travessia ../"          "http://127.0.0.1:${PORTA}/..%2fserver.js" 404
for dom in "${DOMINIOS[@]}"; do
  cod=$(codigo "https://${dom}/" 12)
  printf "    %-36s %s\n" "https://${dom}/" "${cod:-sem resposta (certificado ainda não emitido?)}"
done

msg "7/7  Resumo"
if [ "$falhou" -eq 0 ]; then bom "  Pronto."; else aviso "  Subiu com pendências — veja acima."; fi
cat <<FIM

  Site     : https://${DOMINIOS[0]}/
  Projeto  : ${DESTINO}/site   (dono ${USUARIO}:${GRUPO}, porta ${PORTA})
  Serviço  : systemctl status ${APP}   ·   journalctl -u ${APP} -f
  Atualizar: o mesmo  sudo bash deploy.sh  do sistema — ele reinicia os dois.

FIM
