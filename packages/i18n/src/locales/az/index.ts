import type { Dictionary } from '../../translate.js';
import { app } from './app.js';
import { bot } from './bot.js';
import { miniapp } from './miniapp.js';

/** Ключи собираются по областям: так три части продукта не спорят за один файл. */
const namespaced = (prefix: string, strings: Dictionary): Dictionary =>
  Object.fromEntries(Object.entries(strings).map(([key, text]) => [`${prefix}.${key}`, text]));

export const az: Dictionary = {
  ...namespaced('app', app),
  ...namespaced('bot', bot),
  ...namespaced('miniapp', miniapp),
};
