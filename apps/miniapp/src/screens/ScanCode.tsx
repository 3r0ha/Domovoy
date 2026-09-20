import { MaxBridgeError } from '@maxkit/bridge';
import { Button } from '@maxhub/max-ui';
import { useBridge, useSupports } from '@maxkit/react';
import { useState } from 'react';

import type { Translate } from '@domovoy/i18n';

import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';
import { IconScan } from './icons.js';

export interface ScanCodeProps {
  /** Позвать с кодом объекта, когда наклейка распознана. */
  onScanned: (startParam: string) => void;
  /** Только значок: в строке ответа подписи не нужны. */
  compact?: boolean;
}

/** На наклейке ссылка `https://max.ru/<бот>?startapp=<код>`, из неё берётся код. */
export const codeFromScan = (scanned: string): string | undefined => {
  const value = scanned.trim();

  if (value.length === 0) return undefined;

  try {
    const fromLink = new URL(value).searchParams.get('startapp');

    return fromLink ?? undefined;
  } catch {
    return value;
  }
};

/**
 * Почему камера не открылась. Отказ без слов выглядит как несработавшее
 * нажатие: человек жмёт ещё раз и снова ничего не получает.
 */
const cameraRefusal = (t: Translate, reason: unknown): string | null => {
  if (!(reason instanceof MaxBridgeError)) return t('scan.camera.closed');

  // Закрытое самим человеком окно камеры объяснять нечего.
  if (reason.isAborted) return null;
  if (reason.isPermissionDenied) return t('scan.camera.denied');
  if (reason.isUnsupported || reason.isOutsideMax) return t('scan.camera.unsupported');

  return t('scan.camera.closed');
};

/** Чтение наклейки камерой клиента MAX. */
export const useCodeScanner = (
  onScanned: (startParam: string) => void,
): { supported: boolean; error: string | null; scan: () => void } => {
  const t = useT();
  const bridge = useBridge();
  const supported = useSupports('codeReader');
  const [error, setError] = useState<string | null>(null);

  const scan = async (): Promise<void> => {
    setError(null);

    try {
      const result = await bridge.openCodeReader();
      const code = result.code === undefined ? undefined : codeFromScan(result.code);

      if (!code) {
        setError(t('scan.notCode'));
        return;
      }

      onScanned(code);
    } catch (reason) {
      setError(cameraRefusal(t, reason));
    }
  };

  return { supported, error, scan: () => void scan() };
};

/** Кнопка показывается только там, где клиент MAX умеет читать коды. */
export const ScanCode = ({ onScanned, compact }: ScanCodeProps) => {
  const t = useT();
  const scanner = useCodeScanner(onScanned);

  if (!scanner.supported) return null;

  if (compact) {
    return (
      <>
        <button
          type="button"
          className="composer-icon"
          aria-label={t('scan.action')}
          title={t('scan.action')}
          onClick={scanner.scan}
        >
          <IconScan />
        </button>

        {scanner.error ? <ErrorText className="composer-error">{scanner.error}</ErrorText> : null}
      </>
    );
  }

  return (
    <div className="scan">
      <Button type="button" size="small" variant="secondary" iconBefore={<IconScan />} onClick={scanner.scan}>
        {t('scan.action')}
      </Button>
      {scanner.error ? <ErrorText>{scanner.error}</ErrorText> : null}
    </div>
  );
};
