import type { Dictionary } from '../../translate.js';

/** Строки, которые продукт показывает человеку. Ключ не переводится, переводится значение. */
export const bot: Dictionary = {
  'greeting.hello': 'Hello!',
  'greeting.resident':
    'I will help with the house: report a breakdown, send the figures from the meters,\n' +
    'look at the bill, open the entrance door.\n\n' +
    'You can simply write in words: "the tap is leaking", "open the door", "when will the entrance be cleaned".',
  'start.code_unknown': 'The code from the link did not fit: there is no such object in the house.',

  'lang.chosen': 'Language: {язык}.',

  'legal.ask':
    'Domovoy processes personal data on behalf of the management organisation of the house.\n' +
    'The processing policy and the user agreement are under the buttons below.\n' +
    'By pressing "I accept" you agree with them. Without consent I cannot accept a request ' +
    'and save readings.',
  'legal.accepted': 'You have agreed with the current version.\nThe full texts open under the buttons.',
  'legal.thanks': 'Thank you. How can I help?',

  'flat.ask': 'Send the apartment code from the bill: 8 characters next to the address.',
  'flat.unknown':
    'I do not know yet which apartment you are in.\n' +
    'A code of 8 characters is printed in the bill next to the address. Send it in a message.',
  'flat.bound':
    'Done. Now I know that you are in apartment {номер}.\n' +
    'You can send the figures from the meters, look at the bill and vote at the house meetings.',
  'flat.already': 'You are already linked to apartment {номер}.',
  'flat.already_yours': 'Apartment {номер} is already yours.',
  'flat.other_code':
    'You already have an apartment linked. This code will link apartment {номер}. Link it?',
  'flat.title': 'apartment {номер}',
  'flat.title_address': 'apartment {номер}, {адрес}',
  'flat.short': 'apt. {номер}',
  'flat.yours': 'Your {квартира}.',
  'flat.chosen': '{квартира} is chosen: the readings and the bill go by it.',
  'flat.used': 'Readings and bill: {квартира}',
  'flat.used_plain': 'Apartment chosen',
  'flat.not_bound': 'The apartment is not linked anyway',
  'flat.unbind_ask':
    'Unlink the apartment? The requests and readings stay with the house, you can link it again with the code from the bill.',
  'flat.unbound': 'The apartment is unlinked. You can link it again with the code from the bill.',
  'flat.unbound_toast': 'Apartment unlinked',

  'code.bad_letter':
    'The code has a letter that does not occur in it. Letters that look like digits do not get into the code, ' +
    'look at it in the bill once more.',
  'code.bad_length':
    'The code did not fit: it must have {надо} characters, and you sent {прислали}. Type it again.',

  'sticker.other_house': 'The code on the sticker is from another house: I will not open a request by it.',
  'object.ask': '{имя}, you have written about the object: {объект}.',
  'object.known': 'This has already been reported: request {номер}, {состояние}.',
  'object.reporters': 'Reports: {сколько}.',
  'object.same': 'If the problem is the same, just describe it and I will add you to this request.',
  'object.repaired': 'Last repair: {дата}',
  'object.describe': 'Describe in one message what happened, and I will open the request myself.',

  'request.new_ask':
    'Write what happened. For example: the light bulb in entrance 2 is out.\n' +
    'You can send a photo.',
  'request.accepted': 'Request {номер} is accepted.',
  'request.what': 'What: {что}, {где}.',
  'request.react': 'We will answer by {срок}.',
  'request.fix': 'It will be fixed by {срок}.',
  'request.same': 'This is the same request {номер}, I am not opening a new one.',
  'request.joined': 'Such a problem has already been reported: request {номер}, {состояние}.',
  'request.joined_you': 'You are the {который}th who wrote about it. It will be fixed by {срок}.',
  'request.notify': 'I will report the changes.',
  'request.planned': 'A request is not needed if the matter is in these works.',
  'request.optional': 'You may not answer, the request is already accepted.',
  'request.none': 'There are no requests yet.',
  'queue.resident':
    'The house queue is run by the management company. Your requests are in the "My requests" section.',
  'request.mine_count': 'Your requests in progress: {сколько}',
  'request.late': ', overdue {сколько}',
  'request.rest': 'More requests: {сколько}. The list is in the app.',
  'request.all_open': 'This is everything in progress. Closed requests are in the app.',
  'request.not_found': 'You have no request {номер}. Write what happened and I will open a new one.',
  'request.due': 'Deadline: by {срок}',
  'request.worker': 'The work is done by {кто}',
  'request.answers': 'Answers: {кто}',
  'request.state': 'Request {номер}: {состояние}',
  'request.rating': ', your rating {оценка}',
  'request.rate_ask': 'How did you accept the work?',
  'request.comment_sent': 'Passed on for request {номер}.',
  'request.answer_sent': 'Passed on for request {номер}: the technician will see your answer.',
  'request.reply_ask': 'Write the answer in one message, I will pass it on for this request.',
  'request.back_to_work': 'Request {номер} is in progress again: I passed your words to the technician.',
  'request.withdraw_ask':
    'Withdraw request{номер}? The technician will not come for it, it cannot be brought back, a new one will have to be opened.',
  'request.where_unknown':
    '{причина}. Scan the code on the entrance or open the app, there you can choose the address.',
  'request.where_skipped':
    'All right, the technician will clarify the address on the spot. The request is already with the staff on duty.',
  'request.where_set': 'Noted: {где}. Request {номер} is already with the staff on duty.',
  'request.where_refused': 'The address was not clarified',
  'request.same_here': 'Noted: it is the same for you. Request {номер}, I will report the changes.',
  'request.same_counted':
    'Noted: it is the same for you. Request {номер}, {сообщили}, I will report the changes.',
  'request.answered_already': 'You have already answered for request {номер}.',
  'request.fine': 'Thank you, noted: the cause is not in the common riser but in the neighbour apartment.',
  'request.closed_already': 'Thank you. The works on this request are already finished.',

  'meters.prompt': '{прибор}, meter {номер}.',
  'meters.previous': 'Previous reading: {значение} of {дата}',
  'meters.send_number': 'Send the reading as a number.',
  'meters.none':
    'No meters are recorded for your apartment. If there are any, tell the management company about it.',
  'meters.expired':
    'The verification period of the meter has expired: {приборы}.\n' +
    'Until it is verified I cannot accept readings, and this service is charged by the average norm.\n' +
    'The verification is ordered at the management company.',
  'meters.done': 'The readings for this month are already submitted. Thank you.',
  'meters.progress':
    'Readings for this month: {подано} of {всего} submitted. Choose a meter.',
  'meters.accepted': 'Accepted: {значение}.',
  'meters.consumption': 'Consumption for the period: {расход}.',
  'meters.refused': 'The reading is not accepted: {причина}',
  'meters.retry': 'Send the number once more.',
  'meters.next_window': 'We will accept the next reading from the {день}th.',
  'meters.not_number': 'This does not look like a number. Send the reading in digits, for example 123,456',
  'meters.not_reading':
    'This does not look like a reading. Send the number from the display or press "Cancel".',
  'meters.heard': 'I heard the reading {значение}. Submit it?\nIf it is wrong, send the number in digits.',
  'meters.from_photo':
    'On the photo I see {значение}. Submit this reading?\n' +
    'If the display shows another number, send it in a message.',
  'meters.no_vision':
    'The reading is not read from a photo here. Send it as a number, for example 123,456',
  'meters.photo_aim':
    'Photograph the display with the digits or send the reading as a number, for example 123,456',
  'meters.photo_number': 'Send the reading as a number, for example 123,456',
  'meters.photo_unreadable':
    'The digits in the photo cannot be made out. Take the display closer, without glare and tilt, ' +
    'or send the reading as a number, for example 123,456',
  'meters.no_others': 'There are no other meters without readings.',
  'meters.exact':
    'The reading must be exact: "approximately" and "about" do not suit a charge. ' +
    'Look at the display, choose the meter and send the whole number, for example 123,456',
  'meters.no_such':
    'A meter of this kind is not recorded for your apartment. The list of meters opens with the button below.',
  'meters.need_flat':
    'Readings are accepted by apartment: first link it with the code from the bill.',
  'meters.which': 'Reading {значение}: you have several meters of this kind. Choose whose it is.',
  'meters.which_value': 'This looks like the reading {значение}. Which meter is it of?',

  'bill.empty': 'There are no charges for this month yet.',
  'bill.total': 'Pay {сумма} by {срок}',
  'bill.paid': 'Charged {сумма}, everything is paid for this month',
  'bill.where': 'What it adds up from and what for, see in the app.',
  'pay.month_ask': 'Pay {сумма} for the month?',
  'pay.month_done': 'Paid {сумма}. The bill will come to the app.',
  'pay.debt_ask': 'Settle the debt of {сумма} for the past months?',
  'pay.debt_done': 'The debt is settled: {сумма} for {месяцы}.',

  'door.none': 'The intercom is not connected to the house. The management company will add it in the app.',
  'door.what': 'What to open?',
  'door.what_cameras': 'What to open or view?',
  'door.opened': '{дверь}: opened.',
  'door.snapshot': '{камера}: the frame is sent',
  'door.no_snapshot': 'The frame did not arrive',
  'door.guest_code':
    'Code for the guest: {код}\n' +
    'Let them type it on the intercom at the entrance. The code works today until {время}.',

  'news.title': 'Announcements of the management company:',
  'news.empty':
    'There are no announcements yet.\n' +
    'Messages of the management company will appear here: water shutoffs, cleaning, repairs.',
  'news.all': 'These are all the announcements.',
  'news.underway': 'under way now',
  'news.rest_in_app': 'Read the rest in the app.',

  'neighbours.title': 'Requests of the neighbours',
  'neighbours.empty':
    'The neighbours have not reported anything yet.\n' +
    'Breakdowns in the entrance and in the yard reported by the neighbours will appear here: they can be confirmed.',
  'neighbours.about':
    'The neighbours have reported {сколько}. ' +
    'In the app you can see what and where, and confirm that it is the same for you.',

  'vote.title': 'Owners meetings',
  'vote.none':
    'There are no open meetings now.\n' +
    'Owners meetings will appear here: the decision is counted by the area of the apartments.',
  'vote.open': 'Open meetings: {сколько}',
  'vote.initiatives': 'proposals of the neighbours: {сколько}',
  'vote.protocol_in_app': 'The full minutes are in the app.',
  'vote.abstain': 'I will not decide',
  'vote.counted': 'Meeting "{собрание}". The vote of the apartment: {ответ}.',
  'vote.refused': 'The vote is not accepted',
  'sign.refused': 'The signature is not accepted',

  'support.ask': 'Write the question in one message, I will pass it to the management company.',
  'support.ask_more':
    'Write a new question in one message, and answer the previous one with the button.',
  'support.taken': 'The question is accepted: "{тема}". The answer will come here.',
  'support.sent': 'Passed to the management organisation. The answer will come here.',
  'support.reply_ask': 'Write a message on this enquiry.',
  'support.all': 'These are all the enquiries.',
  'support.more': 'More enquiries below.',
  'contacts.tail': 'The other contacts are in the app.',

  'gzhi.none': 'There are no missed deadlines on your requests, there is nothing to complain about.',
  'gzhi.reason':
    'On request {номер} there are grounds for a complaint: {основание}.\nThe text of the complaint:',
  'gzhi.reason_short': 'Grounds: {основание}.\nThe text of the complaint:',
  'gzhi.sent_already': 'The complaint on request {номер} is already sent: {организация}.',
  'gzhi.sent_before': 'The complaint on this request is already sent: {организация}.',
  'gzhi.number': 'Number {номер}.',
  'gzhi.number_full': 'Complaint number {номер}.',
  'gzhi.confirm': 'Send this complaint to the housing inspectorate? It cannot be withdrawn.',
  'gzhi.sent': 'The complaint is sent: {организация}.',
  'gzhi.answer_days': 'The answer will come here, there are 30 days for it.',
  'gzhi.no_ground': 'There are no grounds for a complaint on this request.',

  'visit.in_chat': 'You can book an appointment in a private chat with me.',
  'visit.mine': 'You are booked for an appointment: {когда}',
  'visit.booked': 'Booked for an appointment, {когда}',
  'visit.not_booked': 'Not booked: {причина}',
  'visit.cancelled': 'The appointment booking is cancelled.',
  'visit.not_cancelled': 'The booking was not cancelled',
  'visit.not_opened': 'The booking did not open',
  'visit.no_reception':
    'Appointments by booking are not held. Write to the management company, the staff on duty will answer.',
  'visit.no_slots': 'There are no free hours for the next two weeks.',
  'visit.title': 'Appointment by booking',
  'visit.title_office': 'Appointment: {офис}',
  'visit.free': 'Free hours: {сколько}. The time is chosen in the app.',
  'visit.topic_ask': 'What are you coming about? Write in one line.',
  'visit.taken': 'This hour is taken. Choose another one.',
  'visit.taken_none': 'This hour is taken, there are no free ones yet.',

  'data.about': '{кто}.\nI keep about you: {что}.',
  'data.file': 'Your data as a file. {сводка}',
  'data.file_failed': 'The file could not be sent. The same data is visible in the app.',
  'forget.ask':
    'Delete the profile? The name will be erased, the apartment will be unlinked, notifications will stop coming. ' +
    'Requests, readings and votes stay with the house anonymised.',
  'forget.done': 'The profile is deleted. If you need me again, just write to me: I will open a new one.',
  'notice.on': 'I will send again: {что}.',
  'notice.off': 'I will not send any more: {что}. I will report emergencies and your own requests anyway.',
  'notice.such': 'such notifications',

  'talk.start':
    'Ask about the house and about how to do things. I will answer and open the right section.\n' +
    'You can ask one after another, the conversation ends with the button.',
  'talk.more': 'Ask more and I will answer. Or end the conversation.',
  'help.bind':
    'To start, send the apartment code from the bill: 8 characters next to the address.\n' +
    'After linking, requests, readings, the bill and the entrance doors will be here.',

  'dialog.describe': 'Describe in words what happened. A photo and a file will do.',
  'dialog.photo_ask': 'What is in the photo? Write in words.',
  'dialog.one_line': 'Write in one line what happened.',
  'dialog.unknown_attachment':
    'I cannot make out such an attachment. Write in words or send a photo or a file.',
  'dialog.need_text': 'Text is needed here: write the answer in a message.',
  'dialog.forgot': 'I do not remember what the request was about. Write once more what happened.',
  'dialog.cancelled': 'Cancelled. What needs to be done?',
  'dialog.cancelled_toast': 'Cancelled',

  'voice.not_heard':
    'I did not make out the voice message: silence, noise or an unfamiliar language. Say it again or write in words.',
  'voice.failed': 'The transcription is not answering now. Write in words.',
  'voice.unheard': 'I did not make out the voice message. Write in one line what happened.',
  'thinking.default': 'Thinking…',
  'thinking.voice': 'Transcribing…',
  'thinking.photo': 'Looking at the photo…',

  'emergency.call': 'If this is an emergency, call around the clock: {телефон}.',
  'app.install': 'Open the "Domovoy" mini app in MAX.',

  'error.retry': 'It did not work out. Press again or choose in the menu.',
  'error.message': 'The message could not be processed. Try again or choose in the menu.',
  'error.toast': 'It did not work out. Try again',
  'error.failed': 'It did not work out: {причина}',
  'error.failed_short': 'It did not work out',
  'command.unknown': 'I have no such command. You can write in words what you need, I will make it out.',

  'menu.title': 'Domovoy',
  'menu.words': 'You can write in words: "open the door", "how much to pay", "the tap is leaking".',
  'menu.in_chat': 'The menu opens in the chat with me.',
  'menu.new': '✍️ What broke',
  'menu.my': '📋 My requests',
  'menu.door': '🚪 Doors and cameras',
  'menu.bill': '🧾 How much to pay',
  'menu.meters': '💧 Meters',
  'menu.news': '📣 Announcements',
  'menu.vote': '🗳 Meetings',
  'menu.vote.about':
    'A vote on every question, counting by area shares and the minutes on the results.',
  'menu.neighbours': '👥 Requests of neighbours',
  'menu.neighbours.about':
    'What the neighbours have already reported: you can confirm that it is the same for you.',
  'menu.house': '📊 Work of the company',
  'menu.capital': '🏗 Capital repairs',
  'menu.capital.about':
    'The contribution, what the house has saved and the years of works under the regional programme.',
  'menu.support': '✉️ Question to the company',
  'menu.visit': '🗓 Appointment at the office',
  'menu.visit.about': 'Free hours two weeks ahead, your own booking and its cancellation.',
  'menu.contacts': '☎️ Contacts',
  'menu.flat': '🏢 Apartment',
  'menu.mydata': '🗂 My data',
  'menu.notices': '🔔 Notifications',
  'menu.notices.about':
    'What to send and what to keep quiet about. The phone and the export of your data are there too.',
  'menu.lang': '🌐 Language',
  'menu.group.money': '💳 Money and meters',
  'menu.group.money.about':
    'How much to pay this month and where to send the figures from the meters.',
  'menu.group.house': '📣 House news',
  'menu.group.house.about':
    'Announcements of the management company, meetings of the neighbours and work on the house.',
  'menu.group.me': '☎️ Contact and profile',
  'menu.group.me.about': 'How to reach the management company and what the product knows about you.',
  'menu.demo': '👥 Role',

  'menu.group.home': '🏡 My apartment',
  'menu.group.home.about': 'Your bills, meters and requests on your own apartment.',
  'menu.group.bind.about':
    'If you live in this house, link the apartment by the code from the bill.',
  'menu.home.new': '✍️ New request',
  'menu.home.meters': '💧 Readings',
  'menu.home.bill': '🧾 Bill',
  'menu.home.flat': '🏢 My apartment',
  'menu.home.visit.about': 'Free hours, your own booking and its cancellation.',

  'menu.contractor.my': '📋 Work orders',
  'menu.group.works': '🏢 House affairs',
  'menu.group.contractor.about':
    'Contact with the management company, announcements and entrance doors.',
  'menu.group.works.about': 'How the house meets deadlines, debts, meetings and entrance doors.',

  'menu.staff.queue': '🗂 House queue',
  'menu.staff.my': '📋 My work orders',
  'menu.staff.duty': '🌙 Duty',
  'menu.staff.support': '💬 Questions of residents',
  'menu.staff.visit': '🗓 Reception of residents',
  'menu.staff.visit.about':
    'Reception hours, resident bookings, the attendance mark and booking a walk-in.',
  'menu.staff.broadcast': '✉️ Broadcast',
  'menu.staff.report': '📊 Monthly summary',
  'menu.staff.debts': '💰 House debts',
  'menu.staff.vote.about':
    'Announce a meeting, watch the quorum and collect the minutes on the results.',
  'menu.staff.inspections': '🔍 Inspections',
  'menu.staff.inspections.about':
    'A walk-round by checklist: the points are marked on the spot, what is found becomes a request at once.',
  'menu.staff.plan': '🗺 House plan',
  'menu.staff.plan.about': 'Entrances and risers with marks where a problem was reported.',
  'menu.staff.equipment': '🛗 Equipment',
  'menu.staff.equipment.about': 'What fails more often and what will soon need repair.',
  'menu.staff.house_meters': '💧 Metering unit',
  'menu.staff.house_meters.about':
    'The common house consumption by months, the readings are entered there too.',
  'menu.staff.residents': '👥 People of the house',
  'menu.staff.residents.about':
    'Who is on duty in the shift, who is on call, who has which role, linking an apartment to a resident.',
  'menu.staff.stickers': '🏷 Stickers',
  'menu.staff.tariffs': '💵 Tariffs',
  'menu.staff.tariffs.about': 'The rates the house bill adds up from.',
  'menu.staff.card': '🏠 House card',
  'menu.staff.card.about': 'Contacts, reception hours, apartments and equipment of the house.',
  'menu.staff.buildings': '🏘 Houses of the company',
  'menu.staff.buildings.about': 'All the addresses of the company: switch or add a new one.',
  'menu.staff.audit': '📜 Action log',
  'menu.staff.audit.about':
    'Who did what on the house: requests, roles, readings, broadcasts.',
  'menu.group.people': '💬 Residents',
  'menu.group.people.about': 'Questions of residents, appointments by booking and messages to the house.',
  'menu.group.staff_me.about':
    'Your own apartment, data, notifications and contact with the management company as a resident.',
  'menu.group.app': '📱 In the app',
  'menu.group.app.about':
    'Screens that are not readable in a chat: walk-rounds, the house plan, the meters.',
  'menu.group.manage': '🗄 House management',
  'menu.group.manage.about': 'Tariffs, the house card, the company addresses and the action log.',

  'topic.bill': '🧾 Bill for the month',
  'topic.request': '📋 Requests',
  'topic.news': '📣 Announcements',

  'action.accepted': '✅ Take',
  'action.in_progress': '🔧 To work',
  'action.needs_info': '❓ Clarify',
  'action.done': '🏁 Hand over the work',
  'action.confirmed': '✅ All done, thank you',
  'action.rejected': '⛔ Reject',
  'action.withdrawn': '✖️ Withdraw the request',
  'action.return': '↩️ Not done, return',
  'action.close': '✅ Close the request',
  'action.answer': '💬 Answer',

  'comment.in_progress': 'What exactly is not done? Write in one message, I will pass it to the technician.',
  'comment.needs_info': 'What needs to be clarified with the resident? Write the question in one message.',
  'comment.rejected': 'Why is the request rejected? The resident will see the reason.',
  'comment.done': 'What is done? Write briefly, the resident will see the mark.',
  'comment.confirmed':
    'Who accepted the work? Write in one message, I will put it in the request history.',
  'comment.other': 'Describe the reason in one message.',

  'doing.understood': 'Understood: {что}',
  'doing.which': 'On which request?',
  'doing.confirm': 'Do it?',
  'doing.write_as': 'Write it down as "{что}"?',
  'doing.written': 'Noted: {что}',
  'doing.gone': 'This matter is already done or cancelled.',
  'doing.assign': 'assign the work order',
  'doing.accepted': 'accept the request for work',
  'doing.in_progress': 'take the work order into work',
  'doing.return': 'return the work to the technician',
  'doing.needs_info': 'ask the resident for a clarification',
  'doing.done': 'hand over the work',
  'doing.confirmed': 'accept the work',
  'doing.rejected': 'reject the request',
  'doing.withdrawn': 'withdraw the request',
  'doing.change': 'change the request',

  'button.menu': '🏠 Menu',
  'button.back': '⬅️ Back',
  'button.cancel': '✖️ Cancel',
  'button.open_app': '📱 Open the app',
  'button.in_app': 'Open in the app',
  'button.in_app_short': 'In the app',
  'button.show': 'View',
  'button.more': '⬇️ More',
  'button.more_news': '⬇️ More announcements',
  'button.new_request': '✍️ Open a request',
  'button.also_me': '🙋 Same here',
  'button.works': '👌 All works',
  'button.accept_legal': '✅ I accept',
  'button.legal_in_app': 'Documents in the app',
  'button.flat': '🏢 Apartment',
  'button.meters': '💧 Meters',
  'button.support': '✉️ Question to the company',
  'button.write_company': '✉️ Write to the company',
  'button.bill_in_app': 'Bill in the app',
  'button.requests_in_app': 'Requests in the app',
  'button.polls_in_app': 'Meetings in the app',
  'button.quality_in_app': 'House work in the app',
  'button.vote': 'Vote',
  'button.visit_choose': 'Choose a time',
  'button.other_days': 'Other days in the app',
  'button.cancel_visit': '✖️ Cancel the booking',
  'button.pay_month': '💳 For the month {сумма}',
  'button.pay_month_yes': '💳 Yes, pay {сумма}',
  'button.pay_debt': '💰 Old debt {сумма}',
  'button.pay_debt_yes': '💰 Yes, settle {сумма}',
  'button.guest_code': '🔑 Code for a guest',
  'button.copy_code': 'Copy the code',
  'button.reply_request': '💬 Write on the request',
  'button.answer_ticket': '💬 Answer on the enquiry',
  'button.unbind': '🏢 Unlink the apartment',
  'button.unbind_yes': '🚪 Yes, unlink',
  'button.bind_yes': '🏢 Yes, link',
  'button.export': '📄 Send as a file',
  'button.notices': '🔔 Notifications',
  'button.mute': '🔕 Notifications',
  'button.forget': '🗑 Delete me',
  'button.forget_yes': '🗑 Yes, delete',
  'button.submit_reading': '✅ Yes, submit',
  'button.skip_meter': '⏭ Skip',
  'button.to_meters': '💧 To the meter list',
  'button.rate_none': 'Accept without a rating',
  'button.end_talk': '✖️ End the conversation',
  'button.where_unknown': '🤷 I do not know where exactly',
  'button.withdraw_yes': '✖️ Yes, withdraw',
  'button.complaint': '📨 Send to the inspectorate',
  'button.gzhi': '📄 Complain to the inspectorate',
  'button.send_meters': '💧 Send readings',
  'button.complaint_yes': '📨 Yes, send',
  'button.sign': '🙋 Support',
  'button.none_of': '✖️ None of them',
  'button.stale': 'This button no longer works',
  'button.stale_more': 'This button is from an old message. Here is where you can start.',
};
