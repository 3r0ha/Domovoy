/** Значки разделов. Цвет наследуется от кнопки. */
const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Заявки: лист с галочкой. */
export const IconRequests = () => (
  <svg {...base}>
    <path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    <path d="M14.5 3.7V8h4.3" />
    <path d="m8.5 14 2.2 2.2 4.3-4.4" />
  </svg>
);

/** Очередь дома: стопка строк. */
export const IconQueue = () => (
  <svg {...base}>
    <path d="M4 6.5h16M4 12h16M4 17.5h10" />
    <circle cx="19" cy="17.5" r="2.2" />
  </svg>
);

/** Счётчики: круглая шкала со стрелкой. */
export const IconMeters = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 12 15.5 8.8" />
    <path d="M12 3.5v1.8M20.5 12h-1.8M12 20.5v-1.8M3.5 12h1.8" />
  </svg>
);

/** Объявления: рупор. */
export const IconNews = () => (
  <svg {...base}>
    <path d="M4 10v4a1 1 0 0 0 1 1h2.4l5.6 3.5V5.5L7.4 9H5a1 1 0 0 0-1 1Z" />
    <path d="M17 9.2a4 4 0 0 1 0 5.6" />
    <path d="M19.6 6.8a7.5 7.5 0 0 1 0 10.4" />
  </svg>
);

/** Собрания: доли в круге. */
export const IconPolls = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v8.5h8.5" />
  </svg>
);

/** Приём: лист календаря. */
export const IconCalendar = () => (
  <svg {...base}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
  </svg>
);

/** Сводка: столбики. */
export const IconReport = () => (
  <svg {...base}>
    <path d="M4 20h16" />
    <path d="M7 20v-6M12 20V6M17 20v-9" />
  </svg>
);

/** Люди дома: двое рядом. */
export const IconPeople = () => (
  <svg {...base}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.8 19.5c0-3 2.6-4.8 5.7-4.8s5.7 1.8 5.7 4.8" />
    <path d="M16.5 6.6a3 3 0 0 1 0 5.6" />
    <path d="M17.6 15.2c1.7.5 2.9 1.8 2.9 3.6" />
  </svg>
);

/** Квартира: дом с дверью. */
export const IconHome = () => (
  <svg {...base}>
    <path d="m4 10.5 8-6 8 6V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.5Z" />
    <path d="M10 20v-5h4v5" />
  </svg>
);

/** Звезда оценки: пустая контуром, выбранная залитая. */
export const IconStar = ({ filled }: { filled: boolean }) => (
  <svg {...base} width={26} height={26} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8L12 3.6Z" />
  </svg>
);

/** Сканирование: уголки видоискателя вокруг наклейки. */
export const IconScan = () => (
  <svg {...base} width={20} height={20}>
    <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
    <path d="M8 12h8" />
  </svg>
);

/** Голос: микрофон на подставке. */
export const IconMic = () => (
  <svg {...base} width={20} height={20}>
    <rect x="9" y="3" width="6" height="10.5" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3" />
  </svg>
);

/** Снимок: камера. */
export const IconCamera = () => (
  <svg {...base} width={20} height={20}>
    <path d="M3.5 8.5h3l1.4-2h7.2l1.4 2h3v9a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-9Z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
);

/** Отказ: восклицательный знак в круге. */
export const IconWarning = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.8v5" />
    <circle cx="12" cy="16.1" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** Подсказка: круг с вопросом. */
export const IconHelp = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.2 2.6c-.6.2-.9.7-.9 1.3v.5" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlus = () => (
  <svg {...base}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);

