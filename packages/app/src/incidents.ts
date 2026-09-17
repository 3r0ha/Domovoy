/**
 * Происшествие в доме от обращения до закрытия: подача и склейка, соседи,
 * паспорт объекта, вложения, жилищная инспекция, напоминания.
 */

export { describeFromAttachments, unheardVoice, type Transcriber } from './incidents/attachments.js';
export { escalationFor, type EscalationOffer } from './incidents/escalation.js';
export {
  answerAlert,
  canKnockUpstairs,
  knockUpstairs,
  surveyOf,
  type AlertAnswer,
  type AlertAnswerResult,
  type KnockCommand,
  type SurveyedApartment,
} from './incidents/neighbours.js';
export { assessQueue, objectPassport, type ObjectPassport, type RequestWithRisk } from './incidents/passport.js';
export {
  closeAcceptedBySilence,
  remindAboutAcceptance,
  remindAboutOverdue,
  remindAboutWorks,
  warnAboutDeadlines,
} from './incidents/reminders.js';
export {
  asRequest,
  JOIN_LOCK_PREFIX,
  REQUESTS_PER_HOUR,
  SAME_REQUEST_WINDOW_MS,
  submitProblem,
  type SubmitResult,
  type SubmittedRequest,
} from './incidents/submit.js';
