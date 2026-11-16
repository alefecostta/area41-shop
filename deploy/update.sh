#!/usr/bin/env bash
# Atualiza o site na VPS com a última versão do GitHub
set -euo pipefail
DIR=/var/www/area41-shop
git -C "$DIR" pull --ff-only
chown -R www-data:www-data "$DIR"
echo "✅ Site atualizado."
