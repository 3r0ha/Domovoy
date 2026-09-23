import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi, type FlatNeighbourView } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';
import { IconCheck } from './icons.js';

/**
 * Кто привязан к квартире и кто ею владеет. Код из квитанции лежит в почтовом
 * ящике в подъезде, а привязка по нему открывает квитанцию, показания, домофон
 * и голос на собрании: жилец должен видеть список и убирать чужого сам.
 */
export const FlatPeople = ({ api }: { api: DomovoyApi }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [changed, setChanged] = useState(0);
  const haptics = useHaptics();
  const t = useT();

  const people = useBridgeRequest((alive) => api.until(alive).flatNeighbours(), [api, changed]);
  // Ответ читается как список даже тогда, когда его подменили заглушкой:
  // раздел профиля не должен ронять экран из-за чужой выдачи.
  const list = Array.isArray(people.data) ? people.data : [];
  const me = list.find((person) => person.self);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setFailed(undefined);

    try {
      await action();
      haptics.done();
      setChanged((count) => count + 1);
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  const title = (person: FlatNeighbourView): string =>
    person.self ? t('flat.people.you') : person.displayName;

  // Пустой список: ответ ещё не пришёл или квартира в другом доме. Заголовки без
  // строк висели пустыми, а без себя в списке не видно и собственности.
  if (list.length === 0) return null;

  return (
    <>
      <Group title={t('flat.people.title')}>
        {list.map((person, index) => (
          <CellSimple
            key={person.id}
            className="row-split"
            title={title(person)}
            subtitle={person.owner ? t('flat.people.owner') : t('flat.people.lives')}
            separator={index > 0}
            height="compact"
            {...(person.self
              ? {}
              : {
                  after: (
                    <button
                      type="button"
                      className="link"
                      disabled={busy}
                      onClick={() => void run(() => api.dropNeighbour(person.id))}
                    >
                      {t('flat.people.drop')}
                    </button>
                  ),
                })}
          />
        ))}
      </Group>

      {/* Выбор из двух строками с галочкой, как в выборе языка: двумя кнопками
          подряд он читался как ссылки, а в переключателе длинная подпись
          «Живу, но не собственник» не помещалась и резалась. */}
      <Group title={t('flat.owner.title')}>
        {[
          { owner: true, title: t('flat.owner.yes') },
          { owner: false, title: t('flat.owner.no') },
        ].map((choice, index) => (
          <CellSimple
            key={choice.title}
            title={choice.title}
            aria-current={me?.owner === choice.owner}
            separator={index > 0}
            height="compact"
            {...(me?.owner === choice.owner ? { after: <IconCheck /> } : {})}
            onClick={() => void run(() => api.declareOwnership(choice.owner))}
          />
        ))}
      </Group>

      <p className="hint aside">{t('flat.owner.about')}</p>

      {failed ? <ErrorText>{failed}</ErrorText> : null}
    </>
  );
};
