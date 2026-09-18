import { Avatar, Button, CellSimple, Input, Switch } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  type ApartmentOptionView,
  type BuildingView,
  type DomovoyApi,
  type PersonView,
  type RoleView,
  type UnboundResidentView,
} from '../api.js';
import { Confirm } from './Confirm.js';
import { Empty } from './Empty.js';
import { More } from './More.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconPeople } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface ResidentsScreenProps {
  api: DomovoyApi;
  /** Роли раздаёт только управляющий: диспетчер их видит, но не меняет. */
  canAssignRoles?: boolean;
}

/** Сколько жильцов показывается сразу: в доме их сотни. */
const PEOPLE_PAGE = 20;

const ROLES: { value: RoleView; title: string }[] = [
  { value: 'resident', title: 'жилец' },
  { value: 'dispatcher', title: 'диспетчер' },
  { value: 'technician', title: 'мастер' },
  { value: 'manager', title: 'управляющий' },
  { value: 'contractor', title: 'подрядчик' },
];

const roleTitle = (role: RoleView): string => ROLES.find((item) => item.value === role)?.title ?? role;

/** Первая буква имени вместо фотографии. */
const initial = (name: string): string => name.trim().slice(0, 1).toUpperCase() || '?';

/** Сколько дней идут выборы старшего: столько же, сколько обычное собрание. */
const ELDER_POLL_DAYS = 14;

const describePerson = (person: PersonView): string => {
  const flat =
    person.apartmentNumber === undefined
      ? person.role === 'resident'
        ? 'квартира не привязана'
        : ''
      : `кв. ${person.apartmentNumber}`;
  const duty = person.role === 'resident' ? '' : person.onDuty === true ? 'на дежурстве' : 'не на дежурстве';

  return [roleTitle(person.role), flat, duty].filter(Boolean).join(' · ');
};

/** Поиск по людям: имя, роль и номер квартиры сразу. */
const foundPerson = (person: PersonView, query: string): boolean => {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) return true;

  return [person.displayName, roleTitle(person.role), person.apartmentNumber ?? '']
    .join('\n')
    .toLowerCase()
    .includes(needle);
};

/** Дежурство переключателем. */
const PersonRow = ({
  person,
  canAssign,
  busy,
  expanded,
  buildings,
  onToggleRoles,
  onAssign,
  onDuty,
  onServe,
  onUnbind,
  onElect,
  separator,
}: {
  person: PersonView;
  canAssign: boolean;
  busy: boolean;
  expanded: boolean;
  /** Дома компании: из них и выбирают, что обслуживает сотрудник. */
  buildings: BuildingView[];
  onToggleRoles: () => void;
  onAssign: (role: RoleView) => void;
  onDuty: (onDuty: boolean) => void;
  onServe: (buildingId: string, served: boolean) => void;
  onUnbind: () => void;
  onElect: () => void;
  separator: boolean;
}) => (
  <>
    <CellSimple
      before={
        <Avatar.Container size={40}>
          <Avatar.Text>{initial(person.displayName)}</Avatar.Text>
        </Avatar.Container>
      }
      className={expanded ? 'row-open' : ''}
      title={person.displayName}
      subtitle={describePerson(person)}
      separator={separator}
      showChevron={canAssign && person.role === 'resident'}
      after={
        person.role === 'resident' ? null : (
          <span className="duty">
            <Switch
              checked={person.onDuty === true}
              disabled={busy}
              aria-label={`Дежурство: ${person.displayName}`}
              onChange={() => onDuty(person.onDuty !== true)}
            />
          </span>
        )
      }
      onClick={canAssign ? onToggleRoles : undefined}
    />

    {expanded && canAssign ? (
      <>
        <div className="roles" role="group" aria-label={`Роль: ${person.displayName}`}>
          {ROLES.map((role) => (
            <Button
              key={role.value}
              type="button"
              size="small"
              variant={person.role === role.value ? 'primary' : 'secondary'}
              aria-pressed={person.role === role.value}
              disabled={busy || person.role === role.value}
              onClick={() => onAssign(role.value)}
            >
              {role.title}
            </Button>
          ))}
        </div>

        {person.role === 'resident' ? null : (
          <div className="roles" role="group" aria-label={`Дома: ${person.displayName}`}>
            {buildings.map((building) => {
              const served = (person.buildingIds ?? []).includes(building.id);

              return (
                <Button
                  key={building.id}
                  type="button"
                  size="small"
                  variant={served ? 'primary' : 'secondary'}
                  aria-pressed={served}
                  disabled={busy}
                  onClick={() => onServe(building.id, !served)}
                >
                  {building.code}
                </Button>
              );
            })}
          </div>
        )}

        {person.role === 'resident' && person.apartmentNumber !== undefined ? (
          <div className="roles">

            <Button type="button" size="small" variant="secondary" disabled={busy} onClick={onElect}>
              В старшие подъезда
            </Button>
            <Button type="button" size="small" variant="secondary" disabled={busy} onClick={onUnbind}>
              Съехал
            </Button>
          </div>
        ) : null}
      </>
    ) : null}
  </>
);

