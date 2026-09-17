import { useState, type ChangeEvent } from 'react';

import { ApiError, type AttachmentView, type DomovoyApi } from './api.js';
import { preparePhoto } from './photo-input.js';

export interface PhotoUpload {
  /** Уже отправленные снимки: их кладут в заявку или в отчёт о выполнении. */
  photos: AttachmentView[];
  uploading: boolean;
  /** Причина неудачи словами, если снимок не уехал. */
  error: string | null;
  /** Обработчик поля выбора файла. */
  attach: (event: ChangeEvent<HTMLInputElement>) => void;
  reset: () => void;
}

/** Отправка снимков. */
export const usePhotos = (api: DomovoyApi): PhotoUpload => {
  const [photos, setPhotos] = useState<AttachmentView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    setError(null);

    try {
      const prepared = await preparePhoto(file);
      const attachment = await api.uploadPhoto(prepared.contentType, prepared.data);

      setPhotos((current) => [...current, attachment]);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось приложить фото');
    } finally {
      setUploading(false);
    }
  };

  return {
    photos,
    uploading,
    error,
    attach: (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';

      if (file) void upload(file);
    },
    reset: () => {
      setPhotos([]);
      setError(null);
    },
  };
};
