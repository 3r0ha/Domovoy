import { useEffect } from 'react';

/**
 * Прокрутка по экранам. Цепляются только секции, которые в экран помещаются.
 */
const headerHeight = (): number => {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--header');

  return Number.parseFloat(value) || 54;
};

export const useSnap = (): void => {
  useEffect(() => {
    const wide = matchMedia('(min-width: 861px)');
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const sections = [...document.querySelectorAll<HTMLElement>('main > section')];

    const fit = (): void => {
      const on = wide.matches && !still.matches;
      const room = window.innerHeight - headerHeight() + 2;
      let all = true;

      for (const section of sections) {
        const fits = section.offsetHeight <= room;

        if (!fits) all = false;

        section.classList.toggle('snap', on && fits);
      }

      document.documentElement.classList.toggle('snapping', on);
      document.documentElement.classList.toggle('snapping-hard', on && all);
    };

    fit();

    const sizes = new ResizeObserver(() => fit());

    for (const section of sections) sizes.observe(section);

    wide.addEventListener('change', fit);
    still.addEventListener('change', fit);

    return () => {
      sizes.disconnect();
      wide.removeEventListener('change', fit);
      still.removeEventListener('change', fit);
      document.documentElement.classList.remove('snapping');
    };
  }, []);
};
