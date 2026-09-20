import { Component, type ErrorInfo, type ReactNode } from 'react';

interface GuardState {
  message: string | null;
}

/**
 * Последняя преграда перед пустым экраном: при ошибке отрисовки React убирает
 * всё дерево, и человек видит пустоту, о которой некому рассказать. Здесь
 * остаётся сообщение, кнопка перезапуска и телефоны, по которым звонят при аварии.
 */
export class Guard extends Component<{ children: ReactNode }, GuardState> {
  override state: GuardState = { message: null };

  static getDerivedStateFromError(error: unknown): GuardState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Приложение не запустилось', error, info.componentStack);
  }

  override render(): ReactNode {
    const { message } = this.state;

    if (message === null) return this.props.children;

    return (
      <div className="guard">
        <h1>Приложение не запустилось</h1>
        <p>Закройте его и откройте снова. Если не поможет, напишите боту словами.</p>
        <button type="button" onClick={() => globalThis.location.reload()}>
          Перезапустить
        </button>
        <p className="guard-why">{message}</p>
        <p>
          При аварии звоните, не дожидаясь приложения: <a href="tel:112">112</a>, газовая служба{' '}
          <a href="tel:104">104</a>.
        </p>
      </div>
    );
  }
}
