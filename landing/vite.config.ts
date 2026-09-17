import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { precompress } from '../scripts/precompress.mjs';

/** Адрес сайта: из него собираются карта сайта и ссылки на ней. */
const SITE = 'https://domovoy.homes';

/** У каждого раздела свой адрес и свой заголовок: страницы настоящие, а не роутер. */
const SECTIONS = [
  'request',
  'help',
  'deadline',
  'neighbours',
  'meeting',
  'money',
  'shift',
  'house',
  'report',
  'chat',
  'auto',
];

/** Страница, которой нет: без неё промах по адресу отдаётся отказом сервера. */
const MISSING = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Страницы нет · Домовой</title>
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#fdfcfb" />
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
    <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <style>
      @font-face {
        font-family: 'Ruslan Display';
        font-display: swap;
        src: url('/fonts/ruslan-display-cyrillic.woff2') format('woff2');
      }

      body {
        margin: 0;
        min-height: 100svh;
        display: grid;
        place-items: center;
        background: #fdfcfb;
        color: #1a1a1c;
        font: 17px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        -webkit-font-smoothing: antialiased;
      }

      main {
        padding: 32px 24px 56px;
        max-width: 440px;
      }

      img {
        width: min(46vw, 190px);
        height: auto;
        margin-bottom: 20px;
      }

      h1 {
        margin: 0 0 14px;
        color: #c1161c;
        font-family: 'Ruslan Display', Georgia, serif;
        font-size: clamp(34px, 8vw, 46px);
        font-weight: 400;
        line-height: 1.05;
        text-wrap: balance;
      }

      p {
        margin: 0 0 28px;
        color: #6a6a70;
        text-wrap: pretty;
      }

      a {
        display: inline-block;
        padding: 13px 26px;
        border-radius: 999px;
        background: #c1161c;
        color: #fff;
        font-size: 16px;
        text-decoration: none;
      }

      a:active {
        background: #8e0f14;
      }
    </style>
  </head>
  <body>
    <main>
      <img src="/domovoy/walking.webp" alt="Домовой обходит дом" width="512" height="512" />
      <h1>Такой страницы нет</h1>
      <p>Домовой обошёл весь дом и не нашёл её. Возможно, адрес набран с ошибкой.</p>
      <a href="/">На главную</a>
    </main>
  </body>
</html>
`;

/** Карта сайта и страница промаха: адреса те же, что у собранных страниц. */
const extras = (): Plugin => ({
  name: 'domovoy-extras',
  apply: 'build',
  generateBundle() {
    const urls = ['/', ...SECTIONS.map((id) => `/${id}/`), ...LEGAL.map((id) => `/${id}/`)];

    this.emitFile({
      type: 'asset',
      fileName: 'sitemap.xml',
      source:
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map((url) => `  <url><loc>${SITE}${url}</loc></url>`).join('\n') +
        '\n</urlset>\n',
    });

    this.emitFile({ type: 'asset', fileName: '404.html', source: MISSING });
  },
});

/** Документы продукта: свои страницы, чтобы на них можно было дать ссылку из чата. */
const LEGAL = ['privacy', 'terms'];

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const pages: Record<string, string> = { home: page('index.html') };

for (const id of [...SECTIONS, ...LEGAL]) pages[id] = page(`${id}/index.html`);

export default defineConfig({
  plugins: [react(), extras(), precompress()],
  server: { port: 4173 },
  build: { target: 'es2022', outDir: 'dist', rollupOptions: { input: pages } },
});
