import type { AttachmentView, DomovoyApi } from '../api.js';
import { Photo } from './Photo.js';

export interface AttachmentsProps {
  api: DomovoyApi;
  items: AttachmentView[];
  /** Чьи это вложения: подпись для голосового помощника. */
  alt: string;
}

/** Вложения сообщения: снимки картинками, остальное словами. */
export const Attachments = ({ api, items, alt }: AttachmentsProps) => {
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
            {attachment.kind === 'photo' ? 'фото' : attachment.kind === 'voice' ? 'голосовое' : 'файл'}
            {attachment.transcript ? `: ${attachment.transcript}` : ''}
          </span>
        );
      })}
    </div>
  );
};
