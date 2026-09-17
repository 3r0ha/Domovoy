import { CellAction, CellInput, CellSimple, Textarea } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, type BuildingView, type DomovoyApi, type ImportResultView } from '../api.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconNews } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface ImportScreenProps {
  api: DomovoyApi;
}

const FLATS = [
  'Помещение;Подъезд;Стояк;Площадь;Жильцов;ХВС;ГВС;Электричество',
  '1;1;1;54,3;2;ХВС-001;ГВС-001;ЭЛ-001',
].join('\n');

const EQUIPMENT = ['Код;Название;Вид', 'lift-1;Лифт, подъезд 1;лифт'].join('\n');

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

/** Дом заводится списком квартир из выгрузки. */
export const ImportScreen = ({ api }: ImportScreenProps) => {
  const house = useBridgeRequest(() => api.selectedBuilding(), [api]);
  const [edited, setEdited] = useState<HouseCard | null>(null);
  const card = edited ?? cardOf(house.data);
  const setCard = setEdited;
  const [chat, setChat] = useState<BuildingView | null>(null);
  const bound = (chat ?? house.data)?.chatBound === true;
  const [flats, setFlats] = useState('');
  const [equipment, setEquipment] = useState('');
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
          before={<span className="cell-label">Пояс</span>}
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

      <Group>
        <CellAction
          mode="primary"
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
          Сохранить
        </CellAction>
      </Group>

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
        <div className="paste">
          <Textarea
            mode="secondary"
            id="import-flats"
            aria-label="Квартиры"
            rows={5}
            value={flats}
            placeholder={FLATS}
            onChange={(event) => setFlats(event.target.value)}
          />
        </div>

        {flats.trim().length === 0 ? null : (
          <CellAction
            mode="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const imported = await api.importApartments(flats);

                setResult(imported);
                setFlats('');

                return `Заведено ${imported.added}, обновлено ${imported.updated}, приборов ${imported.meters}`;
              })
            }
          >
            {busy ? 'Заводим…' : 'Завести квартиры'}
          </CellAction>
        )}
      </Group>

      <Group title="Оборудование">
        <div className="paste">
          <Textarea
            mode="secondary"
            id="import-equipment"
            aria-label="Оборудование"
            rows={4}
            value={equipment}
            placeholder={EQUIPMENT}
            onChange={(event) => setEquipment(event.target.value)}
          />
        </div>

        {equipment.trim().length === 0 ? null : (
          <CellAction
            mode="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const imported = await api.importEquipment(equipment);

                setResult({ added: imported.added, updated: 0, meters: 0, problems: imported.problems });
                setEquipment('');

                return `Заведено оборудования: ${imported.added}`;
              })
            }
          >
            {busy ? 'Заводим…' : 'Завести оборудование'}
          </CellAction>
        )}
      </Group>

      <p className="hint aside">Таблицу можно вставить из Excel</p>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {done ? (
        <p className="hint" role="status">
          {done}
        </p>
      ) : null}

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
