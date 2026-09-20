import type { Dictionary } from '../../translate.js';

/** Строки, которые продукт показывает человеку. Ключ не переводится, переводится значение. */
export const app: Dictionary = {
  'status.new': 'new',
  'status.accepted': 'accepted for work',
  'status.in_progress': 'in progress',
  'status.needs_info': 'awaiting the resident reply',
  'status.done': 'completed, awaiting acceptance',
  'status.confirmed': 'closed, work accepted',
  'status.rejected': 'rejected',
  'status.withdrawn': 'withdrawn by the resident',

  'category.elevator': 'Lift',
  'category.plumbing': 'Water supply and drainage',
  'category.heating': 'Heating',
  'category.electricity': 'Electricity',
  'category.cleaning': 'Cleaning',
  'category.yard': 'Yard and grounds',
  'category.safety': 'Safety',
  'category.document': 'Certificates and documents',
  'category.other': 'Other',

  'categoryShort.elevator': 'Lift',
  'categoryShort.plumbing': 'Water',
  'categoryShort.heating': 'Heat',
  'categoryShort.electricity': 'Power',
  'categoryShort.cleaning': 'Cleaning',
  'categoryShort.yard': 'Yard',
  'categoryShort.safety': 'Safety',
  'categoryShort.document': 'Certificates',
  'categoryShort.other': 'Other',

  'meter.cold_water': 'Cold water',
  'meter.hot_water': 'Hot water',
  'meter.electricity': 'Electricity',
  'meter.heating': 'Heating',
  'meter.gas': 'Gas',

  'meterUnit.cold_water': 'm³',
  'meterUnit.hot_water': 'm³',
  'meterUnit.electricity': 'kWh',
  'meterUnit.heating': 'Gcal',
  'meterUnit.gas': 'm³',

  'basis.meter': 'by meter',
  'basis.average': 'by average',
  'basis.norm': 'by consumption norm',

  'noticeKind.meters': 'Meter readings',
  'noticeKind.works': 'Planned works',
  'noticeKind.polls': 'Owners meetings',
  'noticeKind.news': 'House announcements',

  'charge.maintenance': 'Maintenance and current repairs',
  'charge.common': '{ресурс} for common house needs',
  'charge.recalculation': 'Recalculation: {ресурс} was off longer than allowed',

  'chargeDetail.rate': '{расход} {единица} × {тариф} ₽',
  'chargeDetail.area': '{площадь} m² × {тариф} ₽',
  'chargeDetail.recalculation': '{часы} h over the norm × 0.15% × {сумма} ₽',
  'chargeDetail.basis': '{расчёт} · {основание}',

  'month.1': 'January',
  'month.2': 'February',
  'month.3': 'March',
  'month.4': 'April',
  'month.5': 'May',
  'month.6': 'June',
  'month.7': 'July',
  'month.8': 'August',
  'month.9': 'September',
  'month.10': 'October',
  'month.11': 'November',
  'month.12': 'December',

  'monthOf.1': 'January',
  'monthOf.2': 'February',
  'monthOf.3': 'March',
  'monthOf.4': 'April',
  'monthOf.5': 'May',
  'monthOf.6': 'June',
  'monthOf.7': 'July',
  'monthOf.8': 'August',
  'monthOf.9': 'September',
  'monthOf.10': 'October',
  'monthOf.11': 'November',
  'monthOf.12': 'December',

  'error.forbidden': 'This data belongs to someone else, it cannot be opened',
  'error.request_not_found': 'Request not found',
  'error.request_closed': 'The request is already closed',
  'error.transition_not_allowed': 'The request state does not change this way',
  'error.too_many_requests': 'Too many requests within an hour. We will continue next hour',
  'error.apartment_not_bound':
    'This concerns a property, first link your apartment with the code from the bill',
  'error.apartment_required': 'First link your apartment with the code from the bill',
  'error.code_not_apartment': 'This code is not an apartment code',
  'error.code_not_valid': 'The code does not fit or is no longer valid',
  'error.code_not_found': 'You have no such code',
  'error.meter_not_found': 'Meter not found',
  'error.reading_invalid': 'The reading must be a number not less than zero',
  'error.reading_decreased': 'A meter cannot show less than before',
  'error.reading_too_large': 'The value does not fit on the meter display',
  'error.reading_duplicate': 'A reading for this billing period has already been submitted',
  'error.meter_not_verified': 'The meter verification period has expired, readings cannot be accepted',
  'error.meter_not_in_photo': 'The meter display is not visible in the photo',
  'error.nothing_to_pay': 'Nothing to pay: everything is settled',
  'error.payments_unavailable': 'Payment is unavailable right now, try later',
  'error.devices_unavailable': 'The smart home is unavailable right now',
  'error.device_not_found': 'Device not found',
  'error.device_not_openable': 'This device does not open',
  'error.device_not_viewable': 'This device has no camera',
  'error.visit_not_found': 'Appointment not found',
  'error.visit_exists': 'You already have an appointment',
  'error.slot_taken': 'This time is already taken, choose another one',
  'error.reception_empty': 'The management organisation does not hold appointments',
  'error.ticket_not_found': 'Enquiry not found',
  'error.ticket_closed': 'The enquiry is closed, ask your question again',
  'error.poll_not_found': 'Vote not found',
  'error.poll_closed': 'The results are counted, the vote cannot be accepted',
  'error.poll_open': 'The meeting is still running, the minutes are drawn up on its results',
  'error.already_knocked': 'The neighbour upstairs has already been knocked for',
  'error.no_upstairs': 'There are no neighbours above this apartment',
  'error.upstairs_unknown': 'The neighbour upstairs is not in the app yet, they cannot be called from here',
  'error.complaint_exists': 'A complaint on this request has already been sent',
  'error.text_empty': 'Write in words what happened',
  'error.message_empty': 'The message is empty',
  'error.language_unknown': 'I do not have such a language',

  'lang.ask': 'Choose your language',
  'error.initiative_not_found': 'The proposal was not found',
  'error.initiative_closed': 'A meeting on this proposal has already been called',
  'error.initiative_exists': 'Your proposal is already collecting signatures',

  'notice.status': 'Request {номер} {состояние}.\n{суть}\n{место}.',
  'notice.statusOf.accepted': 'accepted for work',
  'notice.statusOf.in_progress': 'in progress',
  'notice.statusOf.needs_info': 'awaits your clarification',
  'notice.statusOf.done': 'completed, awaits your acceptance',
  'notice.statusOf.confirmed': 'closed, work accepted',
  'notice.statusOf.rejected': 'rejected',
  'notice.statusOf.withdrawn': 'withdrawn',
  'notice.message': 'Request {номер}. {автор} writes:\n{текст}',
  'notice.author.company': 'Management company',
  'notice.author.resident': 'Resident',
  'notice.author.neighbour': 'Neighbour',
  'notice.attachments.one': 'sent {сколько} attachment',
  'notice.attachments.few': 'sent {сколько} attachments',
  'notice.attachments.many': 'sent {сколько} attachments',
  'notice.broadcast': 'Message from the management company{дом}',
  'notice.guestEntry': 'The guest code was used: {устройство}, {время}',
  'notice.guestDoor': 'door',
  'notice.neighbourQuestion':
    'A neighbour on your riser reports: {суть}.\nRequest {номер} is in progress.\nIs it the same for you?',
  'notice.knock':
    'Domovoy is knocking: the neighbour below has {суть}.\n' +
    'Check whether anything is leaking at your place. If it is, shut off the water and press the button below, the request is already open.',
  'notice.neighbourAlert':
    'Emergency: {категория}, {место}.\nRequest {номер} is in progress, due by {срок}.\n' +
    'I will write about changes myself. Is it the same for you?',
  'notice.overdue': 'Request {номер}: {что}.\n{место}.\n{дальше}',
  'notice.overdueOf.reaction': 'the request has still not been accepted for work',
  'notice.overdueOf.resolution': 'the work was not done by the promised deadline',
  'notice.overdueEscalate': 'There are grounds to apply to the housing inspectorate.',
  'notice.overdueWait': 'We will report the changes.',
  'notice.worksSoon': 'Planned works tomorrow: {категория}.\n{адресаты}, {до}.\n{название}.',
  'notice.worksStarted':
    'Planned works have started: {категория}.\n{название}: {адресаты}.\nWe plan to finish by {до}.',
  'notice.worksFinished':
    'Planned works are completed on schedule: {название}, {адресаты}.\n' +
    'If the problem remains, write to me and I will open a request.',
  'notice.acceptance':
    'Request {номер}: the work is marked as completed.\n{место}.\n' +
    'If everything is fine, nothing needs to be done, in {часы} the request closes by itself.\n' +
    'If the problem remains, return it to work and the technician will come again.',
  'notice.autoConfirmed':
    'Request {номер} is closed: no objections were received within {часы}.\n{место}.\n' +
    'If the problem remains, create a new request, the previous one stays in the object history.',
  'notice.staffRequest':
    'The management company has opened a request for your apartment: {суть}.\n{номер}, due by {срок}.',
  'notice.complaintSent':
    'The complaint is sent: {организация}.{номер}\nThe reply arrives within 30 days.',
  'notice.complaintNumber': '\nNumber {номер}.',
  'notice.debt': '{долг}\n\nYou can pay with the button below.',

  'hours.one': '{сколько} hour',
  'hours.few': '{сколько} hours',
  'hours.many': '{сколько} hours',
  'days.one': '{сколько} day',
  'days.few': '{сколько} days',
  'days.many': '{сколько} days',
  'days.left.one': '{сколько} day left',
  'days.left.few': '{сколько} days left',
  'days.left.many': '{сколько} days left',
  'months.one': '{сколько} month',
  'months.few': '{сколько} months',
  'months.many': '{сколько} months',

  'answer.houseNow': 'In the house right now:\n{строки}',
  'answer.houseWork': '{название}: {до}.',
  'answer.houseIncident': '{название}: request {номер}, due {срок}.',
  'answer.houseShared':
    'No emergencies or works are announced in the house, but there are already requests on it:\n{строки}',
  'answer.houseSharedLine': '{название}: request {номер}, {состояние}.',
  'answer.houseAhead': 'Nothing is switched off in the house now. Next: {событие}, {когда}.',
  'answer.houseQuiet': 'Nothing is switched off in the house and there are no emergencies.',
  'answer.billEmpty': 'There are no charges for this month yet.',
  'answer.billLeft': '{сумма} to pay by the {число}th.',
  'answer.billPaid': 'Everything is paid for this month.',
  'answer.requestsEmpty': 'You have no open requests.',
  'answer.requests': 'Your requests:\n{строки}',
  'answer.requestLine': '{номер}: {состояние}, due {срок}.',
  'answer.requestWaiting': 'awaits your acceptance',
  'answer.requestWorking': 'in progress',
  'answer.requestNew': 'new',

  'meters.remind':
    'Time to submit the meter readings, {осталось}:\n{приборы}\nPress the button below and send the figures from the meter.',
  'meters.expired':
    'The verification has expired: {приборы}.\nUntil the new verification, charges go by the consumption norm.',
  'meters.name': '{прибор} ({номер})',
  'meters.spike':
    'Consumption on the meter "{прибор}" for the period: {расход} {единица}, noticeably more than usual.\n' +
    'If you did not use more than usual, check the taps and the cistern.',
  'meters.aboveNeighbours':
    'Consumption on meter {номер} is higher than the neighbours: {расход} {единица} against {соседи} {единица} in similar apartments.\n' +
    'Worth checking: most often it is a leaking cistern or mixer tap.',

  'debt.total': 'Unpaid {сумма}:\n{строки}',
  'debt.line': '  {период}: {сумма}',
  'debt.linePenalty': '  {период}: {сумма} and penalty {пени}',
  'debt.penalty': '\n\nLate payment penalty: {пени}\nTotal to pay: {итого}',
  'debt.short': 'Old debt for {месяцы}: {сумма}',
  'debt.shortPenalty': 'Old debt for {месяцы}: {сумма}, late payment penalty {пени}',
  'debt.range': 'from {от} to {до}',
  'debt.period': '{месяц} {год}',

  'support.answered': '{сотрудник}, management company, answers the question "{тема}":\n{текст}',
  'support.waiting': 'Awaits the reply of the management company.',
  'support.earlier': 'Earlier there are {сколько} more, in full in the app.',
  'support.you': 'You',
  'support.company': 'Management company',
  'support.resident': 'Resident',

  'poll.meeting': 'Owners meeting',
  'poll.survey': 'Resident survey',
  'poll.started': '{вид}: {название}\n\n{вопрос}\n\n{порядок}',
  'poll.orderMeeting': '{правило}. Voting runs from {от} to {до}.',
  'poll.orderSurvey': 'You can answer until {до}. A survey does not replace an owners meeting.',
  'poll.remind': 'The meeting "{название}" closes {до}.\n{нехватка}',
  'poll.remindFew': 'Not everyone has voted: while there are few votes, no decision is taken.',
  'poll.remindArea':
    'The owners of not all the area have voted: {площадь} m² are missing. While there are few votes, no decision is taken.',
  'poll.closed':
    'The meeting is completed: {название}\n{итог}\nTurnout: {участие}, in favour: {за} of the house area.',
  'poll.noQuorum': 'There is no quorum, the meeting did not take place.',
  'poll.passed': 'The decision is taken.',
  'poll.failed': 'The decision is not taken.',
  'poll.voteReplaced':
    'The vote of apartment {квартира} at the meeting "{название}" was changed by {кто}: {ответ}.\n' +
    'A property has one vote, the last one counts.',
  'poll.choice.for': 'in favour',
  'poll.choice.against': 'against',
  'poll.choice.abstain': 'abstained',
  'poll.elder':
    'The neighbours have chosen you as the senior of entrance {подъезд}.\n' +
    'Requests on the common property of the entrance are yours now: you see them, and you accept the work on them.',

  'pollRule.simple': 'Simple majority',
  'pollRule.qualified': 'Qualified majority',

  'poll.tally.for': 'In favour',
  'poll.tally.against': 'Against',
  'poll.tally.abstain': 'Abstained',
  'poll.base.participants': 'of those who voted',
  'poll.base.building': 'of all owners',
  'poll.threshold.strict': 'more than {доля}',
  'poll.threshold.plain': '{доля}',

  'poll.result.survey': 'A resident survey, it is not a decision of a meeting. Answered: {участие} of the house area.',
  'poll.result.meeting': '{правило}. Turnout: {участие} of the house area.',
  'poll.result.quorum':
    'Not everyone has voted yet: for the decision to stand, the votes of owners of {площадь} m² more are needed.',
  'poll.result.share': '{ответ}: {доля}',
  'poll.result.needed': '{порог} {база} is needed, {набрано} collected.',
  'poll.result.mine': 'The vote of the apartment: {ответ}.',
  'poll.result.mineBy': 'The vote of the apartment: {ответ} (cast by {кто}, an apartment has one vote).',

  'protocol.title': 'Minutes of the general meeting of owners',
  'protocol.surveyTitle': 'Results of the resident survey',
  'protocol.number': 'No. {номер}',
  'protocol.company': 'Management company: {название}',
  'protocol.form': 'Form: absentee voting through the system',
  'protocol.surveyForm': 'A survey of the management organisation: it is not a decision of a general meeting',
  'protocol.notice': 'Notice of the meeting: {номер}',
  'protocol.initiator': 'Initiator: {кто}',
  'protocol.surveyBy': 'Conducted by: {кто}',
  'protocol.administrator': 'Administrator of the meeting: {кто}',
  'protocol.voting': 'Voting: from {от} to {до}',
  'protocol.agenda': 'Item of the agenda',
  'protocol.counting': 'Counting of votes',
  'protocol.totalArea': 'Total area of the premises: {площадь} m²',
  'protocol.turnout': 'Took part: {площадь} m² ({доля})',
  'protocol.quorumYes': 'Quorum: yes, more than {порог} is required',
  'protocol.quorumUnknown': 'Quorum: not confirmed, {сколько} premises have no area on record',
  'protocol.quorumNo': 'Quorum: no, {площадь} m² are missing',
  'protocol.line': '{ответ}: {площадь} m² ({доля})',
  'protocol.decision': 'Decision',
  'protocol.rule': '{правило}: {набрано} {база} against the threshold of {порог}.',
  'protocol.moreThan': 'more than {доля}',
  'protocol.atLeast': 'no less than {доля}',
  'protocol.noQuorum': 'The meeting did not take place: there is no quorum.',
  'protocol.formed': 'The minutes were drawn up {дата}',
  'protocol.surveyFormed': 'The results were summed up {дата}',
  'protocol.attachments': 'Attachments: register of owners, decisions of owners, notice of holding the meeting.',
  'protocol.originals':
    'The originals of the decisions and of the minutes are handed to the management organisation ' +
    'and further to the state housing supervision authority.',

  'initiative.proposed': 'A neighbour proposes: {название}\n\n{описание}',
  'initiative.meetingCalled':
    'A meeting on your proposal has been called: {название}.\nThe vote is cast with the button below.',
  'initiative.enough': 'There are enough signatures to demand a meeting',
  'initiative.need': 'For a meeting to be called, the signatures of owners of {площадь} m² more are needed',
  'initiative.signatures': 'Signatures: {сколько}.',

  'binding.neighbour':
    'One more resident has been linked to your apartment {квартира}: {кто}.\n' +
    'If this is not your neighbour, tell the management company.',
  'binding.bound':
    'The management company has linked you to apartment {квартира}.\n' +
    'Meter readings and voting at meetings are available now.',
  'binding.unbound':
    'The management company has unlinked you from apartment {квартира}.\n' +
    'If this is a mistake, link it again with the code from the bill.',
  'binding.unboundPlain':
    'The management company has unlinked you from the apartment.\n' +
    'If this is a mistake, link it again with the code from the bill.',

  'quality.short': 'Requests open right now: {открыто}{просрочено}{срок}.',
  'quality.overdueShort': ', overdue {сколько}',
  'quality.rateShort': ', on time {доля} over {дни}',
  'quality.title': 'How the management company works over {дни}:',
  'quality.titleAt': 'How the management company works over {дни}, {адрес}:',
  'quality.created': '  Requests submitted: {сколько}',
  'quality.closed': '  Closed: {сколько}',
  'quality.inTime': '  On time: {доля}',
  'quality.hours': '  Average time of work: {часы} h',
  'quality.hoursBefore': '  Average time of work: {часы} h, a month earlier {раньше} h',
  'quality.rating': '  Rating by residents: {оценка} out of 5 ({сколько} rated)',
  'quality.open': 'Requests open right now: {сколько}',
  'quality.openOverdue': 'Requests open right now: {сколько}, overdue {просрочено}',

  'clarify.where': 'Where did it happen?',
  'clarify.whichFlat': 'In which apartment did it happen?',
  'clarify.flat': 'Apartment {номер}',
  'clarify.entrance': 'Entrance {номер}',

  'device.snapshot': '{устройство}: frame at {время}',

  'visit.booked': 'The management organisation has booked you an appointment: {когда}.\n{тема}',
  'visit.cancelled': 'The appointment on {день} at {время} is cancelled by the management organisation.',

  'assistant.offTopic':
    'I only help with the house and this app: requests, meters, the bill, meetings, ' +
    'doors and questions to the management organisation. A person from the management organisation will answer the rest.',
  'assistant.fallback':
    'I did not understand the question. Here you can report a breakdown, submit readings, view requests ' +
    'and write to the management organisation.',
  'assistant.section': '{раздел}: {описание}.',
  'assistant.answerInQuestionLanguage': 'Answer in the language the question is asked in.',
  'assistant.answerInLanguage':
    'If the language of the question is unclear, answer in the language called {язык}.',
  'assistant.reportLanguage':
    'In the language field return the language code of the question, one of: {коды}.',
  'assistant.offerLanguage': 'I can speak with you in English: press the button below.',
  'assistant.languageButton': '🌐 Speak English',

  'capability.new.title': 'Report a breakdown',
  'capability.new.about':
    'Describe in words or by photo what broke: the product will determine the category and name the deadline',
  'capability.list.title': 'My requests',
  'capability.list.about':
    'View your requests: state, deadline, who does the work, and accept what is done',
  'capability.meters.title': 'Meter readings',
  'capability.meters.about': 'Submit the readings of the water, electricity and heat meters',
  'capability.bill.title': 'Bill and payment',
  'capability.bill.about': 'View the charge for the month, the debt and the penalty and pay',
  'capability.home.title': 'House: doors and cameras',
  'capability.home.about':
    'Open the entrance door or the barrier, view a camera frame, issue a one-time code to a guest',
  'capability.news.title': 'House announcements',
  'capability.news.about':
    'Read the announcements of the management organisation and learn about planned works',
  'capability.tour.title': 'App tour',
  'capability.tour.about': 'Take a short walk through the sections: what is where and where to start',
  'capability.polls.title': 'Owners meetings',
  'capability.polls.about':
    'Vote at a meeting, support a proposal of a neighbour, read the minutes',
  'capability.support.title': 'Question to the management organisation',
  'capability.support.about':
    'Ask a question and get an answer by correspondence, see the phone numbers and the opening hours',
  'capability.visits.title': 'Appointment booking',
  'capability.visits.about': 'Choose a free hour of the appointment at the management organisation',
  'capability.bind.title': 'Link the apartment',
  'capability.bind.about':
    'Enter the code from the bill to open the meters, the bill and the vote at the meeting',
  'capability.capital.title': 'Capital repairs',
  'capability.capital.about':
    'View the contribution, what the house has saved and the years of works under the regional programme',
  'capability.quality.title': 'How the company works',
  'capability.quality.about':
    'See how many requests are closed on time and what breaks most often in the house',
  'capability.language.title': 'Product language',
  'capability.language.about': 'Choose the language the product speaks to you in',
  'capability.profile.title': 'Profile and my data',
  'capability.profile.about': 'Phone, notifications, export of your data and profile deletion',
  'capability.stickers.title': 'Object codes',
  'capability.stickers.about': 'Get a sticker with the code of an entrance, a lift or an apartment',

  'audience.building': 'the whole house',
  'audience.entrance': 'entrance {подъезд}',
  'audience.riser': 'entrance {подъезд}, riser {стояк}',

  'target.apartment': 'apartment {номер}',
  'target.apartmentAny': 'apartment',
  'target.entrance': 'entrance {подъезд}',
  'target.riser': 'entrance {подъезд}, riser {стояк}',
  'target.equipment': 'equipment {код}',
  'target.building': 'the whole house',

  'scope.apartments': 'apartments {номера}',
  'scope.debtors': 'house debtors',
  'scope.meters': 'readings not submitted',
  'scope.poll': 'have not voted: {название}',
  'scope.pollAny': 'have not voted',
  'scope.staff': 'house shift',

  'reporters.one': '{сколько} reported',
  'reporters.few': '{сколько} reported',
  'reporters.many': '{сколько} reported',

  'hint.plumbing': 'If you can, shut off the water before the technician arrives.',
  'hint.electricity': 'Do not touch the wiring or the panel: wait for the technician.',
  'hint.elevator': 'If there are people in the car, press the call button and do not open the doors yourself.',
  'hint.heating': 'Do not try to bleed the radiators yourself.',
  'hint.safety': 'If there is a threat to life, call 112 first.',

  'plain.supportAnswer': 'We will reply within 10 working days',
  'plain.disclosureAnswer': 'We give house information no later than the next day',
  'plain.readingWindow': 'Readings are accepted until the 26th',
  'plain.quorum': 'A decision is taken if owners of more than half the house area have voted',
  'plain.qualified': 'This question needs two thirds of the votes',
  'plain.initiative': 'A meeting is called by owners who together hold a tenth of the votes',
  'plain.share': 'A vote counts by the area of the apartment',
  'plain.penalty': 'Penalties start on day 31 of the delay and grow from day 91',
  'plain.workerAtHome': 'The technician shows an ID and puts on shoe covers',
  'plain.norm': 'Without readings we charge by the consumption norm',
  'plain.typicalNorm': 'The norm is a typical one: the organisation sets its own',
  'plain.wearForecast': 'This is a forecast from past breakdowns, not a regulation',

  'responsible.management': 'Management organisation',
  'responsible.resource': 'Utility supplier',
  'responsible.contractor': 'Contractor under agreement',
  'responsible.municipal': 'Municipal service',
  'responsible.owner': 'Owner of the property',

  'zone.elevator': 'The lift is serviced by a specialised organisation',
  'zone.insideFlat': 'Equipment inside the apartment is repaired by the owner',
  'zone.yard': 'The yard of the house is maintained by the management organisation',
  'zone.common': 'This is common property of the house, maintained by the management organisation',
  'zoneNext.elevator':
    'The request is handled by the management organisation: it passes it to the lift service company.',
  'zoneNext.insideFlat':
    'The management organisation does such work on a separate request, usually for a fee.',
  'zoneNext.yard': 'If the place is beyond the house plot, the request goes to the municipal service.',

  'ticketStatus.open': 'awaiting a reply',
  'ticketStatus.answered': 'answered',
  'ticketStatus.closed': 'closed',

  'inspection.entrance': 'Entrance inspection',
  'inspection.roof': 'Roof inspection',
  'inspection.basement': 'Basement inspection',
  'inspection.ventilation': 'Ventilation duct check',
  'inspection.lift': 'Lift maintenance',
  'inspection.intercom': 'Intercom maintenance',
  'inspection.meter_unit': 'Metering unit maintenance',

  'deed.reopenClosed': 'A request can be sent back to work while it is not closed.',
  'deed.rejectStaff': 'Requests are rejected by the management organisation.',
  'deed.withdrawOwn': 'Only the person who filed a request can withdraw it, and only while it is open.',
  'deed.needsInfoStaff': 'It is the management organisation that asks the resident for details.',
  'deed.doneWorker': 'Work is handed over by the assignee of a job that is in progress.',
  'deed.acceptDone': 'You can accept the work once the technician has handed it over.',
  'deed.acceptStaff': 'Requests are taken into work by the management organisation.',
  'deed.startWorker': 'A job can be taken into work by its assignee.',
  'deed.unavailable': 'This action is not available right now.',

  'contacts.emergency': 'Emergency, around the clock: {телефон}',
  'contacts.duty': 'On duty now: {кто}',
  'contacts.phone': 'Phone: {телефон}',
  'contacts.email': 'Email: {почта}',
  'contacts.office': 'Office hours: {где}',
  'contacts.person': 'Responsible: {кто}',
  'contacts.empty': 'No contacts are set: write to support, the shift will reply.',

  'role.removed': 'The management company removed your staff role. Requests and readings stay available.',
  'role.given': 'The management company gave you the role: {роль}.\nType /start to see the new commands.',

  'error.message_too_long': 'The message is too long',
  'error.apartment_unknown': 'The code did not match, check it on the bill',
  'error.resident_unknown': 'Profile not found',
  'error.building_unknown': 'The house is not identified',
  'error.building_not_found': 'House not found',
  'error.user_unknown': 'Nowhere to send: the profile has no MAX account',
  'error.notice_unknown': 'There is no such kind of notifications',
  'error.code_not_issued': 'Guest codes are not issued right now',
  'error.wrong_object': 'This sticker belongs to another object',
  'error.target_required': 'The address of the request could not be determined',
  'error.file_type_not_allowed': 'A file of this type cannot be attached',
  'error.file_empty': 'The file is empty',
  'error.file_too_large': 'The file is too large',
  'error.file_broken': 'The file did not open',
  'error.file_not_found': 'File not found',
  'error.vision_unavailable': 'Recognition did not answer, enter the reading in figures',
  'error.initiative_empty': 'Write what you propose',
  'error.initiative_too_long': 'The proposal is too long',

  'starter.break': 'How do I report a breakdown?',
  'starter.readings': 'Where do I submit readings?',
  'starter.request': 'What is happening with my request?',
  'starter.door': 'How do I open the entrance door?',
  'starter.queue': 'What is urgent in the queue?',
  'starter.assign': 'How do I assign an executor?',
  'starter.handoff': 'How do I pass a request to a partner organisation?',
  'starter.answer': 'How do I reply to a resident?',
  'starter.orders': 'Which jobs are assigned to me?',
  'starter.finish': 'How do I hand over the work?',
  'starter.deadline': 'Where is the deadline of a request?',
  'starter.orderDeadline': 'Where is the deadline of a job?',
  'starter.inspection': 'How do I mark an inspection?',
  'starter.report': 'How do I look at the house summary?',
  'starter.broadcast': 'How do I send an announcement to residents?',
  'starter.debtor': 'Who owes for an apartment?',
};
