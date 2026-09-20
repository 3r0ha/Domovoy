import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import { DEFAULT_LANGUAGE, legalLanguages, legalTextsFor, type Language } from '@domovoy/i18n';

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
  'language',
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
    const urls = [
      '/',
      ...SECTIONS.map((id) => `/${id}/`),
      ...LEGAL.flatMap((slug) => legalLanguages().map((language) => legalUrl(slug, language))),
    ];

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

/** Адрес документа: русская редакция лежит в корне, у остальных языков свой каталог. */
const legalUrl = (slug: string, language: Language): string =>
  language === DEFAULT_LANGUAGE ? `/${slug}/` : `/${language}/${slug}/`;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Страница документа на другом языке: русская разметка с подставленными
 * названием, описанием и адресами. Голова страницы остаётся одна на все языки,
 * а перевод документа сам даёт страницу.
 */
const translated = (template: string, slug: string, language: Language): string => {
  const texts = legalTextsFor(language);
  const text = texts.find((item) => item.slug === slug);

  if (!text) return template;

  let html = template.replace('<html lang="ru">', `<html lang="${language}">`);

  for (const other of LEGAL) html = html.replaceAll(`/${other}/`, `/${language}/${other}/`);

  const title = escapeHtml(`${text.title} · Домовой`);
  const about = escapeHtml(text.about);

  html = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/(name="description" content=")[^"]*/, (_whole, head: string) => `${head}${about}`)
    .replace(/(property="og:title" content=")[^"]*/, (_whole, head: string) => `${head}${title}`)
    .replace(/(property="og:description" content=")[^"]*/, (_whole, head: string) => `${head}${about}`)
    .replace(/(property="og:locale" content=")[^"]*/, (_whole, head: string) => `${head}${language}`)
    .replace(/(<h1[^>]*>)[^<]*/, (_whole, head: string) => `${head}${escapeHtml(text.title)}`)
    .replace(/(<\/h1>\s*<p[^>]*>)[^<]*/, (_whole, head: string) => `${head}${about}`)
    .replace(`data-legal="${slug}"`, `data-legal="${slug}" data-language="${language}"`);

  // Ссылка на второй документ внизу страницы: её название тоже на языке страницы.
  for (const other of texts) {
    if (other.slug === slug) continue;

    html = html.replace(
      new RegExp(`(href="/${language}/${other.slug}/"[^>]*>)[^<]*`),
      (_whole, head: string) => `${head}${escapeHtml(other.title)}`,
    );
  }

  return html;
};

/** Адрес бота обязателен: без него кнопки «Открыть в MAX» и noscript ведут в никуда. */
const botLink = (): Plugin => ({
  name: 'domovoy-bot-link',
  config(_config, { mode }) {
    const link = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_').VITE_BOT_LINK?.trim();

    if (!link) {
      throw new Error(
        'VITE_BOT_LINK не задан: кнопкам «Открыть в MAX» некуда вести. Укажите адрес бота, например VITE_BOT_LINK=https://max.ru/имя_бота.',
      );
    }

    if (!/^https:\/\/\S+$/.test(link)) {
      throw new Error(`VITE_BOT_LINK должен быть адресом вида https://max.ru/имя_бота, а задано «${link}».`);
    }

    return undefined;
  },
});

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Страницы документов по языкам. Нерусские собираются из русской разметки и
 * пишутся рядом перед сборкой: адрес страницы задаётся путём её файла.
 */
const legalPages = (): Record<string, string> => {
  const entries: Record<string, string> = {};

  for (const language of legalLanguages()) {
    for (const slug of LEGAL) {
      const source = page(`${slug}/index.html`);

      if (language === DEFAULT_LANGUAGE) {
        entries[slug] = source;
        continue;
      }

      const file = page(`${language}/${slug}/index.html`);
      const html = translated(readFileSync(source, 'utf8'), slug, language);

      mkdirSync(dirname(file), { recursive: true });
      if (!existsSync(file) || readFileSync(file, 'utf8') !== html) writeFileSync(file, html);

      entries[`${language}-${slug}`] = file;
    }
  }

  return entries;
};

const pages: Record<string, string> = { home: page('index.html'), ...legalPages() };

for (const id of SECTIONS) pages[id] = page(`${id}/index.html`);

export default defineConfig({
  plugins: [botLink(), react(), extras(), precompress()],
  server: { port: 4173 },
  build: { target: 'es2022', outDir: 'dist', rollupOptions: { input: pages } },
});