/** Ещё: три точки, как везде. */
export const IconMore = () => (
  <svg {...base}>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

/** Тариф: рубль. */
export const IconRuble = () => (
  <svg {...base}>
    <path d="M9 20V5h4.2a3.9 3.9 0 0 1 0 7.8H9" />
    <path d="M7 12.8h6M7 16.4h6" />
  </svg>
);

/** Дома компании: два корпуса рядом. */
export const IconBuildings = () => (
  <svg {...base}>
    <path d="M4 20.5V9l5-3v14.5" />
    <path d="M9 20.5V11l6-2.5v12" />
    <path d="M15 20.5V12l5 2v6.5" />
    <path d="M2.5 20.5h19" />
  </svg>
);

/** Справка: лист с загнутым углом. */
export const IconDocument = () => (
  <svg {...base}>
    <path d="M7 3.5h6.5L18 8v12.5H7z" />
    <path d="M13.5 3.5V8H18" />
    <path d="M10 12.5h5M10 16h5" />
  </svg>
);

/** Профиль: силуэт человека. */
export const IconPerson = () => (
  <svg {...base}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
  </svg>
);

/** Дверь с ключом: домофон и шлагбаум. */
export const IconKey = () => (
  <svg {...base}>
    <circle cx="8.5" cy="15.5" r="3.5" />
    <path d="M11 13 19.5 4.5" />
    <path d="M17 7l2.2 2.2M14.6 9.4l2.2 2.2" />
  </svg>
);

/** Обновление: стрелка по кругу. */
export const IconRefresh = () => (
  <svg {...base}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" />
    <path d="M19.8 4.4v4.3h-4.3" />
  </svg>
);

/** Лифт: кабина со стрелками хода. */
export const IconElevator = () => (
  <svg {...base}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M12 3.5v17" />
    <path d="m8.2 11 0-3.4M6.7 9.1 8.2 7.6 9.7 9.1" />
    <path d="m15.8 13 0 3.4M14.3 14.9l1.5 1.5 1.5-1.5" />
  </svg>
);

/** Водоснабжение: капля. */
export const IconWater = () => (
  <svg {...base}>
    <path d="M12 3.2c3.4 4 5.6 6.7 5.6 9.4a5.6 5.6 0 1 1-11.2 0c0-2.7 2.2-5.4 5.6-9.4Z" />
  </svg>
);

/** Отопление: батарея. */
export const IconHeating = () => (
  <svg {...base}>
    <path d="M5.5 6.5v11M9.8 6.5v11M14.2 6.5v11M18.5 6.5v11" />
    <path d="M3.5 9.5h17M3.5 14.5h17" />
  </svg>
);

/** Электричество: молния. */
export const IconPower = () => (
  <svg {...base}>
    <path d="M13.2 2.8 5.5 13.4h5.5l-.8 7.8 7.8-10.6h-5.6l.8-7.8Z" />
  </svg>
);

/** Уборка: щётка. */
export const IconCleaning = () => (
  <svg {...base}>
    <path d="M9.2 13.5 15 4.3a2.2 2.2 0 0 1 3.7 2.3l-5.8 9.2" />
    <path d="M6.5 12.6 11.6 15.8" />
    <path d="M6.5 12.6 4.2 19.4a1 1 0 0 0 1.4 1.2l6-3.9" />
  </svg>
);

/** Двор: дерево. */
export const IconYard = () => (
  <svg {...base}>
    <path d="M12 21v-5.5" />
    <path d="M12 15.5a5 5 0 0 0 1.6-9.7 4 4 0 0 0-7.3 1.7A3.6 3.6 0 0 0 7 14.6" />
    <path d="M12 15.5a4 4 0 0 1 3.6-4" />
  </svg>
);

/** В порядке: галочка. */
export const IconCheck = () => (
  <svg {...base}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

/** Переслать: стрелка из коробки. */
export const IconShare = () => (
  <svg {...base}>
    <path d="M12 3.5v11" />
    <path d="m8.4 7.1 3.6-3.6 3.6 3.6" />
    <path d="M6 12.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1h-1" />
  </svg>
);

/** Рассылка: бумажный самолётик. */
export const IconSend = () => (
  <svg {...base}>
    <path d="M21 3 10.5 13.5" />
    <path d="M21 3 14.5 21l-4-7.5L3 9.5Z" />
  </svg>
);

/** Разговор: облако реплики. */
export const IconChat = () => (
  <svg {...base}>
    <path d="M20 13.5a6.5 6.5 0 0 1-6.5 6.5H8l-4 3 1.2-4A6.5 6.5 0 0 1 4 13.5v-1A6.5 6.5 0 0 1 10.5 6h3A6.5 6.5 0 0 1 20 12.5Z" />
  </svg>
);

/** Наклейка: код с уголками-искателями. */
export const IconSticker = () => (
  <svg {...base}>
    <rect x="4" y="4" width="6" height="6" rx="1.5" />
    <rect x="14" y="4" width="6" height="6" rx="1.5" />
    <rect x="4" y="14" width="6" height="6" rx="1.5" />
    <path d="M14 14h2.5M20 14v2.5M14 20h6M17 17h3" />
  </svg>
);

/** Домофон и прочее: гаечный ключ. */
export const IconWrench = () => (
  <svg {...base}>
    <path d="M15.6 3.6a5 5 0 0 0-6 6.4L4 15.6a2 2 0 0 0 2.8 2.8l5.6-5.6a5 5 0 0 0 6.4-6l-3 3-2.6-2.6 2.4-3.6Z" />
  </svg>
);

/** Капитальный ремонт: кирпичная кладка. */
export const IconRepair = () => (
  <svg {...base}>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    <path d="M3.5 9.7h17M3.5 14.3h17" />
    <path d="M9 5v4.7M15 9.7v4.6M9 14.3V19" />
  </svg>
);
