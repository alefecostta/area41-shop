#!/usr/bin/env bash
# =====================================================================
#  ÁREA 41 SHOP — instalação na VPS (Ubuntu/Debian)
#  Uso (logado na VPS como root):
#    bash install.sh https://github.com/SEU_USUARIO/area41-shop.git seudominio.com.br
#  O domínio é opcional. Sem domínio, o site abre pelo IP da VPS.
# =====================================================================
set -euo pipefail

REPO="${1:?Informe a URL do repositório do GitHub}"
DOMAIN="${2:-}"
DIR=/var/www/area41-shop

echo ">> Instalando nginx e git..."
apt-get update -y
apt-get install -y nginx git

echo ">> Baixando o site..."
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  rm -rf "$DIR"
  git clone "$REPO" "$DIR"
fi
chown -R www-data:www-data "$DIR"

echo ">> Configurando nginx..."
SERVER_NAME="${DOMAIN:-_}"
[ -n "$DOMAIN" ] && SERVER_NAME="$DOMAIN www.$DOMAIN"
sed "s/__SERVER_NAME__/$SERVER_NAME/" "$DIR/deploy/nginx.conf" > /etc/nginx/sites-available/area41-shop
ln -sf /etc/nginx/sites-available/area41-shop /etc/nginx/sites-enabled/area41-shop
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

# libera o firewall, se o ufw estiver ativo
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full'
fi

if [ -n "$DOMAIN" ]; then
  echo ">> Gerando certificado HTTPS (o domínio já precisa apontar para o IP desta VPS)..."
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
    echo "!! HTTPS não foi configurado agora. Confira o DNS do domínio e rode: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

echo ""
echo "✅ Pronto! Site no ar em: ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')}"
echo "   Para atualizar depois:  bash $DIR/deploy/update.sh"
