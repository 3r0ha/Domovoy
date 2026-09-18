import { Button, CellAction, CellInput, CellSimple, Textarea } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState, type ReactNode } from 'react';

import { ApiError, type BuildingView, type DomovoyApi, type ImportResultView } from '../api.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Confirm } from './Confirm.js';
import { Group } from './Group.js';
import { IconNews } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface ImportScreenProps {
  api: DomovoyApi;
}

/** Строка списка квартир: столбцы те же, что в выгрузке. */
interface FlatRow {
  number: string;
  entrance: string;
  riser: string;
  area: string;
  people: string;
}

const EMPTY_FLAT: FlatRow = { number: '', entrance: '1', riser: '1', area: '', people: '' };

/** Строка списка оборудования. */
interface UnitRow {
  code: string;
  title: string;
  kind: string;
}

const EMPTY_UNIT: UnitRow = { code: '', title: '', kind: '' };

const FLAT_HEADER = 'Помещение;Подъезд;Стояк;Площадь;Жильцов';
const UNIT_HEADER = 'Код;Название;Вид';

/** Заполненные строки уходят на сервер тем же разделителем, что и выгрузка. */
const flatsToText = (rows: readonly FlatRow[]): string =>
  [
    FLAT_HEADER,
    ...rows
      .filter((row) => row.number.trim().length > 0)
      .map((row) => [row.number, row.entrance, row.riser, row.area, row.people].map((cell) => cell.trim()).join(';')),
  ].join('\n');

const unitsToText = (rows: readonly UnitRow[]): string =>
  [
    UNIT_HEADER,
    ...rows
      .filter((row) => row.code.trim().length > 0 && row.title.trim().length > 0)
      .map((row) => [row.code, row.title, row.kind].map((cell) => cell.trim()).join(';')),
  ].join('\n');

/** Вставленная из таблицы выгрузка: строки разбираются по точке с запятой или табуляции. */
const parseFlats = (text: string): FlatRow[] =>
  text
    .split('\n')
    .map((line) => line.split(/[;\t]/).map((cell) => cell.trim()))
    .filter((cells) => cells[0] !== undefined && /^\d/.test(cells[0]))
    .map((cells) => ({
      number: cells[0] ?? '',
      entrance: cells[1] ?? '1',
      riser: cells[2] ?? '1',
      area: cells[3] ?? '',
      people: cells[4] ?? '',
    }));

/** Строка заменяется на месте: остальные не трогаются. */
const replaceAt = <Row,>(rows: readonly Row[], index: number, row: Row): Row[] =>
  rows.map((current, at) => (at === index ? row : current));

const parseUnits = (text: string): UnitRow[] =>
  text
    .split('\n')
    .map((line) => line.split(/[;\t]/).map((cell) => cell.trim()))
    .filter((cells) => (cells[0] ?? '').length > 0 && (cells[1] ?? '').length > 0 && cells[0] !== 'Код')
    .map((cells) => ({ code: cells[0] ?? '', title: cells[1] ?? '', kind: cells[2] ?? '' }));

interface HouseCard {
  address: string;
  timeZone: string;
  /** Ответственный по дому: его видят жильцы в поддержке. */
  name: string;
  role: string;
  phone: string;
  email: string;
  /** Аварийная служба, телефоны организации и приём: их жилец видит в MAX. */
  emergencyPhone: string;
  companyPhone: string;
  companyEmail: string;
  hours: string;
  office: string;
  officeHours: string;
}

const cardOf = (building?: BuildingView): HouseCard => ({
  address: building?.address ?? '',
  timeZone: building?.timeZone ?? '',
  name: building?.contact?.name ?? '',
  role: building?.contact?.role ?? '',
  phone: building?.contact?.phone ?? '',
  email: building?.contact?.email ?? '',
  emergencyPhone: building?.service?.emergencyPhone ?? '',
  companyPhone: building?.service?.phone ?? '',
  companyEmail: building?.service?.email ?? '',
  hours: building?.service?.hours ?? '',
  office: building?.service?.office ?? '',
  officeHours: building?.service?.officeHours ?? '',
});