/** Люди дома, их роли и дежурство. */
const People = ({
  api,
  canAssign,
  bound,
  query,
}: {
  api: DomovoyApi;
  canAssign: boolean;
  bound: number;
  /** Поиск общий на весь экран: он стоит над обоими списками. */
  query: string;
}) => {
  const people = useBridgeRequest(() => api.people(), [api, bound]);
  const buildings = useBridgeRequest(() => api.buildings(), [api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PEOPLE_PAGE);
  // Отвязка квартиры и выборы старшего затрагивают человека и весь подъезд:
  // их спрашивают отдельно, а не одним нажатием.
  const [asked, setAsked] = useState<{ kind: 'unbind' | 'elect'; person: PersonView } | null>(null);

  const assign = async (id: string, role: RoleView): Promise<void> => {
    setBusy(id);
    setError(null);

    try {
      await api.assignRole(id, role);
      setExpanded(null);
      people.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось изменить роль');
    } finally {
      setBusy(null);
    }
  };

  const duty = async (id: string, onDuty: boolean): Promise<void> => {
    setBusy(id);
    setError(null);

    try {
      await api.setDuty(id, onDuty);
      people.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось изменить дежурство');
    } finally {
      setBusy(null);
    }
  };

  const run = async (id: string, what: () => Promise<unknown>, failed: string): Promise<void> => {
    setBusy(id);
    setError(null);

    try {
      await what();
      people.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : failed);
    } finally {
      setBusy(null);
    }
  };

  const serve = (person: PersonView, buildingId: string, served: boolean): Promise<void> => {
    const own = new Set(person.buildingIds ?? []);

    if (served) own.add(buildingId);
    else own.delete(buildingId);

    return run(person.id, () => api.setServedBuildings(person.id, [...own]), 'Не удалось изменить дома');
  };

  if (people.loading && !people.data) return <Skeleton />;

  if (people.error && !people.data) {
    return <Failure title="Люди не загрузились" error={people.error} onRetry={people.reload} />;
  }

  const all = people.data ?? [];

  if (all.length === 0) {
    return <Empty icon={<IconPeople />} title="Людей нет" hint="Появятся, когда жильцы откроют бота" />;
  }

  const list = all.filter((person) => foundPerson(person, query));
  const residents = list.filter((person) => person.role === 'resident');
  const groups = [
    { title: 'Смена', people: list.filter((person) => person.role !== 'resident') },
    // Жильцов в доме сотни: список дочитывается кнопкой, смена показывается целиком.
    { title: 'Жильцы', people: residents.slice(0, limit) },
  ].filter((group) => group.people.length > 0);
  const rest = residents.length - Math.min(limit, residents.length);

  return (
    <>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {groups.length === 0 ? <p className="lead">Никого не нашлось</p> : null}

      {groups.map((group) => (
        <Group key={group.title} title={group.title}>
          {group.people.map((person, index) => (
            <PersonRow
              key={person.id}
              person={person}
              canAssign={canAssign}
              busy={busy === person.id}
              expanded={expanded === person.id}
              separator={index > 0}
              buildings={buildings.data ?? []}
              onToggleRoles={() => setExpanded(expanded === person.id ? null : person.id)}
              onAssign={(role) => void assign(person.id, role)}
              onDuty={(value) => void duty(person.id, value)}
              onServe={(buildingId, served) => void serve(person, buildingId, served)}
              onUnbind={() => setAsked({ kind: 'unbind', person })}
              onElect={() => setAsked({ kind: 'elect', person })}
            />
          ))}

          {group.title === 'Жильцы' && rest > 0 ? (
            <More loading={false} error={null} onMore={() => setLimit((current) => current + PEOPLE_PAGE)} />
          ) : null}
        </Group>
      ))}

      {asked ? (
        <Confirm
          title={asked.kind === 'unbind' ? 'Жилец съехал?' : 'Объявить выборы старшего?'}
          text={
            asked.kind === 'unbind'
              ? `${asked.person.displayName} потеряет доступ к квартире ${asked.person.apartmentNumber ?? ''}: ` +
                'счётчики, квитанция и голос на собрании закроются.'
              : `Соседи по подъезду будут голосовать за кандидата ${asked.person.displayName}. ` +
                `Голосование идёт ${ELDER_POLL_DAYS} дней.`
          }
          confirmLabel={asked.kind === 'unbind' ? 'Отвязать квартиру' : 'Объявить выборы'}
          busy={busy === asked.person.id}
          danger={asked.kind === 'unbind'}
          onCancel={() => setAsked(null)}
          onConfirm={() => {
            const { kind, person } = asked;

            setAsked(null);

            void run(
              person.id,
              () =>
                kind === 'unbind'
                  ? api.unbindResident(person.id, person.apartmentId)
                  : api.startElderPoll(person.id, ELDER_POLL_DAYS),
              kind === 'unbind' ? 'Не удалось отвязать квартиру' : 'Не удалось объявить выборы',
            );
          }}
        />
      ) : null}
    </>
  );
};

