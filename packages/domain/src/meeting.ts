import { DomainError } from './types.js';

/**
 * Общее собрание собственников в заочной форме с использованием системы.
 * Сроки заданы ст. 47.1 ЖК РФ, и продукт считает их сам: сообщение о собрании,
 * длительность голосования и передачу протокола в надзор.
 */

/** За сколько дней до начала голосования сообщение передаётся администратору. */
export const NOTICE_TO_ADMIN_DAYS = 14;

/** За сколько дней до начала администратор размещает сообщение и рассылает его. */
export const NOTICE_TO_OWNERS_DAYS = 10;

/** Голосование идёт не меньше семи дней. */
export const VOTING_MIN_DAYS = 7;

/** И не дольше шестидесяти. */
export const VOTING_MAX_DAYS = 60;

/** Письменные решения принимаются не позже чем за двое суток до конца голосования. */
export const PAPER_CUTOFF_HOURS = 48;

/** Решения и протокол размещаются в системе в течение суток. */
export const PUBLISH_HOURS = 24;

/** Подлинники решений и протокола инициатор передаёт в управляющую организацию. */
export const PROTOCOL_TO_MANAGEMENT_DAYS = 10;

/** Оттуда они уходят в орган жилищного надзора. */
export const PROTOCOL_TO_INSPECTION_DAYS = 5;

/** Сколько надзор хранит подлинники. */
export const PROTOCOL_STORAGE_YEARS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MeetingSchedule {
  /** Когда сообщение о собрании должно быть размещено и разослано. */
  noticeBy: Date;
  /** До какого момента сообщение передаётся администратору системы. */
  noticeToAdminBy: Date;
  votingFrom: Date;
  votingTo: Date;
  /** До какого момента администратор принимает письменные решения. */
  paperBy: Date;
  /** До какого момента протокол размещается в системе. */
  protocolBy: Date;
  /** До какого момента подлинники уходят в управляющую организацию. */
  toManagementBy: Date;
  /** До какого момента управляющая организация передаёт их в надзор. */
  toInspectionBy: Date;
  /** До какого момента надзор хранит подлинники. */
  storageUntil: Date;
}

export interface MeetingScheduleInput {
  /** Когда объявляют собрание. */
  announcedAt: Date;
  /** Сколько дней идёт голосование. */
  days: number;
}

/** Расписание собрания по срокам закона. @throws {DomainError} если срок не тот */
export const meetingSchedule = ({ announcedAt, days }: MeetingScheduleInput): MeetingSchedule => {
  if (!Number.isInteger(days) || days < VOTING_MIN_DAYS || days > VOTING_MAX_DAYS) {
    throw new DomainError(
      'poll_period_invalid',
      `Голосование на собрании идёт от ${VOTING_MIN_DAYS} до ${VOTING_MAX_DAYS} дней`,
    );
  }

  const votingFrom = new Date(announcedAt.getTime() + NOTICE_TO_OWNERS_DAYS * DAY_MS);
  const votingTo = new Date(votingFrom.getTime() + days * DAY_MS);
  const protocolBy = new Date(votingTo.getTime() + PUBLISH_HOURS * 60 * 60 * 1000);
  const storageUntil = new Date(votingTo.getTime());

  storageUntil.setUTCFullYear(storageUntil.getUTCFullYear() + PROTOCOL_STORAGE_YEARS);

  return {
    noticeBy: announcedAt,
    noticeToAdminBy: new Date(votingFrom.getTime() - NOTICE_TO_ADMIN_DAYS * DAY_MS),
    votingFrom,
    votingTo,
    paperBy: new Date(votingTo.getTime() - PAPER_CUTOFF_HOURS * 60 * 60 * 1000),
    protocolBy,
    toManagementBy: new Date(votingTo.getTime() + PROTOCOL_TO_MANAGEMENT_DAYS * DAY_MS),
    toInspectionBy: new Date(votingTo.getTime() + (PROTOCOL_TO_MANAGEMENT_DAYS + PROTOCOL_TO_INSPECTION_DAYS) * DAY_MS),
    storageUntil,
  };
};
