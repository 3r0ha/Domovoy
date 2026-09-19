import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { ApiError, type DomovoyApi } from './api.js';
import { asBase64 } from './base64.js';

/** Дольше говорить незачем: запись обрывается сама и уходит на расшифровку. */
const MAX_SECONDS = 60;

/** Предел ручки расшифровки. Длиннее она не примет, и сказать это лучше здесь. */
const MAX_BYTES = 2_000_000;

/** Что клиент умеет писать. Расшифровке удобнее opus, остальное на случай, если его нет. */
const FORMATS = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/webm'];

export type VoiceState = 'idle' | 'recording' | 'decoding' | 'failed';

export interface VoiceInput {
  state: VoiceState;
  /** Сколько идёт запись: без счётчика не видно, что микрофон слушает. */
  seconds: number;
  /** Причина неудачи словами. */
  error: string | null;
  /**
   * Запись идёт прямо кнопкой. Иначе остаётся системная запись полем файла:
   * в вебвью мессенджера она открывается почти всегда.
   */
  live: boolean;
  start: () => void;
  stop: () => void;
  /** Запись, пришедшая системным полем файла. */
  attach: (event: ChangeEvent<HTMLInputElement>) => void;
  dismiss: () => void;
}

const recorderClass = (): typeof MediaRecorder | undefined =>
  (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;

const microphone = (): MediaDevices | undefined => {
  const media = (globalThis as { navigator?: { mediaDevices?: MediaDevices } }).navigator?.mediaDevices;

  return typeof media?.getUserMedia === 'function' ? media : undefined;
};

const formatFor = (recorder: typeof MediaRecorder): string | undefined =>
  typeof recorder.isTypeSupported === 'function'
    ? FORMATS.find((candidate) => recorder.isTypeSupported(candidate))
    : undefined;

/** Почему микрофон не включился. Отказ без слов выглядит как несработавшее нажатие. */
const refusal = (reason: unknown): string => {
  const name = reason instanceof Error ? reason.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Нет доступа к микрофону. Разрешите запись в настройках или запишите системной записью ниже';
  }

  if (name === 'NotFoundError') return 'Микрофон не найден. Запишите системной записью ниже';

  return 'Не получилось включить запись. Запишите системной записью ниже';
};

/** Запись голоса и её расшифровка: продукт слушает вместо того, чтобы заставлять печатать. */
export const useVoice = (api: DomovoyApi, onText: (text: string) => void): VoiceInput => {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(() => recorderClass() !== undefined && microphone() !== undefined);
  const [leaving] = useState(() => new AbortController());

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  // Занятость держится ссылкой, а не состоянием: второе нажатие приходит
  // раньше, чем перерисовка, и по состоянию запись началась бы дважды.
  const taking = useRef(false);
  const heard = useRef(onText);
  const halt = useRef<() => void>(() => undefined);

  heard.current = onText;

  const release = (): void => {
    recorder.current = null;
    taking.current = false;

    // Поток закрывается всегда: иначе в клиенте продолжает гореть значок записи.
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  const decode = async (sound: Blob): Promise<void> => {
    setState('decoding');

    if (sound.size === 0) {
      setState('failed');
      setError('Запись пустая. Скажите ещё раз');
      return;
    }

    if (sound.size > MAX_BYTES) {
      setState('failed');
      setError('Запись слишком длинная. Скажите короче');
      return;
    }

    try {
      const answer = await api.until(leaving.signal).voice(await asBase64(sound), sound.type || 'audio/ogg');
      const said = answer.text.trim();

      if (said.length === 0) {
        setState('failed');
        setError('Ничего не расслышал. Скажите ещё раз');
        return;
      }

      heard.current(said);
      setSeconds(0);
      setState('idle');
    } catch (reason) {
      if (leaving.signal.aborted) return;

      setState('failed');
      setError(reason instanceof ApiError ? reason.message : 'Не удалось разобрать запись');
    }
  };

  const begin = async (): Promise<void> => {
    const media = microphone();
    const Recorder = recorderClass();

    if (!media || !Recorder) {
      taking.current = false;
      setLive(false);
      return;
    }

    try {
      const opened = await media.getUserMedia({ audio: true });
      const format = formatFor(Recorder);
      const taping = new Recorder(opened, format === undefined ? {} : { mimeType: format });
      const parts: Blob[] = [];

      taping.ondataavailable = (event) => {
        if (event.data.size > 0) parts.push(event.data);
      };

      taping.onstop = () => {
        const type = format ?? taping.mimeType;

        release();
        void decode(new Blob(parts, { type: type || 'audio/ogg' }));
      };

      stream.current = opened;
      recorder.current = taping;
      taping.start();

      setSeconds(0);
      setState('recording');
    } catch (reason) {
      release();
      // Отказ в доступе не оставляет человека ни с чем: остаётся системная запись.
      setLive(false);
      setState('failed');
      setError(refusal(reason));
    }
  };

  const start = (): void => {
    if (taking.current) return;

    taking.current = true;
    setError(null);
    void begin();
  };

  const stop = (): void => {
    const taping = recorder.current;

    if (!taping || taping.state === 'inactive') return;

    setState('decoding');
    taping.stop();
  };

  halt.current = stop;

  // Счётчик идёт, только пока пишется звук.
  useEffect(() => {
    if (state !== 'recording') return undefined;

    const timer = setInterval(() => setSeconds((passed) => passed + 1), 1000);

    return () => clearInterval(timer);
  }, [state]);

  // Длинная запись обрывается сама: ручка расшифровки её всё равно не примет.
  useEffect(() => {
    if (state === 'recording' && seconds >= MAX_SECONDS) halt.current();
  }, [state, seconds]);

  useEffect(
    () => () => {
      const taping = recorder.current;

      if (taping) {
        // Обработчики снимаются до остановки: расшифровывать уже некому.
        taping.ondataavailable = null;
        taping.onstop = null;

        if (taping.state !== 'inactive') taping.stop();
      }

      leaving.abort();
      release();
    },
    // Уборка ставится один раз: она ходит по ссылкам, а они за время жизни не меняются.
    [leaving],
  );

  return {
    state,
    seconds,
    error,
    live,
    start,
    stop,
    attach: (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      event.target.value = '';

      if (file) {
        setError(null);
        void decode(file);
      }
    },
    dismiss: () => {
      setError(null);
      setState('idle');
    },
  };
};