/** Квартира выбирается из списка: опечатка открыла бы чужие показания. */
const UnboundRow = ({
  api,
  resident,
  apartments,
  onBound,
}: {
  api: DomovoyApi;
  resident: UnboundResidentView;
  apartments: ApartmentOptionView[];
  onBound: () => void;
}) => {
  const [apartmentId, setApartmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bind = async (): Promise<void> => {
    if (!apartmentId) {
      setError('Выберите квартиру');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await api.bindResident(resident.id, apartmentId);
      onBound();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не удалось привязать');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="request">
      <header>
        <strong>{resident.displayName}</strong>
        <span className="row-state">
          <span className="dot dot-warn" />
          без квартиры
        </span>
      </header>

      <div className="bind">
        <select
          aria-label={`Квартира: ${resident.displayName}`}
          value={apartmentId}
          onChange={(event) => setApartmentId(event.target.value)}
        >
          <option value="">Квартира…</option>
          {apartments.map((apartment) => (
            <option key={apartment.id} value={apartment.id}>
              кв. {apartment.number} · подъезд {apartment.entrance}, стояк {apartment.riser}
              {apartment.code ? ` · ${apartment.code}` : ''}
            </option>
          ))}
        </select>

        <Button type="button" size="small" disabled={busy} onClick={() => void bind()}>
          {busy ? '…' : 'Привязать'}
        </Button>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}
    </article>
  );
};

/** Жильцы без квартиры: код из квитанции теряют, и привязать их может сотрудник. */
export const ResidentsScreen = ({ api, canAssignRoles }: ResidentsScreenProps) => {
  const unbound = useBridgeRequest(() => api.unboundResidents(), [api]);
  const apartments = useBridgeRequest(() => api.apartments(), [api]);
  const [bound, setBound] = useState(0);
  const [query, setQuery] = useState('');

  if (unbound.loading && !unbound.data) return <Skeleton count={2} />;

  if (unbound.error) {
    return <Failure title="Список недоступен" error={unbound.error} onRetry={unbound.reload} />;
  }

  const needle = query.trim().toLowerCase();
  const waiting = (unbound.data ?? []).filter(
    (resident) => needle.length === 0 || resident.displayName.toLowerCase().includes(needle),
  );

  return (
    <section className="list">
      {/* Поиск стоит над обоими списками: в доме людей сотни. */}
      <Input
        className="field"
        id="people-search"
        type="search"
        aria-label="Поиск по людям"
        withClearButton
        value={query}
        placeholder="Имя, роль или номер квартиры"
        onChange={(event) => setQuery(event.target.value)}
      />

      {waiting.length > 0 ? (
        <>
          <h2 className="group-title">Ждут привязки к квартире</h2>

          {waiting.map((resident) => (
            <UnboundRow
              key={resident.id}
              api={api}
              resident={resident}
              apartments={apartments.data ?? []}
              onBound={() => {
                unbound.reload();
                setBound((count) => count + 1);
              }}
            />
          ))}
        </>
      ) : null}

      <People api={api} canAssign={canAssignRoles ?? false} bound={bound} query={query} />
    </section>
  );
};
