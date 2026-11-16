#!/usr/bin/env bash
# Atualiza o site na VPS com a última versão do GitHub.
# Os produtos, fotos e a senha do painel ficam em /var/lib/area41 e não são tocados.
set -euo pipefail
DIR=/var/www/area41-shop
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$DIR" || git config --global --add safe.directory "$DIR"
BEFORE=$(git -C "$DIR" rev-parse HEAD)
git -C "$DIR" pull --ff-only -q
AFTER=$(git -C "$DIR" rev-parse HEAD)
if [ "$BEFORE" != "$AFTER" ]; then
  chown -R www-data:www-data "$DIR"
  if git -C "$DIR" diff --name-only "$BEFORE" "$AFTER" | grep -q '^server/'; then
    systemctl restart area41-api 2>/dev/null || true
  fi
  echo "✅ Site atualizado."
else
  echo "Já estava na versão mais nova."
fi
