import { type Attachment } from '@domovoy/domain';

/** Порт распознавания речи: в тестах заменяется заглушкой. */
export interface Transcriber {
  transcribe(attachment: Attachment): Promise<string | undefined>;
}

/** Описание заявки из того, что прислал жилец. */
export const describeFromAttachments = async (
  text: string | undefined,
  attachments: readonly Attachment[],
  transcriber?: Transcriber,
): Promise<{ description: string; attachments: Attachment[] }> => {
  const enriched: Attachment[] = [];
  let transcript: string | undefined;

  for (const attachment of attachments) {
    if (attachment.kind === 'voice' && transcriber && !attachment.transcript) {
      const recognized = await transcriber.transcribe(attachment).catch(() => undefined);

      transcript ??= recognized;
      enriched.push(recognized ? { ...attachment, transcript: recognized } : attachment);
      continue;
    }

    transcript ??= attachment.transcript;
    enriched.push(attachment);
  }

  const description = text?.trim() || transcript?.trim() || defaultDescription(enriched);

  return { description, attachments: enriched };
};

const defaultDescription = (attachments: readonly Attachment[]): string => {
  const photos = attachments.filter((attachment) => attachment.kind === 'photo').length;
  const voices = attachments.filter((attachment) => attachment.kind === 'voice').length;

  if (voices > 0) {
    return photos > 0
      ? `Голосовое без расшифровки и фотография (${photos} шт.)`
      : 'Голосовое сообщение, расшифровка не получилась';
  }

  if (photos > 0) return `Обращение с фотографией (${photos} шт.), описание не приложено`;

  return 'Обращение без описания';
};

/** Голосовое, которое никто не разобрал: о нём жильца просят рассказать словами. */
export const unheardVoice = (attachments: readonly Attachment[]): boolean =>
  attachments.some((attachment) => attachment.kind === 'voice' && !attachment.transcript);
