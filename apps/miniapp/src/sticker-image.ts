/** Картинка наклейки как адрес: в него же её и показывают на экране. */
export const svgUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