/** Строки списка: подписи столбцов стоят один раз сверху. */
const Rows = ({
  columns,
  children,
}: {
  columns: readonly { key: string; title: string; wide?: boolean }[];
  children: ReactNode;
}) => (
  <div className="rows">
    <div className="rows-head" aria-hidden="true">
      {columns.map((column) => (
        <span key={column.key} className={column.wide ? 'rows-cell rows-wide' : 'rows-cell'}>
          {column.title}
        </span>
      ))}
    </div>
    {children}
  </div>
);

const FLAT_COLUMNS = [
  { key: 'number', title: 'Кв.' },
  { key: 'entrance', title: 'Подъезд' },
  { key: 'riser', title: 'Стояк' },
  { key: 'area', title: 'м²' },
  { key: 'people', title: 'Живёт' },
];

const UNIT_COLUMNS = [
  { key: 'code', title: 'Код' },
  { key: 'title', title: 'Название', wide: true },
  { key: 'kind', title: 'Вид' },
];

/** Вставка выгрузки: текст сразу превращается в строки, и их видно до отправки. */
const Paste = ({ label, hint, onPaste }: { label: string; hint: string; onPaste: (text: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="paste">
      <Textarea
        mode="secondary"
        aria-label={label}
        rows={4}
        value={text}
        placeholder={hint}
        onChange={(event) => setText(event.target.value)}
      />

      <div className="row-links">
        <button
          type="button"
          className="link"
          disabled={text.trim().length === 0}
          onClick={() => {
            onPaste(text);
            setText('');
            setOpen(false);
          }}
        >
          Разобрать строки
        </button>

        <button type="button" className="link quiet" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </div>
  );
};

/** Дом заводится списком квартир: строками вручную или вставкой из таблицы. */
export const ImportScreen = ({ api }: ImportScreenProps) => {
  const house = useBridgeRequest(() => api.selectedBuilding(), [api]);
  const [edited, setEdited] = useState<HouseCard | null>(null);
  const card = edited ?? cardOf(house.data);
  const setCard = setEdited;
  const [chat, setChat] = useState<BuildingView | null>(null);
  const bound = (chat ?? house.data)?.chatBound === true;
  const [flats, setFlats] = useState<FlatRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultView | null>(null);

  const run = async (what: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      setDone(await what());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  // Пока карточка не прочитана, форму не показывают: пустые поля стёрли бы то,
  // что уже заведено в доме.
  if (house.loading && !house.data) return <Skeleton count={4} />;

  if (house.error && !house.data) {
    return <Failure title="Карточка дома не загрузилась" error={house.error} onRetry={house.reload} />;
  }

  return (
    <section className="list">
      <div className="card-form">
      <Group title="Дом">
        <CellInput
          className="field-row"
          id="house-address"
          aria-label="Адрес"
          placeholder="Улица, дом"
          before={<span className="cell-label">Адрес</span>}
          value={card.address}
          onChange={(event) => setCard({ ...card, address: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-zone"
          aria-label="Часовой пояс"
          placeholder="Europe/Moscow"
          before={<span className="cell-label">Часовой пояс</span>}
          value={card.timeZone}
          onChange={(event) => setCard({ ...card, timeZone: event.target.value })}
        />
      </Group>

      <Group title="К кому обращаться">
        <CellInput
          className="field-row"
          id="house-contact-name"
          aria-label="Ответственный"
          placeholder="Фамилия Имя Отчество"
          before={<span className="cell-label">ФИО</span>}
          value={card.name}
          onChange={(event) => setCard({ ...card, name: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-contact-role"
          aria-label="Должность"
          placeholder="старший инженер"
          before={<span className="cell-label">Должность</span>}
          value={card.role}
          onChange={(event) => setCard({ ...card, role: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-contact-phone"
          aria-label="Телефон"
          type="tel"
          placeholder="+7 900 000-00-00"
          before={<span className="cell-label">Телефон</span>}
          value={card.phone}
          onChange={(event) => setCard({ ...card, phone: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-contact-email"
          aria-label="Почта"
          type="email"
          placeholder="uk@example.ru"
          before={<span className="cell-label">Почта</span>}
          value={card.email}
          onChange={(event) => setCard({ ...card, email: event.target.value })}
        />
      </Group>

      <Group title="Обслуживание">
        <CellInput
          className="field-row"
          id="house-emergency-phone"
          aria-label="Аварийная служба"
          type="tel"
          placeholder="+7 900 000-00-00"
          before={<span className="cell-label">Авария</span>}
          value={card.emergencyPhone}
          onChange={(event) => setCard({ ...card, emergencyPhone: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-company-phone"
          aria-label="Телефон организации"
          type="tel"
          placeholder="+7 900 000-00-00"
          before={<span className="cell-label">Телефон</span>}
          value={card.companyPhone}
          onChange={(event) => setCard({ ...card, companyPhone: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-company-email"
          aria-label="Почта организации"
          type="email"
          placeholder="uk@example.ru"
          before={<span className="cell-label">Почта</span>}
          value={card.companyEmail}
          onChange={(event) => setCard({ ...card, companyEmail: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-hours"
          aria-label="Режим работы"
          placeholder="пн-пт 9:00-18:00"
          before={<span className="cell-label">Режим</span>}
          value={card.hours}
          onChange={(event) => setCard({ ...card, hours: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-office"
          aria-label="Адрес приёма"
          placeholder="Улица, дом, офис"
          before={<span className="cell-label">Приём</span>}
          value={card.office}
          onChange={(event) => setCard({ ...card, office: event.target.value })}
        />
        <CellInput
          className="field-row"
          id="house-office-hours"
          aria-label="Часы приёма"
          placeholder="вт и чт 15:00-19:00"
          before={<span className="cell-label">Часы</span>}
          value={card.officeHours}
          onChange={(event) => setCard({ ...card, officeHours: event.target.value })}
        />
      </Group>

      <p className="hint aside">Контакты видит жилец в поддержке и в боте по команде /contacts</p>

      {/* Сохранение не уезжает за край: полей в карточке много, а кнопка одна на все. */}
      <div className="save-bar">
        <Button
          type="button"
          stretched
          size="large"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const saved = await api.updateBuilding({
                address: card.address,
                timeZone: card.timeZone,
                contact: {
                  name: card.name,
                  ...(card.role ? { role: card.role } : {}),
                  ...(card.phone ? { phone: card.phone } : {}),
                  ...(card.email ? { email: card.email } : {}),
                },
                service: {
                  emergencyPhone: card.emergencyPhone,
                  phone: card.companyPhone,
                  email: card.companyEmail,
                  hours: card.hours,
                  office: card.office,
                  officeHours: card.officeHours,
                },
              });

              return saved.contact
                ? `${saved.address || saved.code}: ${saved.contact.name}`
                : `${saved.address || saved.code}, пояс ${saved.timeZone ?? 'по умолчанию'}`;
            })
          }
        >
          {busy ? 'Сохраняем…' : 'Сохранить карточку'}
        </Button>
      </div>
      </div>

      <Group title="Чат дома">
        <CellSimple
          before={
            <span className={bound ? 'tile tile-green' : 'tile tile-grey'}>
              <IconNews />
            </span>
          }
          title={bound ? 'Привязан' : 'Не привязан'}
          subtitle={
            bound
              ? 'Объявления, аварии и работы уходят и в общий чат'
              : 'Добавьте бота в общий чат жильцов, привязка произойдёт сама'
          }
          height="compact"
        />
        {bound ? (
          <CellAction
            mode="destructive"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setChat(await api.releaseHouseChat());

                return 'Чат отвязан: объявления туда больше не уходят';
              })
            }
          >
            Отвязать
          </CellAction>
        ) : null}
      </Group>

      <Group title="Квартиры">
        <div className="rows-box">
          {flats.length === 0 ? (
            <p className="hint rows-about">Помещения дома: из них считается счёт и строится план</p>
          ) : null}

          {flats.length > 0 ? (
            <Rows columns={FLAT_COLUMNS}>
              {flats.map((row, index) => (
                <div key={index} className="rows-line">
                  <input
                    className="rows-cell"
                    inputMode="numeric"
                    aria-label={`Помещение, строка ${index + 1}`}
                    value={row.number}
                    onChange={(event) => setFlats(replaceAt(flats, index, { ...row, number: event.target.value }))}
                  />
                  <input
                    className="rows-cell"
                    inputMode="numeric"
                    aria-label={`Подъезд, строка ${index + 1}`}
                    value={row.entrance}
                    onChange={(event) => setFlats(replaceAt(flats, index, { ...row, entrance: event.target.value }))}
                  />
                  <input
                    className="rows-cell"
                    inputMode="numeric"
                    aria-label={`Стояк, строка ${index + 1}`}
                    value={row.riser}
                    onChange={(event) => setFlats(replaceAt(flats, index, { ...row, riser: event.target.value }))}
                  />
                  <input
                    className="rows-cell"
                    inputMode="decimal"
                    aria-label={`Площадь, строка ${index + 1}`}
                    value={row.area}
                    onChange={(event) => setFlats(replaceAt(flats, index, { ...row, area: event.target.value }))}
                  />
                  <input
                    className="rows-cell"
                    inputMode="numeric"
                    aria-label={`Жильцов, строка ${index + 1}`}
                    value={row.people}
                    onChange={(event) => setFlats(replaceAt(flats, index, { ...row, people: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="rows-drop"
                    aria-label={`Убрать строку ${index + 1}`}
                    onClick={() => setFlats(flats.filter((_row, at) => at !== index))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </Rows>
          ) : null}

          <div className="row-links">
            <button type="button" className="link" onClick={() => setFlats([...flats, { ...EMPTY_FLAT }])}>
              Добавить квартиру
            </button>

            <Paste
              label="Вставить список квартир"
              hint={`${FLAT_HEADER}\n1;1;1;54,3;2`}
              onPaste={(text) => setFlats([...flats, ...parseFlats(text)])}
            />
          </div>
        </div>

        {flats.some((row) => row.number.trim().length > 0) ? (
          <CellAction
            mode="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const imported = await api.importApartments(flatsToText(flats));

                setResult(imported);
                setFlats([]);

                return `Заведено ${imported.added}, обновлено ${imported.updated}, приборов ${imported.meters}`;
              })
            }
          >
            {busy ? 'Заводим…' : 'Завести квартиры'}
          </CellAction>
        ) : null}
      </Group>

      <Group title="Оборудование">
        <div className="rows-box">
          {units.length === 0 ? (
            <p className="hint rows-about">Лифты, домофоны и узлы учёта: по ним идут осмотры и наклейки</p>
          ) : null}

          {units.length > 0 ? (
            <Rows columns={UNIT_COLUMNS}>
              {units.map((row, index) => (
                <div key={index} className="rows-line rows-line-unit">
                  <input
                    className="rows-cell"
                    aria-label={`Код, строка ${index + 1}`}
                    value={row.code}
                    onChange={(event) => setUnits(replaceAt(units, index, { ...row, code: event.target.value }))}
                  />
                  <input
                    className="rows-cell rows-wide"
                    aria-label={`Название, строка ${index + 1}`}
                    value={row.title}
                    onChange={(event) => setUnits(replaceAt(units, index, { ...row, title: event.target.value }))}
                  />
                  <input
                    className="rows-cell"
                    aria-label={`Вид, строка ${index + 1}`}
                    value={row.kind}
                    placeholder="лифт"
                    onChange={(event) => setUnits(replaceAt(units, index, { ...row, kind: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="rows-drop"
                    aria-label={`Убрать строку ${index + 1}`}
                    onClick={() => setUnits(units.filter((_row, at) => at !== index))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </Rows>
          ) : null}

          <div className="row-links">
            <button type="button" className="link" onClick={() => setUnits([...units, { ...EMPTY_UNIT }])}>
              Добавить оборудование
            </button>

            <Paste
              label="Вставить список оборудования"
              hint={`${UNIT_HEADER}\nlift-1;Лифт, подъезд 1;лифт`}
              onPaste={(text) => setUnits([...units, ...parseUnits(text)])}
            />
          </div>
        </div>

        {units.some((row) => row.code.trim().length > 0 && row.title.trim().length > 0) ? (
          <CellAction
            mode="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const imported = await api.importEquipment(unitsToText(units));

                setResult({ added: imported.added, updated: 0, meters: 0, problems: imported.problems });
                setUnits([]);

                return `Заведено оборудования: ${imported.added}`;
              })
            }
          >
            {busy ? 'Заводим…' : 'Завести оборудование'}
          </CellAction>
        ) : null}
      </Group>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {done ? (
        <p className="hint" role="status">
          {done}
        </p>
      ) : null}

      <HandOver api={api} onDone={(message) => setDone(message)} />

      {result && result.problems.length > 0 ? (
        <Group title="Не разобрали">
          {result.problems.map((problem, index) => (
            <CellSimple
              key={`${problem.line}-${problem.message}`}
              title={`Строка ${problem.line}`}
              subtitle={problem.message}
              height="compact"
              separator={index > 0}
            />
          ))}
        </Group>
      ) : null}
    </section>
  );
};

/**
 * Передача дома другой управляющей организации. Дом остаётся со своим чатом,
 * заявками и показаниями, меняются организация и её люди, поэтому действие
 * спрашивается отдельно.
 */
const HandOver = ({ api, onDone }: { api: DomovoyApi; onDone: (message: string) => void }) => {
  const people = useBridgeRequest(() => api.people().catch(() => []), [api]);
  const [company, setCompany] = useState('');
  const [managerId, setManagerId] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = Array.isArray(people.data) ? people.data : [];
  const ready = company.trim().length > 0 && managerId !== '';
  const missing =
    company.trim().length === 0 && managerId === ''
      ? 'Назовите организацию и выберите управляющего'
      : company.trim().length === 0
        ? 'Назовите организацию'
        : 'Выберите управляющего';

  const hand = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const result = await api.handOverBuilding({ company: company.trim(), managerId });

      setAsking(false);
      setCompany('');
      setManagerId('');
      onDone(
        `Дом передан: ${result.company}. Управляющий ${result.managerName}, ` +
          `сотрудников отвязано ${result.released}, жильцов уведомлено ${result.notified}.`,
      );
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Дом не передан');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Смена управляющей организации">
      <CellInput
        className="field-row"
        id="handover-company"
        aria-label="Новая организация"
        placeholder="Название организации"
        before={<span className="cell-label">Кому</span>}
        value={company}
        onChange={(event) => setCompany(event.target.value)}
      />

      <div className="field-row">
        <label className="cell-label" htmlFor="handover-manager">
          Управляющий
        </label>
        <select
          id="handover-manager"
          value={managerId}
          onChange={(event) => setManagerId(event.target.value)}
        >
          <option value="">Выберите человека</option>
          {candidates.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
        </select>
      </div>

      <CellAction mode="destructive" disabled={busy} onClick={() => (ready ? setAsking(true) : setError(missing))}>
        Передать дом
      </CellAction>

      {error ? <ErrorText className="inset">{error}</ErrorText> : null}

      {asking ? (
        <Confirm
          title="Передать дом другой организации?"
          text={`Сотрудники вашей организации потеряют доступ к дому, жильцы получат сообщение. Чат дома, заявки и показания останутся.`}
          confirmLabel="Передать"
          busyLabel="Передаём…"
          busy={busy}
          danger
          onConfirm={() => void hand()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </Group>
  );
};
