import { Button } from '@maxhub/max-ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Empty } from './Empty.js';
import { IconHome } from './icons.js';

export interface ScreenGuardProps {
  children: ReactNode;
  /** Шаг назад, туда откуда пришли. Пусто на стартовом экране. */
  onBack?: (() => void) | undefined;
  onHome: () => void;
}

/**
 * Отказ одного раздела не уносит всё приложение: человек видит, что случилось,
 * и уходит назад или на стартовый экран. Возврат к разделу делает новый ключ
 * у этой границы: при переходе она создаётся заново и показывает раздел.
 */
export class ScreenGuard extends Component<ScreenGuardProps, { message: string | null }> {
  override state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): { message: string | null } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Раздел не открылся', error, info.componentStack);
  }

  override render(): ReactNode {
    const { message } = this.state;

    if (message === null) return this.props.children;

    return (
      <Empty icon={<IconHome />} title="Раздел не открылся" hint={message}>
        <div className="confirm-keys">
          {this.props.onBack ? (
            <Button type="button" variant="secondary" onClick={this.props.onBack}>
              Назад
            </Button>
          ) : null}
          <Button type="button" onClick={this.props.onHome}>
            На главную
          </Button>
        </div>
      </Empty>
    );
  }
}
