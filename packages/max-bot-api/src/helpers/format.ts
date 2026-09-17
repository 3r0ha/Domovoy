/**
 * Форматирование Markdown и HTML для сообщений MAX. Функции не экранируют
 * текст автоматически: пользовательские данные нужно передать в escape/escapeHtml.
 */

export const bold = (text: string): string => `**${text}**`;

export const italic = (text: string): string => `_${text}_`;

export const strikethrough = (text: string): string => `~~${text}~~`;

/** Подчёркнутый текст. В MAX для этого используется `++текст++`. */
export const underline = (text: string): string => `++${text}++`;

export const code = (text: string): string => `\`${text}\``;

export const pre = (text: string, language = ''): string => {
  return language
    ? `\`\`\`${language}\n${text}\n\`\`\``
    : `\`\`\`\n${text}\n\`\`\``;
};

/**
 * Готовит ссылку к подстановке в Markdown.
 *
 * Круглые скобки и пробелы внутри адреса закрывают конструкцию `[текст](адрес)` раньше времени,
 * а прогнать адрес через `escape` нельзя, он расставит обратные слэши внутри самого адреса.
 * Поэтому проблемные символы заменяются процентными кодами: для адреса это равнозначная запись.
 */
export const escapeUrl = (url: string): string => {
  return url
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\s/g, '%20');
};

export const link = (text: string, url: string): string => `[${text}](${escapeUrl(url)})`;

/** Упоминание пользователя: в MAX оно оформляется ссылкой на `max://user/<id>`. */
export const mention = (text: string, userId: number | string): string => {
  return `[${text}](max://user/${userId})`;
};

/** Экранирует пользовательский текст перед вставкой в Markdown. */
export const escape = (text: string): string => {
  // Экранируем все символы разметки независимо от места вставки текста.
  return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
};

export const boldHtml = (text: string): string => `<b>${text}</b>`;

export const italicHtml = (text: string): string => `<i>${text}</i>`;

export const underlineHtml = (text: string): string => `<u>${text}</u>`;

export const strikethroughHtml = (text: string): string => `<s>${text}</s>`;

export const codeHtml = (text: string): string => `<code>${text}</code>`;

export const preHtml = (text: string, language = ''): string => {
  return language
    ? `<pre><code class="language-${language}">${text}</code></pre>`
    : `<pre>${text}</pre>`;
};

export const linkHtml = (text: string, url: string): string => {
  return `<a href="${escapeHtml(url)}">${text}</a>`;
};

/** Упоминание пользователя в HTML-разметке. */
export const mentionHtml = (text: string, userId: number | string): string => {
  return `<a href="max://user/${userId}">${text}</a>`;
};

/** Экранирует пользовательский текст перед вставкой в HTML. */
export const escapeHtml = (text: string): string => {
  // Амперсанд заменяем первым, чтобы не изменить добавленные ниже HTML-сущности.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};
