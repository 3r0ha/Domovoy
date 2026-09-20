import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { InMemoryRepository, type Resident } from '@domovoy/app';
import { legalDocuments } from '@domovoy/domain';
import { legalLanguage, type Language } from '@domovoy/i18n';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'legal-bot-token';
const BUILDING_ID = 'b1';

const SPEAKER_ID = 2001;

/** Жилец с выбранным языком: документы должны прийти на нём. */
const speaker: Resident = {
  id: 'res-speaker',
  maxUserId: SPEAKER_ID,
  displayName: 'Улугбек',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  language: 'uz',
};

interface Harness {
  app: FastifyInstance;
  login: (userId: number) => Promise<string>;
}

const setup = async (): Promise<Harness> => {
  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, code: 'ACEFHK34', number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [speaker],
    }),
    defaultBuildingId: BUILDING_ID,
  });

  const login = async (userId: number): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: {
        'x-max-init-data': await signInitData(
          {
            auth_date: Math.floor(Date.now() / 1000),
            query_id: `q-${userId}`,
            user: JSON.stringify({ id: userId, first_name: 'Улугбек' }),
          },
          BOT_TOKEN,
        ),
      },
    });

    assert.equal(response.statusCode, 200, `вход не удался: ${response.body}`);

    return response.json<{ token: string }>().token;
  };

  return { app, login };
};

/** Названия документов на языке: по ним видно, какая редакция пришла. */
const titles = (language?: Language): string[] => legalDocuments(language).map((document) => document.title);

describe('документы по языку жильца', () => {
  it('без входа отдаются русские: политику читают до авторизации', async () => {
    const { app } = await setup();

    const response = await app.inject({ method: 'GET', url: '/api/legal' });

    assert.equal(response.statusCode, 200);

    const body = response.json<{ language: string; documents: { slug: string; title: string; text: string }[] }>();

    assert.equal(body.language, 'ru');
    assert.deepEqual(
      body.documents.map((document) => document.slug),
      ['privacy', 'terms'],
    );
    assert.deepEqual(
      body.documents.map((document) => document.title),
      titles(),
    );
    assert.match(body.documents[0]!.text, /Редакция от/u);

    await app.close();
  });

  it('жильцу приходит его язык, а без перевода, русская редакция', async () => {
    const { app, login } = await setup();
    const token = await login(SPEAKER_ID);

    const response = await app.inject({
      method: 'GET',
      url: '/api/legal',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200);

    const body = response.json<{ language: string; documents: { title: string }[] }>();
    const language = legalLanguage(speaker.language);

    assert.equal(body.language, language);
    assert.deepEqual(
      body.documents.map((document) => document.title),
      titles(speaker.language),
    );

    await app.close();
  });

  it('негодный токен не закрывает документы', async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: 'GET',
      url: '/api/legal',
      headers: { authorization: 'Bearer не-токен' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ language: string }>().language, 'ru');

    await app.close();
  });
});
