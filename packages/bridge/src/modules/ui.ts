import type { RequestFn } from '../request-controller.js';
import type { ImpactStyle, NotificationType } from '../types.js';

export type BackButtonCallback = () => void;

export interface BackButtonDeps {
  setVisible: (isVisible: boolean) => void;
  onPressed: (callback: BackButtonCallback) => () => void;
}

/** Системная кнопка «назад» клиента MAX. */
export class BackButton {
  private visible = false;
  private readonly unsubscribers = new Map<BackButtonCallback, () => void>();

  constructor(private readonly deps: BackButtonDeps) {}

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.deps.setVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.deps.setVisible(false);
  }

  /** @returns функция отписки. */
  onClick(callback: BackButtonCallback): () => void {
    const unsubscribe = this.deps.onPressed(callback);
    this.unsubscribers.set(callback, unsubscribe);
    return () => this.offClick(callback);
  }

  offClick(callback: BackButtonCallback): void {
    this.unsubscribers.get(callback)?.();
    this.unsubscribers.delete(callback);
  }
}

/** Тактильная отдача. Ошибки глушатся. */
export class HapticFeedback {
  constructor(private readonly request: RequestFn) {}

  impactOccurred(impactStyle: ImpactStyle, disableVibrationFallback = false): void {
    void this.request('WebAppHapticFeedbackImpact', { impactStyle, disableVibrationFallback }).catch(() => undefined);
  }

  notificationOccurred(notificationType: NotificationType, disableVibrationFallback = false): void {
    void this.request('WebAppHapticFeedbackNotification', { notificationType, disableVibrationFallback }).catch(
      () => undefined,
    );
  }

  selectionChanged(disableVibrationFallback = false): void {
    void this.request('WebAppHapticFeedbackSelectionChange', { disableVibrationFallback }).catch(() => undefined);
  }
}

/** Запрет скриншотов и записи экрана, актуально для экранов с персональными данными. */
export class ScreenCapture {
  private enabled = false;

  constructor(private readonly request: RequestFn) {}

  get isScreenCaptureEnabled(): boolean {
    return this.enabled;
  }

  async enableScreenCapture(): Promise<{ isScreenCaptureEnabled: boolean }> {
    const result = await this.request('WebAppSetupScreenCaptureBehavior', { isScreenCaptureEnabled: true });
    this.enabled = result.isScreenCaptureEnabled;
    return result;
  }

  async disableScreenCapture(): Promise<{ isScreenCaptureEnabled: boolean }> {
    const result = await this.request('WebAppSetupScreenCaptureBehavior', { isScreenCaptureEnabled: false });
    this.enabled = result.isScreenCaptureEnabled;
    return result;
  }
}

/** Вертикальные свайпы клиента */
export class SwipesBehavior {
  private enabled = true;

  constructor(private readonly request: RequestFn) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  async enable(): Promise<{ allowVerticalSwipes: boolean }> {
    const result = await this.request('WebAppSetupSwipesBehavior', { allowVerticalSwipes: true });
    this.enabled = result.allowVerticalSwipes;
    return result;
  }

  async disable(): Promise<{ allowVerticalSwipes: boolean }> {
    const result = await this.request('WebAppSetupSwipesBehavior', { allowVerticalSwipes: false });
    this.enabled = result.allowVerticalSwipes;
    return result;
  }
}
