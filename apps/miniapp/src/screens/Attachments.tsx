import type { AttachmentView, DomovoyApi } from '../api.js';
import { useT } from '../i18n.js';
import { Photo } from './Photo.js';

export interface AttachmentsProps {
  api: DomovoyApi;
  items: AttachmentView[];
  /** Чьи это вложения: подпись для голосового помощника. */
  alt: string;
}

/** Вложения сообщения: снимки картинками, остальное словами. */
export const Attachments = ({ api, items, alt }: AttachmentsProps) => {
  const t = useT();

  if (items.length === 0) return null;

  return (
    <div className="attachments">
      {items.map((attachment, index) => {
        const showable = attachment.token.startsWith('http') || attachment.token.startsWith('file:');

        if (attachment.kind === 'photo' && showable) {
          return <Photo key={attachment.token} api={api} token={attachment.token} alt={alt} />;
        }

        return (
          <span key={`${attachment.token}-${index}`} className="badge">
            {attachment.kind === 'photo'
              ? t('request.attachment.photo')
              : attachment.kind === 'voice'
                ? t('request.attachment.voice')
                : t('request.attachment.file')}
            {attachment.transcript ? `: ${attachment.transcript}` : ''}
          </span>
        );
      })}
    </div>
  );
};
