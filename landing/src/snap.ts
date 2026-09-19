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
    const heights = new Map<HTMLElement, number>();

    for (const section of sections) heights.set(section, section.offsetHeight);

    // Высота шапки из стиля: её пересчитывают только при смене размера окна.
    let header = headerHeight();
    let planned = 0;

    const apply = (): void => {
      const on = wide.matches && !still.matches;
      const room = window.innerHeight - header + 2;
      let all = true;

      for (const section of sections) {
        const fits = (heights.get(section) ?? 0) <= room;

        if (!fits) all = false;

        section.classList.toggle('snap', on && fits);
      }

      document.documentElement.classList.toggle('snapping', on);
      document.documentElement.classList.toggle('snapping-hard', on && all);
    };

    // Пачка изменений размера сводится в один проход перед отрисовкой.
    const plan = (): void => {
      if (planned) return;

      planned = requestAnimationFrame(() => {
        planned = 0;
        apply();
      });
    };

    apply();

    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const section = entry.target as HTMLElement;
        const box = entry.borderBoxSize[0];

        heights.set(section, box ? box.blockSize : section.offsetHeight);
      }

      plan();
    });

    for (const section of sections) sizes.observe(section);

    const onResize = (): void => {
      header = headerHeight();
      plan();
    };

    window.addEventListener('resize', onResize, { passive: true });
    wide.addEventListener('change', onResize);
    still.addEventListener('change', onResize);

    return () => {
      if (planned) cancelAnimationFrame(planned);

      sizes.disconnect();
      window.removeEventListener('resize', onResize);
      wide.removeEventListener('change', onResize);
      still.removeEventListener('change', onResize);

      document.documentElement.classList.remove('snapping', 'snapping-hard');

      for (const section of sections) section.classList.remove('snap');
    };
  }, []);
};
