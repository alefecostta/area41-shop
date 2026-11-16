#!/usr/bin/env bash
# Define uma nova senha para o /consoleadmin (use se esquecer a senha).
set -euo pipefail
sudo -u area41 env DATA_DIR=/var/lib/area41 node /var/www/area41-shop/server/server.js set-password
systemctl restart area41-api
echo "Pronto. Entre de novo em /consoleadmin com a senha nova."
