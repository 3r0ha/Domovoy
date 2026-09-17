import { Button } from '@maxhub/max-ui';
import { useBridge, useSupports } from '@maxkit/react';
import { useState } from 'react';

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

/** Чтение наклейки камерой клиента MAX. */
export const useCodeScanner = (
  onScanned: (startParam: string) => void,
): { supported: boolean; error: string | null; scan: () => void } => {
  const bridge = useBridge();
  const supported = useSupports('codeReader');
  const [error, setError] = useState<string | null>(null);

  const scan = async (): Promise<void> => {
    setError(null);

    try {
      const result = await bridge.openCodeReader();
      const code = result.code === undefined ? undefined : codeFromScan(result.code);

      if (!code) {
        setError('Это не код объекта');
        return;
      }

      onScanned(code);
    } catch {
      setError(null);
    }
  };

  return { supported, error, scan: () => void scan() };
};

/** Кнопка показывается только там, где клиент MAX умеет читать коды. */
export const ScanCode = ({ onScanned, compact }: ScanCodeProps) => {
  const scanner = useCodeScanner(onScanned);

  if (!scanner.supported) return null;

  if (compact) {
    return (
      <>
        <button
          type="button"
          className="composer-icon"
          aria-label="Сканировать код"
          title="Сканировать код"
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
        Сканировать код
      </Button>
      {scanner.error ? <ErrorText>{scanner.error}</ErrorText> : null}
    </div>
  );
};
