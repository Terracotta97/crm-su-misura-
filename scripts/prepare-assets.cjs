// Prepara le risorse originali dell'interfaccia UNICA CRM per Cloudflare Workers.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../public/static');
fs.mkdirSync(dir, { recursive: true });
for (const file of ['app.js', 'style.css']) {
  fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(dir, file));
  console.log('Asset pronto:', file);
}
