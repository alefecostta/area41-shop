# ÁREA 41 SHOP

Tabela online de pods descartáveis com pedido finalizado pelo WhatsApp.
Site estático: só `index.html` + pasta `img/`. Não precisa de banco de dados nem Node.

## Configurar a loja

No `index.html`, procure `const CONFIG` (no começo do `<script>`):

```js
const CONFIG = {
  nome: "ÁREA 41 SHOP",
  whatsapp: "5541999999999",   // DDI + DDD + número, só números
  cidade: "Curitiba",
  instagram: "area41shop"      // sem @
};
```

- **Produtos e preços:** objeto `PRODUCTS` (`price` = preço atual, `old` = preço riscado).
- **Sabores:** campo `flavors: ["🍉 Watermelon Ice", ...]` em cada produto.
- **Categorias:** array `CATEGORIES`.
- **Fotos:** coloque na pasta `img/` e use o nome do arquivo em `img`.

## Colocar na VPS (Ubuntu/Debian)

Logado na VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/area41-shop/main/deploy/install.sh -o install.sh
bash install.sh https://github.com/SEU_USUARIO/area41-shop.git seudominio.com.br
```

(Se o repositório for privado, clone com um token ou chave de deploy.)

Sem domínio, o site abre pelo IP da VPS. Com domínio, aponte o DNS (registro A) para o IP antes, que o script já ativa o HTTPS.

## Atualizar o site

1. Edite e dê `git push` para o GitHub.
2. Na VPS: `bash /var/www/area41-shop/deploy/update.sh`
