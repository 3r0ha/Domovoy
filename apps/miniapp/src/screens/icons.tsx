import {
  ArrowClockwise,
  Broom,
  Buildings,
  CalendarBlank,
  Camera,
  ChartBar,
  ChartPieSlice,
  ChatCircle,
  Check,
  ClipboardText,
  CurrencyRub,
  DotsThree,
  Drop,
  Elevator,
  Export,
  FileText,
  Gauge,
  Globe,
  Hammer,
  House,
  Key,
  Lightning,
  Megaphone,
  Microphone,
  PaperPlaneRight,
  Plus,
  QrCode,
  Question,
  Receipt,
  Scan,
  Star,
  Thermometer,
  Tray,
  Tree,
  User,
  UsersThree,
  WarningCircle,
  Wrench,
  type Icon,
  type IconWeight,
} from '@phosphor-icons/react';

/** Выбранная вкладка рисуется залитой. */
export interface IconProps {
  filled?: boolean;
}

/** Значки разделов. Цвет наследуется от кнопки. */
const icon =
  (Glyph: Icon, size = 24, active: IconWeight = 'fill') =>
  ({ filled }: IconProps = {}) => <Glyph size={size} weight={filled ? active : 'regular'} aria-hidden />;

export const IconRequests = icon(ClipboardText);
export const IconQueue = icon(Tray);
export const IconMeters = icon(Gauge);
export const IconPayment = icon(Receipt);
export const IconNews = icon(Megaphone);
export const IconPolls = icon(ChartPieSlice);
export const IconCalendar = icon(CalendarBlank);
export const IconReport = icon(ChartBar);
export const IconPeople = icon(UsersThree);
export const IconHome = icon(House);
export const IconStar = icon(Star, 26);
export const IconScan = icon(Scan, 20);
export const IconMic = icon(Microphone, 20);
export const IconCamera = icon(Camera, 20);
export const IconWarning = icon(WarningCircle);
export const IconHelp = icon(Question);
export const IconGlobe = icon(Globe);
export const IconPlus = icon(Plus);
/** Залитые три точки становятся сплошной плашкой. */
export const IconMore = icon(DotsThree, 24, 'bold');
export const IconRuble = icon(CurrencyRub);
export const IconBuildings = icon(Buildings);
export const IconDocument = icon(FileText);
export const IconPerson = icon(User);
export const IconKey = icon(Key);
export const IconRefresh = icon(ArrowClockwise);
export const IconElevator = icon(Elevator);
export const IconWater = icon(Drop);
export const IconHeating = icon(Thermometer);
export const IconPower = icon(Lightning);
export const IconCleaning = icon(Broom);
export const IconYard = icon(Tree);
export const IconCheck = icon(Check);
export const IconShare = icon(Export);
export const IconSend = icon(PaperPlaneRight);
export const IconChat = icon(ChatCircle);
export const IconSticker = icon(QrCode);
export const IconWrench = icon(Wrench);
export const IconRepair = icon(Hammer);
