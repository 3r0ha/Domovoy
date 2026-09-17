import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Собранный лендинг локально ровно так, как его отдаёт продуктовый сервер:
 * разделы по своим адресам, промах по адресу отвечает страницей 404.html.
 */
const PORT = Number(process.env.LANDING_PORT ?? 4173);
const root = fileURLToPath(new URL('../landing/dist/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const fileAt = async (path) => {
  const found = await stat(path).catch(() => null);

  if (!found) return null;

  return found.isDirectory() ? fileAt(join(path, 'index.html')) : path;
};

/** Какому файлу отвечает адрес: каталог раздела читается своим index.html. */
const resolve = async (url) => {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const target = join(root, safe);

  if (!target.startsWith(root)) return null;

  return await fileAt(target);
};

const server = createServer((request, response) => {
  void (async () => {
    const path = request.method === 'GET' || request.method === 'HEAD' ? await resolve(request.url ?? '/') : null;

    if (!path) {
      const missing = await readFile(join(root, '404.html')).catch(() => null);

      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(missing ?? 'Не найдено');
      return;
    }

    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(path));
  })();
});

server.listen(PORT, () => {
  console.log(`Лендинг: http://localhost:${PORT}/`);
});
