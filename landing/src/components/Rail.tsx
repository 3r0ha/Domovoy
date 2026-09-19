import { useEffect, useState } from 'react';

import { SECTIONS } from '../sections.js';

/**
 * Оглавление сбоку: где сейчас читатель и сколько глав осталось.
 */
export const Rail = () => {
  const [current, setCurrent] = useState<string>('');

  useEffect(() => {
    const sections = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node !== null,
    );

    if (sections.length === 0) return undefined;

    const watcher = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (best) setCurrent(best.target.id);
      },
      { threshold: [0.35, 0.6], rootMargin: '-20% 0px -20% 0px' },
    );

    for (const section of sections) watcher.observe(section);

    return () => watcher.disconnect();
  }, []);

  return (
    <nav className="rail" aria-label="Разделы страницы">
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          className={section.id === current ? 'rail-dot rail-dot-on' : 'rail-dot'}
          href={`#${section.id}`}
          aria-current={section.id === current ? 'location' : undefined}
        >
          <span className="rail-name">{section.navTitle ?? section.pageTitle}</span>
        </a>
      ))}
    </nav>
  );
};
