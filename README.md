# ÁREA 41 SHOP

Loja de pods com pedido pelo WhatsApp + painel **/consoleadmin** para gerenciar tudo.

## Estrutura

| Pasta | O que é |
|---|---|
| `index.html`, `img/` | A loja |
| `consoleadmin/` | O painel (produtos, fotos, puffs, sabores, estoque, preço, desconto, estrelas, categorias, brinde, WhatsApp) |
| `server/server.js` | API em Node.js, sem dependências |
| `data/catalog.seed.json` | Catálogo inicial (usado só na primeira instalação) |
| `deploy/` | Scripts da VPS |

Os produtos, fotos enviadas e a senha ficam na VPS em `/var/lib/area41` (fora do Git). Atualizar o site pelo GitHub **não apaga** nada disso. A cada salvamento o painel guarda um backup em `/var/lib/area41/backups`.

## Instalar ou atualizar a instalação na VPS

```bash
curl -fsSL https://raw.githubusercontent.com/alefecostta/area41-shop/main/deploy/install.sh -o install.sh
bash install.sh https://github.com/alefecostta/area41-shop.git area41shop.tech
```

Na primeira vez ele pede para criar a senha do painel. Depois:

- Loja: `https://area41shop.tech`
- Painel: `https://area41shop.tech/consoleadmin`

## Comandos úteis na VPS

```bash
bash /var/www/area41-shop/deploy/update.sh   # puxar a versão mais nova do GitHub (já roda sozinho a cada 2 min)
bash /var/www/area41-shop/deploy/senha.sh    # trocar a senha do painel se esquecer
systemctl status area41-api                  # ver se a API está rodando
journalctl -u area41-api -n 50               # ver erros da API
```

## Testar no computador

```bash
DATA_DIR=./.data ADMIN_PASSWORD=teste12345 node server/server.js set-password
DATA_DIR=./.data STATIC_DIR=. node server/server.js
# abra http://localhost:4141 e http://localhost:4141/consoleadmin
```
