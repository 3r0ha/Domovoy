import { useEffect, useRef, useState } from 'react';

import { LEGAL_DOCUMENTS } from '@domovoy/domain';
import { DEFAULT_LANGUAGE, languageTitle, legalLanguages } from '@domovoy/i18n';

import { SECTIONS } from '../sections.js';
import { Ink } from './Ink.js';

/** Строка состояния над снимком экрана. */
const Status = () => (
  <div className="phone-status" aria-hidden="true">
    <span className="phone-time">9:41</span>
    <span className="phone-island" />
    <span className="phone-icons">
      <svg viewBox="0 0 18 12" width="17" height="11">
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
        <rect x="10" y="3" width="3" height="9" rx="1" />
        <rect x="15" y="0.5" width="3" height="11.5" rx="1" />
      </svg>
      <svg viewBox="0 0 16 12" width="15" height="11">
        <path d="M8 10.6 5.9 8.4a3 3 0 0 1 4.2 0zM8 6.2a5.6 5.6 0 0 0-4 1.6L2.6 6.3a7.6 7.6 0 0 1 10.8 0L12 7.8a5.6 5.6 0 0 0-4-1.6zM8 2.2c-2.6 0-5 1-6.8 2.7L0 3.5A11.6 11.6 0 0 1 16 3.5l-1.2 1.4A9.6 9.6 0 0 0 8 2.2z" />
      </svg>
      <svg viewBox="0 0 26 12" width="24" height="11">
        <rect x="0.5" y="0.5" width="21" height="11" rx="3.2" className="phone-battery" />
        <rect x="2.5" y="2.5" width="14" height="7" rx="1.6" />
        <path d="M23.5 4.2v3.6a2.4 2.4 0 0 0 0-3.6z" />
      </svg>
    </span>
  </div>
);

/** Чей это экран: без подписи читатель гадает, жильца ему показывают или мастера. */
const ROLES: Record<string, string> = {
  work: 'Экран мастера',
  survey: 'Экран мастера',
  inspections: 'Экран мастера',
  sticker: 'Экран смены',
  queue: 'Экран диспетчера',
  'staff-news': 'Экран диспетчера',
  'support-staff': 'Экран диспетчера',
  'shift-more': 'Экран диспетчера',
  clarify: 'Экран диспетчера',
  confirm: 'Экран диспетчера',
  plan: 'Экран управляющей организации',
  equipment: 'Экран управляющей организации',
  report: 'Экран управляющей организации',
  people: 'Экран управляющей организации',
  audit: 'Экран управляющей организации',
  debtors: 'Экран управляющей организации',
  'house-meters': 'Экран управляющей организации',
  buildings: 'Экран управляющей организации',
};

/** Мокап телефона: корпус, строка состояния, боковые клавиши. */
export const Shot = ({ name, alt, className }: { name: string; alt: string; className?: string }) => (
  <figure className={className ? `phone ${className}` : 'phone'}>
    <div className="phone-body">
      <div className="phone-screen">
        <Status />
        <img
          src={`/shots/${name}.webp`}
          alt={alt}
          width={390}
          height={800}
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>
    <figcaption>{ROLES[name] ?? 'Экран жильца'}</figcaption>
  </figure>
);

const botLink = (import.meta.env as { VITE_BOT_LINK?: string }).VITE_BOT_LINK?.trim();

// Без адреса бота четыре главные кнопки вели бы в никуда, поэтому сборка останавливается.
if (!botLink) {
  throw new Error(
    'VITE_BOT_LINK не задан: кнопкам «Открыть в MAX» некуда вести. Укажите адрес бота, например VITE_BOT_LINK=https://max.ru/имя_бота.',
  );
}

/** Ссылка на бота в MAX: задаётся на сборке переменной VITE_BOT_LINK. */
export const BOT_LINK: string = botLink;

/** Шапка с разделами страницы. */

export const Top = ({ current }: { current?: string }) => {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const read = useRef<HTMLSpanElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = (): void => {
      setStuck(window.scrollY > 12);

      // Полоса прочитанного: пишем прямо в стиль, чтобы не перерисовывать шапку на каждый кадр.
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const done = height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0;

      if (read.current) read.current.style.transform = `scaleX(${done})`;
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    // Открыли список: фокус уходит в него, по Escape возвращается на кнопку.
    sheet.current?.querySelector('a')?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;

      setOpen(false);
      toggle.current?.focus();
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={['top', open ? 'top-open' : '', stuck || open ? 'top-stuck' : ''].join(' ').trim()}>
      <a className="skip" href="#top">
        К содержанию
      </a>

      <span className="top-read" ref={read} aria-hidden="true" />

      <div className="wrap top-inner">
        <a className="top-brand" href="/">
          <img src="/bezslavie-mark.svg" alt="" width="48" height="26" />
          <span>Домовой</span>
        </a>

        <nav className="top-nav">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              className={section.id === current ? 'top-link top-link-on' : 'top-link'}
              href={`/${section.id}/`}
            >
              {section.navTitle ?? section.pageTitle}
            </a>
          ))}
        </nav>

        <a
          className="top-open-max"
          href={BOT_LINK}
          target="_blank"
          rel="noreferrer"
          aria-label="Открыть в MAX"
        >
          <span className="top-max-long">Открыть в MAX</span>
          <span className="top-max-short">В MAX</span>
        </a>

        <button
          type="button"
          className="top-toggle"
          ref={toggle}
          aria-expanded={open}
          aria-controls="top-sheet"
          onClick={() => setOpen((state) => !state)}
        >
          <span className="top-toggle-name">
            {open ? 'Закрыть' : (SECTIONS.find((section) => section.id === current)?.navTitle ??
              SECTIONS.find((section) => section.id === current)?.pageTitle ??
              'Разделы')}
          </span>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d={open ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="top-sheet" id="top-sheet" ref={sheet}>
          <div className="wrap top-sheet-inner">
            <a className="top-sheet-link" href="/">
              Главная
            </a>
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                className={section.id === current ? 'top-sheet-link top-link-on' : 'top-sheet-link'}
                href={`/${section.id}/`}
              >
                {section.pageTitle}
                <span>{section.eyebrow.toLowerCase()}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
};

/** Языки, на которых документы есть: появляются вместе с переводом. */
const LEGAL_LANGUAGES = legalLanguages();

export const Foot = () => (
  <footer className="foot">
    <div className="wrap foot-inner">
      <nav className="foot-legal" aria-label="Документы">
        {LEGAL_DOCUMENTS.map((document) => (
          <a key={document.slug} href={`/${document.slug}/`}>
            {document.title}
          </a>
        ))}
      </nav>

      {LEGAL_LANGUAGES.length > 1 ? (
        <nav className="foot-langs" aria-label="Языки документов">
          {LEGAL_LANGUAGES.map((code) => (
            <a
              key={code}
              href={code === DEFAULT_LANGUAGE ? '/privacy/' : `/${code}/privacy/`}
              hrefLang={code}
              lang={code}
            >
              {languageTitle(code)}
            </a>
          ))}
        </nav>
      ) : null}

      <a className="foot-max" href={BOT_LINK} target="_blank" rel="noreferrer">
        Открыть в MAX
      </a>

      <div className="foot-brand">
        <Ink src="/bezslavie-logo.svg" className="foot-logo" when="seen" label="БЕЗЪСЛАВИЕ" pace={0.32} />
        <p className="foot-note">Команда antihype для платформы MAX, 2026</p>
      </div>
    </div>
  </footer>
);
