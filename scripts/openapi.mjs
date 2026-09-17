import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { InMemoryRepository } from '@domovoy/app';
import { buildServer } from '@domovoy/api';

/**
 * Машинное описание API файлом. Сервер собирает его из тех же схем, по которым
 * проверяет запросы, поэтому описание не расходится с поведением.
 */
const out = fileURLToPath(new URL('../openapi.json', import.meta.url));

const app = await buildServer({
  botToken: 'openapi-token',
  repository: new InMemoryRepository({ buildings: [{ id: 'b1', code: 'Д1' }] }),
  defaultBuildingId: 'b1',
});

const response = await app.inject({ method: 'GET', url: '/openapi.json' });

await app.close();

if (response.statusCode !== 200) {
  console.error(`Описание не собралось: ${response.statusCode}`);
  process.exit(1);
}

const document = JSON.parse(response.body);

await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);

console.log(`${out}: ${Object.keys(document.paths).length} маршрутов, OpenAPI ${document.openapi}`);
