import { CellList, CellSimple } from '@maxhub/max-ui';

import type { Waiting } from '../App.js';
import { useT } from '../i18n.js';
import { type Screen } from '../navigation.js';
import { type Section } from '../sections.js';
import { Group } from './Group.js';

export interface TabBarProps {
  sections: readonly Section[];
  current: Screen;
  /** Сколько дел ждёт человека по разделам: из этого рисуются значки. */
  waiting: Waiting;
  /** Ожидания разделов, спрятанных в «Ещё»: их число висит на самой кнопке. */
  hidden?: readonly Section[];
  onPick: (screen: Screen) => void;
}

/** Сумма ожиданий по разделам: столько дел стоит за кнопкой. */
const countOf = (waiting: Waiting, sections: readonly Section[]): number =>
  sections.reduce((sum, section) => sum + (waiting[section.screen] ?? 0), 0);

/** Нижняя панель разделов. */
export const TabBar = ({ sections, current, waiting, hidden = [], onPick }: TabBarProps) => {
  const t = useT();

  return (
    <nav className="tabs" data-guide="tabs">
      {sections.map((section) => {
        const badge = section.screen === 'more' ? countOf(waiting, hidden) : (waiting[section.screen] ?? 0);

        return (
          <button
            key={section.screen}
            type="button"
            data-guide={`tab-${section.screen}`}
            className={current === section.screen ? 'tab tab-active' : 'tab'}
            aria-pressed={current === section.screen}
            onClick={() => onPick(section.screen)}
          >
            <span className="tab-icon">
              <section.icon />

              {badge > 0 ? (
                <span className="badge-count" aria-label={t('chrome.waiting', { число: badge })}>
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
            </span>
            <span className="tab-label">{section.title}</span>
          </button>
        );
      })}
    </nav>
  );
};

const Rows = ({
  sections,
  waiting,
  onPick,
}: {
  sections: readonly Section[];
  waiting: Waiting;
  onPick: (screen: Screen) => void;
}) => {
  const t = useT();

  return (
    <>
      {sections.map((section, index) => {
        const count = waiting[section.screen] ?? 0;

        return (
          <CellSimple
            key={section.screen}
            before={<span className={`tile ${section.tone}`}>{section.icon()}</span>}
            title={section.title}
            subtitle={section.hint}
            after={
              count > 0 ? (
                <span className="badge badge-waiting" aria-label={t('chrome.waiting', { число: count })}>
                  {count > 99 ? '99+' : count}
                </span>
              ) : undefined
            }
            showChevron
            separator={index > 0}
            onClick={() => onPick(section.screen)}
          />
        );
      })}
    </>
  );
};

/** Разделы, не поместившиеся в панель. У смены их много, поэтому они по группам. */
export const MoreScreen = ({
  sections,
  waiting = {},
  onPick,
}: {
  sections: readonly Section[];
  waiting?: Waiting;
  onPick: (screen: Screen) => void;
}) => {
  const groups = [...new Set(sections.map((section) => section.group))];

  if (groups.length <= 1) {
    return (
      <CellList mode="island">
        <Rows sections={sections} waiting={waiting} onPick={onPick} />
      </CellList>
    );
  }

  return (
    <div className="list">
      {groups.map((group) => (
        <Group key={group ?? 'прочее'} {...(group ? { title: group } : {})}>
          <Rows
            sections={sections.filter((section) => section.group === group)}
            waiting={waiting}
            onPick={onPick}
          />
        </Group>
      ))}
    </div>
  );
};
