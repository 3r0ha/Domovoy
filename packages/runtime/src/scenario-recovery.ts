/** Контекст, в котором движок сценариев хранит прогресс. */
export interface ScenarioContextLike {
  session?: { scenario?: unknown } & Record<string, unknown>;
}

export type Middleware<Ctx> = (context: Ctx, next: () => Promise<void>) => Promise<void>;

export interface ScenarioRecoveryOptions<Ctx extends ScenarioContextLike> {
  /** Из каких ошибок можно выйти сбросом состояния. */
  isRecoverable?: (error: unknown) => boolean;
  /** Как убрать состояние. По умолчанию удаляется `ctx.session.scenario`. */
  clearState?: (context: Ctx) => void;
  /** Вызывается после сброса состояния сценария. */
  onRecovered?: (error: unknown, context: Ctx) => void | Promise<void>;
}

/** Сообщения движка сценариев, после которых состояние в сессии больше не соответствует коду. */
const RECOVERABLE_PATTERNS = [
  /is not registered/i,
  /has no step/i,
  /is already active/i,
  /uses another definition/i,
  /must return a transition/i,
  /Unsupported scenario transition/i,
];

const defaultIsRecoverable = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return RECOVERABLE_PATTERNS.some((pattern) => pattern.test(error.message));
};

const defaultClearState = (context: ScenarioContextLike): void => {
  if (context.session) delete context.session.scenario;
};

/** Вытаскивает пользователя из зависшего сценария. */
export const scenarioRecovery = <Ctx extends ScenarioContextLike>(
  options: ScenarioRecoveryOptions<Ctx> = {},
): Middleware<Ctx> => {
  const isRecoverable = options.isRecoverable ?? defaultIsRecoverable;
  const clearState = options.clearState ?? defaultClearState;

  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      if (!isRecoverable(error)) throw error;

      clearState(context);
      await options.onRecovered?.(error, context);
    }
  };
};
