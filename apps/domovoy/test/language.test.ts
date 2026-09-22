import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { InMemoryRepository, createMockHub, createMockPayments, type AppDeps } from '@domovoy/app';
import { createDomovoyBot } from '@domovoy/bot';
import { startMockPlatform, type MockPlatform, type SentMessage } from '@maxkit/platform-mock';

import { demoData, demoDevices, seedDemo } from '../dist/demo.js';

const TOKEN = 'language-token';
const USER = 7001;

/** Разделы жильца: по ним и ходит человек, когда язык уже выбран. */
const SECTIONS = [
  'group:back',
  'menu:my',
  'menu:door',
  'group:money',
  'menu:bill',
  'menu:meters',
  'group:house',
  'menu:news',
  'menu:vote',
  'menu:neighbours',
  'menu:house',
  'menu:capital',
  'group:me',
  'menu:support',
  'menu:visit',
  'menu:contacts',
  'menu:flat',
  'menu:mydata',
  'menu:notices',
];

/** Подписи кнопок под сообщением: клавиатура лежит во вложениях. */
const labelsOf = (message: SentMessage): string[] => {
  const rows = (message.attachments as { payload?: { buttons?: { text?: string }[][] } }[]).flatMap(
    (attachment) => attachment.payload?.buttons ?? [],
  );

  return rows.flat().map((button) => button.text ?? '');
};

/** Переходы под кнопками: по ним видно, куда человеку дальше. */
const payloadsOf = (message: SentMessage): string[] => {
  const rows = (message.attachments as { payload?: { buttons?: { payload?: string }[][] } }[]).flatMap(
    (attachment) => attachment.payload?.buttons ?? [],
  );

  return rows.flat().map((button) => button.payload ?? '');
};

describe('жилец с нерусским языком', () => {
  let platform: MockPlatform;
  let stop: () => Promise<void>;
  /** Каждое состояние сообщения: нажатие переписывает его на месте. */
  const seen: SentMessage[] = [];

  const mine = (): SentMessage[] => platform.outgoing.filter((message) => message.userId === USER || message.chatId === USER);

  const collect = (): void => {
    for (const message of mine()) {
      if (seen.some((known) => known.mid === message.mid && known.text === message.text)) continue;

      seen.push({ ...message });
    }
  };

  const waitFor = async (pattern: RegExp, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (mine().some((message) => pattern.test(message.text))) {
        collect();
        return;
      }

      if (Date.now() > deadline) throw new Error(`не дождались «${pattern.source}»`);

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const settle = async (ms = 400): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    collect();
  };

  const press = (payload: string): void => {
    platform.userPressesButton(payload, { userId: USER, chatId: USER, firstName: 'John' });
  };

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });

    const data = demoData();
    let counter = 0;
    const now = (): Date => new Date();

    const deps: AppDeps = {
      repository: new InMemoryRepository(),
      now,
      createId: () => `lang-${++counter}`,
      defaultBuildingId: data.buildingId,
      hub: createMockHub({ devices: demoDevices(), now }),
      payments: createMockPayments({ now }),
      botName: 'uk_bot',
    };

    await seedDemo(deps);

    const bot = createDomovoyBot({
      token: TOKEN,
      deps,
      baseUrl: platform.url,
      miniAppUrl: 'https://max.ru/domovoy_bot',
      siteUrl: 'https://domovoy.homes',
    });

    bot.bot.botInfo = await bot.bot.api.getMyInfo();
    void bot.supervisor.start();

    // Опрос платформы держит цикл событий: без остановки процесс не завершится.
    stop = async () => {
      await bot.supervisor.stop();
      await platform.stop();
    };

    platform.userSends('/start', { userId: USER, chatId: USER, firstName: 'John' });
    await waitFor(/Choose your language/);

    press('lang:en');
    await waitFor(/Domovoy processes personal data/);

    press('legal:accept');
    await waitFor(/apartment code from the bill/);

    const code = data.apartments.find((apartment) => apartment.id === 'apt-10')?.code ?? '';

    platform.userSends(code, { userId: USER, chatId: USER, firstName: 'John' });
    await waitFor(/Done, apartment/);

    platform.userSends('The tap in the kitchen is leaking', { userId: USER, chatId: USER, firstName: 'John' });
    await waitFor(/is accepted/);

    for (const payload of SECTIONS) {
      press(payload);
      await settle();
    }

    press('menu:lang');
    await waitFor(/Choose your language/);
  });

  after(async () => {
    await stop();
  });

  it('на каждом шаге есть кнопка: тупика без выхода нет', () => {
    const mute = seen.filter((message) => labelsOf(message).length === 0);

    assert.deepEqual(
      mute.map((message) => message.text.slice(0, 60)),
      [],
      'ответ без единой кнопки: человеку нечего нажать',
    );
  });

  it('вместо строки не показывается её ключ', () => {
    // Ключ без строки перевод отдаёт как есть: в переписке он выглядит
    // «app.hours.few» и читается как поломка.
    const key = /(?:^|[\s:·(«])(app|bot|miniapp|when)\.[a-z]+(?:\.[a-z_]+)+/iu;
    const raw = seen.filter((message) => key.test(message.text) || labelsOf(message).some((label) => key.test(label)));

    assert.deepEqual(
      raw.map((message) => message.text.slice(0, 80)),
      [],
      'на экран попал ключ словаря вместо строки',
    );
  });

  it('переход на другой язык не предлагается по тексту самого бота', () => {
    // Нажатие кнопки приносит в обновлении текст прежнего сообщения бота.
    // По нему продукт предлагал уйти на язык, с которого человек только что ушёл.
    const offers = seen.filter(
      (message) =>
        !/Choose your language/.test(message.text) &&
        payloadsOf(message).some((payload) => payload.startsWith('lang:')),
    );

    assert.deepEqual(
      offers.map((message) => message.text.slice(0, 60)),
      [],
      'переход на язык предложен там, где человек ничего не писал',
    );
  });

  it('кнопка приложения подписана на языке человека', () => {
    const app = seen.flatMap(labelsOf).filter((label) => /приложение|the app/iu.test(label));

    assert.ok(app.length > 0, 'кнопки приложения нет ни на одном экране');
    assert.deepEqual(
      [...new Set(app.filter((label) => /приложение/u.test(label)))],
      [],
      'подпись кнопки приложения осталась русской',
    );
  });

  it('свои данные пересказываются на языке человека', () => {
    const about = seen.find((message) => /I keep about you/.test(message.text));

    assert.ok(about, 'экран «Мои данные» не открылся');
    assert.doesNotMatch(about.text, /Заявок|показаний|голосов|платежей/u, 'сводка осталась русской');
  });

  it('вопрос о языке задан и по-русски, и по-английски', () => {
    const ask = seen.filter((message) => /Choose your language/.test(message.text));

    assert.ok(ask.length >= 2, 'язык спрашивают при первом разговоре и по команде смены');

    for (const message of ask) {
      assert.match(message.text, /Выберите язык/u, 'вопрос читается и тем, кто знает только русский');
      assert.ok(
        labelsOf(message).some((label) => label.endsWith('English')),
        'своего языка нет в списке',
      );
    }
  });
});
