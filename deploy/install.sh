#!/usr/bin/env bash
# =====================================================================
#  ÁREA 41 SHOP — instalação na VPS (Ubuntu/Debian)
#  Uso (logado na VPS como root):
#    bash install.sh https://github.com/SEU_USUARIO/area41-shop.git seudominio.com
#  O domínio é opcional. Sem domínio, o site abre pelo IP da VPS.
#  Pode rodar de novo quantas vezes quiser: não apaga produtos nem fotos.
# =====================================================================
set -euo pipefail

REPO="${1:?Informe a URL do repositório do GitHub}"
DOMAIN="${2:-}"
DIR=/var/www/area41-shop
DATA=/var/lib/area41

echo ">> Instalando nginx, git e Node.js..."
apt-get update -y
apt-get install -y nginx git curl ca-certificates
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || true)
if [ "${NODE_MAJOR:-0}" -lt 18 ] 2>/dev/null || [ -z "$NODE_MAJOR" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "   Node $(node -v)"

echo ">> Baixando o site..."
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  rm -rf "$DIR"
  git clone "$REPO" "$DIR"
fi
chown -R www-data:www-data "$DIR"

echo ">> Preparando a pasta de dados (produtos, fotos, senha)..."
id -u area41 >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin area41
mkdir -p "$DATA/uploads"
chown -R area41:area41 "$DATA"
chmod 751 "$DATA"
chmod 755 "$DATA/uploads"

echo ">> Criando o serviço da API..."
cat > /etc/systemd/system/area41-api.service <<EOF
[Unit]
Description=AREA 41 SHOP API
After=network.target

[Service]
User=area41
Group=area41
Environment=PORT=4141
Environment=DATA_DIR=$DATA
WorkingDirectory=$DIR/server
ExecStart=$(command -v node) $DIR/server/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable area41-api
systemctl restart area41-api
sleep 1

# senha do painel (só pergunta na primeira vez)
if ! grep -q '"hash": *"' "$DATA/auth.json" 2>/dev/null; then
  echo ""
  echo ">> Agora crie a senha do painel /consoleadmin"
  sudo -u area41 env DATA_DIR="$DATA" node "$DIR/server/server.js" set-password
  systemctl restart area41-api
fi

echo ">> Configurando nginx..."
SERVER_NAME="_"
[ -n "$DOMAIN" ] && SERVER_NAME="$DOMAIN www.$DOMAIN"
sed "s/__SERVER_NAME__/$SERVER_NAME/" "$DIR/deploy/nginx.conf" > /etc/nginx/sites-available/area41-shop
ln -sf /etc/nginx/sites-available/area41-shop /etc/nginx/sites-enabled/area41-shop
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full'
fi

if [ -n "$DOMAIN" ]; then
  echo ">> Ativando HTTPS (cadeado)..."
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring || \
    echo "!! HTTPS não foi configurado agora. Confira o DNS do domínio e rode: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

echo ">> Ativando atualização automática pelo GitHub (a cada 2 minutos)..."
( crontab -l 2>/dev/null | grep -v area41-shop ; echo "*/2 * * * * bash $DIR/deploy/update.sh >/dev/null 2>&1" ) | crontab -

if curl -fsS http://127.0.0.1:4141/api/catalog >/dev/null; then echo "   API respondendo ✔"; else echo "!! A API não respondeu. Veja: journalctl -u area41-api -n 30"; fi

URL="${DOMAIN:+https://$DOMAIN}"
[ -z "$URL" ] && URL="http://$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
echo ""
echo "✅ Pronto!"
echo "   Loja:   $URL"
echo "   Painel: $URL/consoleadmin"
