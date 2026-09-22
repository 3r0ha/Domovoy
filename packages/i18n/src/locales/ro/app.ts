import type { Dictionary } from '../../translate.js';

/** Строки, которые продукт показывает человеку. Ключ не переводится, переводится значение. */
export const app: Dictionary = {
  'status.new': 'nouă',
  'status.accepted': 'preluată în lucru',
  'status.in_progress': 'în execuție',
  'status.needs_info': 'așteaptă răspunsul locatarului',
  'status.done': 'executată, așteaptă recepția',
  'status.confirmed': 'închisă, lucrarea este recepționată',
  'status.rejected': 'respinsă',
  'status.withdrawn': 'retrasă de locatar',

  'category.elevator': 'Lift',
  'category.plumbing': 'Alimentare cu apă și canalizare',
  'category.heating': 'Încălzire',
  'category.electricity': 'Electricitate',
  'category.cleaning': 'Curățenie',
  'category.yard': 'Curte și teritoriu',
  'category.safety': 'Siguranță',
  'category.document': 'Adeverințe și documente',
  'category.other': 'Altele',

  'categoryShort.elevator': 'Lift',
  'categoryShort.plumbing': 'Apă',
  'categoryShort.heating': 'Căldură',
  'categoryShort.electricity': 'Lumină',
  'categoryShort.cleaning': 'Curățenie',
  'categoryShort.yard': 'Curte',
  'categoryShort.safety': 'Siguranță',
  'categoryShort.document': 'Adeverințe',
  'categoryShort.other': 'Altele',

  'meter.cold_water': 'Apă rece',
  'meter.hot_water': 'Apă caldă',
  'meter.electricity': 'Electricitate',
  'meter.heating': 'Încălzire',
  'meter.gas': 'Gaz',

  'meterUnit.cold_water': 'm³',
  'meterUnit.hot_water': 'm³',
  'meterUnit.electricity': 'kWh',
  'meterUnit.heating': 'Gcal',
  'meterUnit.gas': 'm³',

  'basis.meter': 'după contor',
  'basis.average': 'după media lunilor',
  'basis.norm': 'după norma de consum',

  'noticeKind.meters': 'Indicațiile contoarelor',
  'noticeKind.works': 'Lucrări planificate',
  'noticeKind.polls': 'Adunările proprietarilor',
  'noticeKind.news': 'Anunțurile blocului',
  'noticeKind.debt': 'Amintiri despre plată',

  'charge.maintenance': 'Întreținere și reparații curente',
  'charge.common': '{ресурс} pentru necesitățile comune ale blocului',
  'charge.recalculation': 'Recalculare: oprire peste normă la {ресурс}',

  'chargeDetail.rate': '{расход} {единица} × {тариф} ₽',
  'chargeDetail.area': '{площадь} m² × {тариф} ₽',
  'chargeDetail.recalculation': '{часы} h peste normă × 0,15% × {сумма} ₽',
  'chargeDetail.basis': '{расчёт} · {основание}',

  'month.1': 'ianuarie',
  'month.2': 'februarie',
  'month.3': 'martie',
  'month.4': 'aprilie',
  'month.5': 'mai',
  'month.6': 'iunie',
  'month.7': 'iulie',
  'month.8': 'august',
  'month.9': 'septembrie',
  'month.10': 'octombrie',
  'month.11': 'noiembrie',
  'month.12': 'decembrie',

  'monthOf.1': 'ianuarie',
  'monthOf.2': 'februarie',
  'monthOf.3': 'martie',
  'monthOf.4': 'aprilie',
  'monthOf.5': 'mai',
  'monthOf.6': 'iunie',
  'monthOf.7': 'iulie',
  'monthOf.8': 'august',
  'monthOf.9': 'septembrie',
  'monthOf.10': 'octombrie',
  'monthOf.11': 'noiembrie',
  'monthOf.12': 'decembrie',

  'weekday.1': 'luni',
  'weekday.2': 'marți',
  'weekday.3': 'miercuri',
  'weekday.4': 'joi',
  'weekday.5': 'vineri',
  'weekday.6': 'sâmbătă',
  'weekday.7': 'duminică',

  'error.forbidden': 'Acestea sunt date străine, nu pot fi deschise',
  'error.request_not_found': 'Sesizarea nu a fost găsită',
  'error.request_closed': 'Sesizarea este deja închisă',
  'error.transition_not_allowed': 'Starea sesizării nu se schimbă astfel',
  'error.too_many_requests': 'Prea multe sesizări într-o oră. Continuăm în ora următoare',
  'error.apartment_not_bound':
    'Aceasta ține de o locuință, mai întâi asociați apartamentul cu codul din factură',
  'error.apartment_required': 'Mai întâi asociați apartamentul cu codul din factură',
  'error.code_not_apartment': 'Acest cod nu este de la un apartament',
  'error.code_not_valid': 'Codul nu se potrivește sau nu mai este valabil',
  'error.code_not_found': 'Nu aveți un astfel de cod',
  'error.meter_not_found': 'Contorul nu a fost găsit',
  'error.reading_invalid': 'Indicația trebuie să fie un număr nu mai mic decât zero',
  'error.reading_decreased': 'Contorul nu poate arăta mai puțin decât înainte',
  'error.reading_too_large': 'Valoarea nu încape pe afișajul contorului',
  'error.reading_duplicate': 'Indicația pentru această perioadă de calcul a fost deja transmisă',
  'error.meter_not_verified':
    'Termenul de verificare a contorului a expirat, indicațiile nu pot fi primite',
  'error.meter_not_in_photo': 'În imagine nu se vede afișajul contorului',
  'error.nothing_to_pay': 'Nu este nimic de achitat: totul este plătit',
  'error.payments_unavailable': 'Plata nu este disponibilă acum, încercați mai târziu',
  'error.devices_unavailable': 'Casa inteligentă nu este disponibilă acum',
  'error.device_not_found': 'Dispozitivul nu a fost găsit',
  'error.device_not_openable': 'Acest dispozitiv nu se deschide',
  'error.device_not_viewable': 'Acest dispozitiv nu are cameră',
  'error.visit_not_found': 'Programarea nu a fost găsită',
  'error.visit_exists': 'Aveți deja o programare la audiență',
  'error.slot_taken': 'Această oră este deja ocupată, alegeți alta',
  'error.reception_empty': 'Organizația de administrare nu ține audiențe cu programare',
  'error.ticket_not_found': 'Solicitarea nu a fost găsită',
  'error.ticket_closed': 'Solicitarea este închisă, adresați întrebarea din nou',
  'error.poll_not_found': 'Votarea nu a fost găsită',
  'error.poll_closed': 'Rezultatele sunt totalizate, votul nu mai poate fi primit',
  'error.poll_open': 'Adunarea este încă în desfășurare, procesul-verbal se întocmește la final',
  'error.already_knocked': 'Vecinul de deasupra a fost deja anunțat',
  'error.no_upstairs': 'Deasupra acestui apartament nu sunt vecini',
  'error.upstairs_unknown':
    'Vecinul de deasupra nu este încă în aplicație, nu poate fi chemat de aici',
  'error.complaint_exists': 'Plângerea pentru această sesizare a fost deja trimisă',
  'error.text_empty': 'Scrieți în cuvinte ce s-a întâmplat',
  'error.message_empty': 'Mesajul este gol',
  'error.language_unknown': 'Nu am o astfel de limbă',

  'lang.ask': 'Alegeți limba',
  'error.initiative_not_found': 'Propunerea nu a fost găsită',
  'error.initiative_closed': 'Adunarea pe această propunere a fost deja anunțată',
  'error.initiative_exists': 'Propunerea dumneavoastră strânge deja semnături',

  'notice.status': 'Sesizarea {номер} {состояние}.\n{суть}\n{место}.',
  'notice.statusOf.accepted': 'este preluată în lucru',
  'notice.statusOf.in_progress': 'este în execuție',
  'notice.statusOf.needs_info': 'așteaptă precizarea dumneavoastră',
  'notice.statusOf.done': 'este executată, așteaptă recepția dumneavoastră',
  'notice.statusOf.confirmed': 'este închisă, lucrarea este recepționată',
  'notice.statusOf.rejected': 'este respinsă',
  'notice.statusOf.withdrawn': 'este retrasă',
  'notice.message': 'Sesizarea {номер}. {автор} scrie:\n{текст}',
  'notice.author.company': 'Administrația blocului',
  'notice.author.resident': 'Locatar',
  'notice.author.neighbour': 'Vecin',
  'notice.attachments.one': 'a trimis {сколько} atașament',
  'notice.attachments.few': 'a trimis {сколько} atașamente',
  'notice.attachments.many': 'a trimis {сколько} de atașamente',
  'notice.broadcast': 'Mesaj de la administrația blocului{дом}',
  'notice.guestEntry': 'Codul pentru oaspete a fost folosit: {устройство}, {время}',
  'notice.guestDoor': 'ușa',
  'notice.neighbourQuestion':
    'Un vecin de pe aceeași coloană anunță: {суть}.\nSesizarea {номер} este în lucru.\nLa dumneavoastră este la fel?',
  'notice.knock':
    'Domovoy bate la ușă: vecinul de dedesubt are {суть}.\n' +
    'Verificați dacă nu curge la dumneavoastră. Dacă da, opriți apa și apăsați butonul de mai jos, sesizarea este deja deschisă.',
  'notice.neighbourAlert':
    'Avarie: {категория}, {место}.\nSesizarea {номер} este în lucru, termen până la {срок}.\n' +
    'Despre schimbări vă scriu eu. La dumneavoastră este la fel?',
  'notice.overdue': 'Sesizarea {номер}: {что}.\n{место}.\n{дальше}',
  'notice.overdueOf.reaction': 'sesizarea nu a fost preluată în lucru nici până acum',
  'notice.overdueOf.resolution': 'lucrările nu au fost făcute în termenul promis',
  'notice.overdueEscalate': 'Există temei pentru a vă adresa inspecției de locuințe.',
  'notice.overdueWait': 'Vă anunțăm despre schimbări.',
  'notice.worksSoon': 'Mâine sunt lucrări planificate: {категория}.\n{адресаты}, {до}.\n{название}.',
  'notice.worksStarted':
    'Au început lucrările planificate: {категория}.\n{название}: {адресаты}.\nPlanificăm să terminăm până la {до}.',
  'notice.worksFinished':
    'Lucrările planificate sunt încheiate conform graficului: {название}, {адресаты}.\n' +
    'Dacă problema a rămas, scrieți-mi și întocmesc o sesizare.',
  'notice.acceptance':
    'Sesizarea {номер}: lucrarea este marcată ca executată.\n{место}.\n' +
    'Dacă totul este în regulă, nu trebuie să faceți nimic, peste {часы} sesizarea se închide singură.\n' +
    'Dacă problema a rămas, întoarceți-o în lucru și tehnicianul va veni din nou.',
  'notice.autoConfirmed':
    'Sesizarea {номер} este închisă: în {часы} nu au fost obiecții.\n{место}.\n' +
    'Dacă problema a rămas, creați o sesizare nouă, cea veche rămâne în istoricul obiectului.',
  'notice.staffRequest':
    'Administrația blocului a deschis o sesizare pentru apartamentul dumneavoastră: {суть}.\n{номер}, termen până la {срок}.',
  'notice.complaintSent':
    'Plângerea a fost trimisă: {организация}.{номер}\nRăspunsul vine în termen de 30 de zile.',
  'notice.complaintNumber': '\nNumărul {номер}.',
  'notice.debt': '{долг}\n\nPuteți achita cu butonul de mai jos.',
  'notice.due': 'Calculat pe lună: {сумма}. Achitați până în data de {день}, după aceea încep penalitățile.',

  'hours.one': '{сколько} oră',
  'hours.few': '{сколько} ore',
  'hours.many': '{сколько} de ore',
  'days.one': '{сколько} zi',
  'days.few': '{сколько} zile',
  'days.many': '{сколько} de zile',
  'days.left.one': 'a mai rămas {сколько} zi',
  'days.left.few': 'au mai rămas {сколько} zile',
  'days.left.many': 'au mai rămas {сколько} de zile',
  'months.one': '{сколько} lună',
  'months.few': '{сколько} luni',
  'months.many': '{сколько} de luni',

  'answer.houseNow': 'Acum în bloc:\n{строки}',
  'answer.houseWork': '{название}: {до}.',
  'answer.houseIncident': '{название}: sesizarea {номер}, termen {срок}.',
  'answer.houseShared':
    'Nu sunt anunțate avarii sau lucrări în bloc, dar există deja sesizări pe bloc:\n{строки}',
  'answer.houseSharedLine': '{название}: sesizarea {номер}, {состояние}.',
  'answer.houseAhead': 'Acum nu este nimic oprit în bloc. Următorul: {событие}, {когда}.',
  'answer.houseQuiet': 'Acum nu este nimic oprit în bloc și nu sunt avarii.',
  'answer.billEmpty': 'Pentru luna aceasta încă nu sunt sume calculate.',
  'answer.billLeft': 'De achitat {сумма} până pe {число}.',
  'answer.billPaid': 'Pentru luna aceasta totul este achitat.',
  'answer.requestsEmpty': 'Nu aveți sesizări deschise.',
  'answer.requests': 'Sesizările dumneavoastră:\n{строки}',
  'answer.requestLine': '{номер}: {состояние}, termen {срок}.',
  'answer.requestWaiting': 'așteaptă recepția dumneavoastră',
  'answer.requestWorking': 'în lucru',
  'answer.requestNew': 'nouă',

  'meters.remind':
    'Este timpul să transmiteți indicațiile contoarelor, {осталось}:\n{приборы}\nApăsați butonul de mai jos și trimiteți cifrele de pe contor.',
  'meters.expired':
    'A expirat verificarea: {приборы}.\nPână la verificarea nouă calculul se face după norma de consum.',
  'meters.name': '{прибор} ({номер})',
  'meters.spike':
    'Consumul la contorul „{прибор}” pe perioadă: {расход} {единица}, este vizibil mai mare decât de obicei.\n' +
    'Dacă nu ați consumat mai mult decât de obicei, verificați robinetele și rezervorul.',
  'meters.aboveNeighbours':
    'Consumul la contorul {номер} este mai mare decât la vecini: {расход} {единица} față de {соседи} {единица} la apartamente asemănătoare.\n' +
    'Merită verificat: cel mai des este un rezervor sau un robinet care picură.',

  'debt.total': 'Neachitat {сумма}:\n{строки}',
  'debt.line': '  {период}: {сумма}',
  'debt.linePenalty': '  {период}: {сумма} și penalități {пени}',
  'debt.penalty': '\n\nPenalitate pentru întârziere: {пени}\nTotal de achitat: {итого}',
  'debt.short': 'Datorie veche pentru {месяцы}: {сумма}',
  'debt.shortPenalty':
    'Datorie veche pentru {месяцы}: {сумма}, penalitate pentru întârziere {пени}',
  'debt.range': 'din {от} până în {до}',
  'debt.period': '{месяц} {год}',

  'support.answered':
    '{сотрудник}, administrația blocului, răspunde la întrebarea „{тема}”:\n{текст}',
  'support.waiting': 'Așteaptă răspunsul administrației blocului.',
  'support.earlier': 'Mai devreme sunt încă {сколько}, integral în aplicație.',
  'support.you': 'Dumneavoastră',
  'support.company': 'Administrația blocului',
  'support.resident': 'Locatar',

  'poll.meeting': 'Adunarea proprietarilor',
  'poll.survey': 'Sondaj printre locatari',
  'poll.started': '{вид}: {название}\n\n{вопрос}\n\n{порядок}',
  'poll.orderMeeting': '{правило}. Votarea are loc de la {от} până la {до}.',
  'poll.orderSurvey':
    'Puteți răspunde până la {до}. Sondajul nu înlocuiește adunarea proprietarilor.',
  'poll.remind': 'Adunarea „{название}” se închide pe {до}.\n{нехватка}',
  'poll.remindFew': 'Nu au votat toți: cât timp sunt puține voturi, decizia nu se ia.',
  'poll.remindArea':
    'Nu au votat proprietarii întregii suprafețe: lipsesc {площадь} m². Cât timp sunt puține voturi, decizia nu se ia.',
  'poll.closed':
    'Adunarea s-a încheiat: {название}\n{итог}\nParticipare: {участие}, pentru: {за} din suprafața blocului.',
  'poll.noQuorum': 'Nu este cvorum, adunarea nu a avut loc.',
  'poll.passed': 'Decizia este adoptată.',
  'poll.failed': 'Decizia nu este adoptată.',
  'poll.voteReplaced':
    'Votul apartamentului {квартира} la adunarea „{название}” a fost schimbat de {кто}: {ответ}.\n' +
    'Locuința are un singur vot, se ia în calcul ultimul.',
  'poll.choice.for': 'pentru',
  'poll.choice.against': 'împotrivă',
  'poll.choice.abstain': 'abținere',
  'poll.elder':
    'Vecinii v-au ales responsabil de scara {подъезд}.\n' +
    'Sesizările pe proprietatea comună a scării sunt acum ale dumneavoastră: le vedeți și recepționați lucrările pe ele.',

  'pollRule.simple': 'Majoritate simplă',
  'pollRule.qualified': 'Majoritate calificată',

  'poll.tally.for': 'Pentru',
  'poll.tally.against': 'Împotrivă',
  'poll.tally.abstain': 'Abțineri',
  'poll.base.participants': 'din cei care au votat',
  'poll.base.building': 'din toți proprietarii',
  'poll.threshold.strict': 'mai mult de {доля}',
  'poll.threshold.plain': '{доля}',

  'poll.result.survey':
    'Sondaj printre locatari, nu este o decizie a adunării. Au răspuns: {участие} din suprafața blocului.',
  'poll.result.meeting': '{правило}. Participare: {участие} din suprafața blocului.',
  'poll.result.quorum':
    'Încă nu au votat toți: pentru ca decizia să fie luată mai sunt necesare voturile proprietarilor a {площадь} m².',
  'poll.result.share': '{ответ}: {доля}',
  'poll.result.needed': 'Este nevoie de {порог} {база}, s-au strâns {набрано}.',
  'poll.result.mine': 'Votul apartamentului: {ответ}.',
  'poll.result.mineBy': 'Votul apartamentului: {ответ} (dat de {кто}, un apartament are un singur vot).',

  'protocol.title': 'Procesul-verbal al adunării generale a proprietarilor',
  'protocol.surveyTitle': 'Rezultatele sondajului printre locatari',
  'protocol.number': 'Nr. {номер}',
  'protocol.company': 'Organizația de administrare: {название}',
  'protocol.form': 'Forma: vot prin corespondență în sistem',
  'protocol.surveyForm': 'Sondaj al organizației de administrare: nu este o decizie a adunării generale',
  'protocol.notice': 'Anunțul despre adunare: {номер}',
  'protocol.initiator': 'Inițiator: {кто}',
  'protocol.surveyBy': 'Realizat de: {кто}',
  'protocol.administrator': 'Administratorul adunării: {кто}',
  'protocol.voting': 'Votare: de la {от} până la {до}',
  'protocol.agenda': 'Punctul de pe ordinea de zi',
  'protocol.counting': 'Numărarea voturilor',
  'protocol.totalArea': 'Suprafața totală a spațiilor: {площадь} m²',
  'protocol.turnout': 'Au participat: {площадь} m² ({доля})',
  'protocol.quorumYes': 'Cvorum: este, se cere mai mult de {порог}',
  'protocol.quorumUnknown': 'Cvorum: nu se confirmă, {сколько} spații nu au suprafața înregistrată',
  'protocol.quorumNo': 'Cvorum: nu, lipsesc {площадь} m²',
  'protocol.line': '{ответ}: {площадь} m² ({доля})',
  'protocol.decision': 'Decizia',
  'protocol.rule': '{правило}: {набрано} {база}, la un prag de {порог}.',
  'protocol.moreThan': 'mai mult de {доля}',
  'protocol.atLeast': 'nu mai puțin de {доля}',
  'protocol.noQuorum': 'Adunarea nu a avut loc: nu este cvorum.',
  'protocol.formed': 'Procesul-verbal a fost întocmit la {дата}',
  'protocol.surveyFormed': 'Rezultatele au fost centralizate la {дата}',
  'protocol.attachments':
    'Anexe: registrul proprietarilor, deciziile proprietarilor, anunțul despre ținerea adunării.',
  'protocol.originals':
    'Originalele deciziilor și ale procesului-verbal se predau organizației de administrare ' +
    'și mai departe organului de stat de supraveghere a locuințelor.',

  'initiative.proposed': 'Un vecin propune: {название}\n\n{описание}',
  'initiative.meetingCalled':
    'Pe propunerea dumneavoastră a fost anunțată o adunare: {название}.\nVotul se dă cu butonul de mai jos.',
  'initiative.enough': 'Semnăturile sunt suficiente pentru a cere o adunare',
  'initiative.need': 'Pentru ca adunarea să fie convocată mai sunt necesare semnăturile proprietarilor a {площадь} m²',
  'initiative.signatures': 'Semnături: {сколько}.',

  'binding.neighbour':
    'De apartamentul dumneavoastră {квартира} s-a mai asociat un locatar: {кто}.\n' +
    'Dacă acesta nu este vecinul dumneavoastră, anunțați administrația blocului.',
  'binding.ownerClaimed':
    '{кто} a indicat că este proprietarul apartamentului {квартира}.\n' +
    'Dacă nu este așa, spuneți organizației de administrare: de asta depinde votul la adunare.',
  'binding.bound':
    'Administrația blocului v-a asociat apartamentului {квартира}.\n' +
    'Acum sunt disponibile indicațiile contoarelor și votul la adunări.',
  'binding.unbound':
    'Administrația blocului v-a disociat de apartamentul {квартира}.\n' +
    'Dacă este o greșeală, asociați-vă din nou cu codul din factură.',
  'binding.unboundPlain':
    'Administrația blocului v-a disociat de apartament.\n' +
    'Dacă este o greșeală, asociați-vă din nou cu codul din factură.',

  'quality.short': 'Sesizări deschise acum: {открыто}{просрочено}{срок}.',
  'quality.overdueShort': ', depășite {сколько}',
  'quality.rateShort': ', în termen {доля} pe {дни}',
  'quality.title': 'Cum lucrează administrația blocului pe {дни}:',
  'quality.titleAt': 'Cum lucrează administrația blocului pe {дни}, {адрес}:',
  'quality.created': '  Sesizări depuse: {сколько}',
  'quality.closed': '  Închise: {сколько}',
  'quality.inTime': '  În termen: {доля}',
  'quality.hours': '  Durata medie a lucrărilor: {часы} h',
  'quality.hoursBefore': '  Durata medie a lucrărilor: {часы} h, cu o lună înainte {раньше} h',
  'quality.rating': '  Nota locatarilor: {оценка} din 5 (au notat {сколько})',
  'quality.open': 'Sesizări deschise acum: {сколько}',
  'quality.openOverdue': 'Sesizări deschise acum: {сколько}, depășite {просрочено}',

  'clarify.where': 'Unde s-a întâmplat?',
  'clarify.whichFlat': 'În care apartament s-a întâmplat?',
  'clarify.flat': 'Apartamentul {номер}',
  'clarify.entrance': 'Scara {номер}',

  'device.snapshot': '{устройство}: cadru la {время}',

  'visit.booked': 'Organizația de administrare v-a programat la audiență: {когда}.\n{тема}',
  'visit.cancelled': 'Audiența din {день} la ora {время} a fost anulată de organizația de administrare.',

  'visit.offer': 'Sesizarea {номер}: tehnicianul este gata să vină. Alegeți ora potrivită.',
  'visit.chosenForStaff': 'Sesizarea {номер}: locatarul așteaptă {когда}. {место}.',
  'visit.missed':
    'Tehnicianul a venit {когда} pentru sesizarea {номер} și nu a putut intra în apartament. ' +
    'Alegeți altă oră și el va veni din nou.',
  'visit.refused':
    'La sesizarea {номер} tehnicianul nu a putut intra în apartament de {сколько} ori. Sesizarea rămâne ' +
    'deschisă, dar ora lucrărilor o stabilește acum organizația de administrare: sunați-i.',
  'visit.declined': 'Niciuna dintre orele propuse nu se potrivește. Organizația de administrare va propune alta.',
  'visit.dropped': 'Sesizarea {номер}: locatarul a anulat ora vizitei și alege alta.',
  'visit.todayForResident':
    'Astăzi la {время} vine tehnicianul pentru sesizarea {номер}. Dacă planurile s-au schimbat, anulați ora.',
  'visit.todayForStaff': 'Astăzi la {время} sunteți așteptat pentru sesizarea {номер}. {место}.',

  'dispute.forStaff': 'Sesizarea {номер}, {место}. Solicitantul nu este de acord cu refuzul „{причина}”. El scrie: {что}',
  'dispute.upheld':
    'La sesizarea {номер} refuzul a fost menținut. Dacă nu sunteți de acord, mai departe se ocupă inspecția ' +
    'de locuințe: sesizarea este gata, o puteți trimite cu butonul.',

  'assistant.offTopic':
    'Ajut doar cu blocul și cu această aplicație: sesizări, contoare, factura, adunări, ' +
    'uși și întrebări către organizația de administrare. La rest răspunde un om din organizația de administrare.',
  'assistant.fallback':
    'Nu am înțeles întrebarea. Aici puteți anunța o defecțiune, transmite indicațiile, vedea sesizările ' +
    'și scrie organizației de administrare.',
  'assistant.section': '{раздел}: {описание}.',
  'assistant.answerInQuestionLanguage': 'Răspunde în limba în care este pusă întrebarea.',
  'assistant.answerInLanguage':
    'Dacă limba întrebării nu este clară, răspunde în limba numită {язык}.',
  'assistant.reportLanguage':
    'În câmpul language întoarce codul limbii întrebării, unul dintre: {коды}.',
  'assistant.offerLanguage': 'Pot vorbi cu dumneavoastră în română: apăsați butonul de mai jos.',
  'assistant.languageButton': '🌐 Vorbim în română',

  'capability.new.title': 'Anunțați o defecțiune',
  'capability.new.about':
    'Descrieți în cuvinte sau prin fotografie ce s-a stricat: produsul stabilește categoria și spune termenul',
  'capability.list.title': 'Sesizările mele',
  'capability.list.about':
    'Vedeți-vă sesizările: starea, termenul, cine execută lucrarea, și recepționați ce s-a făcut',
  'capability.meters.title': 'Indicațiile contoarelor',
  'capability.meters.about': 'Transmiteți indicațiile contoarelor de apă, electricitate și căldură',
  'capability.bill.title': 'Factura și plata',
  'capability.bill.about': 'Vedeți suma calculată pe lună, datoria și penalitățile și achitați',
  'capability.home.title': 'Blocul: uși și camere',
  'capability.home.about':
    'Deschideți ușa de la scară sau bariera, vedeți un cadru de la cameră, dați oaspetelui un cod de unică folosință',
  'capability.news.title': 'Anunțurile blocului',
  'capability.news.about':
    'Citiți anunțurile organizației de administrare și aflați despre lucrările planificate',
  'capability.tour.title': 'Tur prin aplicație',
  'capability.tour.about':
    'Parcurgeți o prezentare scurtă a secțiunilor: ce unde se află și de unde să începeți',
  'capability.polls.title': 'Adunările proprietarilor',
  'capability.polls.about':
    'Votați la adunare, susțineți propunerea unui vecin, citiți procesul-verbal',
  'capability.support.title': 'Întrebare către organizația de administrare',
  'capability.support.about':
    'Puneți o întrebare și primiți răspuns în corespondență, vedeți telefoanele și programul de lucru',
  'capability.visits.title': 'Programare la audiență',
  'capability.visits.about': 'Alegeți o oră liberă de audiență la organizația de administrare',
  'capability.bind.title': 'Asociați apartamentul',
  'capability.bind.about':
    'Introduceți codul din factură pentru a deschide contoarele, factura și votul la adunare',
  'capability.capital.title': 'Reparație capitală',
  'capability.capital.about':
    'Vedeți contribuția, suma acumulată de bloc și anii lucrărilor din programul regional',
  'capability.quality.title': 'Cum lucrează administrația',
  'capability.quality.about':
    'Vedeți câte sesizări sunt închise în termen și ce se strică cel mai des în bloc',
  'capability.language.title': 'Limba produsului',
  'capability.language.about': 'Alegeți limba în care produsul vorbește cu dumneavoastră',
  'capability.profile.title': 'Profilul și datele mele',
  'capability.profile.about':
    'Telefon, notificări, descărcarea datelor proprii și ștergerea profilului',
  'capability.stickers.title': 'Codurile obiectelor',
  'capability.stickers.about':
    'Primiți un autocolant cu codul scării, al liftului sau al apartamentului',

  'audience.building': 'tot blocul',
  'audience.entrance': 'scara {подъезд}',
  'audience.riser': 'scara {подъезд}, coloana {стояк}',

  'target.apartment': 'apartamentul {номер}',
  'target.apartmentAny': 'apartament',
  'target.entrance': 'scara {подъезд}',
  'target.riser': 'scara {подъезд}, coloana {стояк}',
  'target.equipment': 'echipamentul {код}',
  'target.building': 'tot blocul',

  'scope.apartments': 'apartamentele {номера}',
  'scope.debtors': 'datornicii blocului',
  'scope.meters': 'nu au transmis indicațiile',
  'scope.poll': 'nu au votat: {название}',
  'scope.pollAny': 'nu au votat',
  'scope.staff': 'tura blocului',

  'reporters.one': '{сколько} a anunțat',
  'reporters.few': '{сколько} au anunțat',
  'reporters.many': '{сколько} au anunțat',

  'hint.plumbing': 'Dacă puteți, închideți apa până vine meșterul.',
  'hint.electricity': 'Nu atingeți firele și tabloul: așteptați meșterul.',
  'hint.elevator': 'Dacă sunt oameni în cabină, apăsați butonul de legătură și nu deschideți ușile singuri.',
  'hint.heating': 'Nu încercați să aerisiți singuri caloriferele.',
  'hint.safety': 'Dacă viața este în pericol, sunați mai întâi la 112.',

  'plain.supportAnswer': 'Răspundem în cel mult 10 zile lucrătoare',
  'plain.disclosureAnswer': 'Informațiile despre bloc le dăm cel târziu a doua zi',
  'plain.readingWindow': 'Indicațiile se primesc până pe 26',
  'plain.quorum': 'Hotărârea se ia dacă a votat mai mult de jumătate din suprafața blocului',
  'plain.qualified': 'La această întrebare sunt necesare două treimi din voturi',
  'plain.initiative': 'Adunarea este convocată de proprietarii care dețin împreună a zecea parte din voturi',
  'plain.share': 'Votul se socotește după suprafața apartamentului',
  'plain.penalty': 'Penalitățile încep din ziua 31 de întârziere, iar din ziua 91 cresc',
  'plain.workerAtHome': 'Meșterul arată legitimația și pune botoși',
  'plain.norm': 'Fără indicații calculăm după norma de consum',
  'plain.typicalNorm': 'Norma este una tipică: pe a sa o stabilește organizația',
  'plain.wearForecast': 'Aceasta este o prognoză după defecțiunile trecute, nu un regulament',

  'responsible.management': 'Organizația de administrare',
  'responsible.resource': 'Furnizorul de utilități',
  'responsible.contractor': 'Antreprenor pe bază de contract',
  'responsible.municipal': 'Serviciul municipal',
  'responsible.owner': 'Proprietarul locuinței',

  'zone.elevator': 'Liftul este întreținut de o organizație specializată',
  'zone.insideFlat': 'Echipamentul din interiorul apartamentului îl repară proprietarul',
  'zone.flatBorder':
    'Limita trece prin primul dispozitiv de închidere: înainte de el răspunde organizația de administrare, după el proprietarul',
  'zone.yard': 'Curtea blocului este întreținută de organizația de administrare',
  'zone.common': 'Aceasta este proprietatea comună a blocului, întreținută de organizația de administrare',
  'zoneNext.elevator':
    'Sesizarea este condusă de organizația de administrare: ea o transmite firmei care întreține liftul.',
  'zoneNext.insideFlat':
    'Organizația de administrare face astfel de lucrări pe o sesizare separată, de regulă contra cost.',
  'zoneNext.flatBorder': 'Unde anume este defecțiunea stabilește tehnicianul la inspecție.',
  'zoneNext.yard': 'Dacă locul este în afara terenului blocului, sesizarea merge la serviciul municipal.',

  'ticketStatus.open': 'așteaptă răspuns',
  'ticketStatus.answered': 'răspuns dat',
  'ticketStatus.closed': 'închisă',

  'inspection.entrance': 'Inspecția scării',
  'inspection.roof': 'Inspecția acoperișului',
  'inspection.basement': 'Inspecția subsolului',
  'inspection.ventilation': 'Verificarea canalelor de ventilație',
  'inspection.lift': 'Mentenanța liftului',
  'inspection.intercom': 'Mentenanța interfonului',
  'inspection.meter_unit': 'Mentenanța punctului de contorizare',

  'deed.reopenClosed': 'Sesizarea poate fi readusă în lucru cât timp nu este închisă.',
  'deed.rejectStaff': 'Sesizările sunt respinse de organizația de administrare.',
  'deed.withdrawOwn': 'Sesizarea poate fi retrasă doar de cel care a depus-o și doar cât timp este deschisă.',
  'deed.needsInfoStaff': 'Lămuririle de la locatar le cere organizația de administrare.',
  'deed.doneWorker': 'Lucrarea este predată de executantul comenzii luate în lucru.',
  'deed.acceptDone': 'Puteți accepta lucrarea după ce meșterul a predat-o.',
  'deed.acceptStaff': 'Sesizările sunt luate în lucru de organizația de administrare.',
  'deed.startWorker': 'Comanda poate fi luată în lucru de executantul ei.',
  'deed.unavailable': 'Această acțiune nu este disponibilă acum.',

  'contacts.emergency': 'Avarii, non-stop: {телефон}',
  'contacts.duty': 'De serviciu acum: {кто}',
  'contacts.phone': 'Telefon: {телефон}',
  'contacts.email': 'E-mail: {почта}',
  'contacts.office': 'Audiențe: {где}',
  'contacts.person': 'Responsabil: {кто}',
  'contacts.empty': 'Contactele nu sunt completate: scrieți la asistență, tura vă va răspunde.',
  'privacy.summary': 'Sesizări {заявок}, indicații {показаний}, voturi {голосов}, plăți {платежей}',

  'role.removed':
    'Administrația blocului v-a retras rolul de serviciu. Sesizările și indicațiile rămân disponibile.',
  'role.given':
    'Administrația blocului v-a acordat rolul: {роль}.\nTastați /start pentru a vedea comenzile noi.',

  'error.message_too_long': 'Mesajul este prea lung',
  'error.apartment_unknown': 'Codul nu se potrivește, verificați-l pe factură',
  'error.resident_unknown': 'Profilul nu a fost găsit',
  'error.building_unknown': 'Blocul nu este determinat',
  'error.building_not_found': 'Blocul nu a fost găsit',
  'error.user_unknown': 'Nu există unde trimite: profilul nu are cont MAX',
  'error.notice_unknown': 'Nu există un astfel de tip de notificări',
  'error.code_not_issued': 'Codul pentru oaspeți nu se emite acum',
  'error.wrong_object': 'Acesta este autocolantul altui obiect',
  'error.target_required': 'Adresa sesizării nu a putut fi determinată',
  'error.file_type_not_allowed': 'Un astfel de fișier nu poate fi atașat',
  'error.file_empty': 'Fișierul este gol',
  'error.file_too_large': 'Fișierul este prea mare',
  'error.file_broken': 'Fișierul nu s-a deschis',
  'error.file_not_found': 'Fișierul nu a fost găsit',
  'error.vision_unavailable': 'Recunoașterea nu a răspuns, introduceți indicația în cifre',
  'error.initiative_empty': 'Scrieți ce propuneți',
  'error.initiative_too_long': 'Propunerea este prea lungă',

  'starter.break': 'Cum anunț o defecțiune?',
  'starter.readings': 'Unde transmit indicațiile?',
  'starter.request': 'Ce se întâmplă cu sesizarea mea?',
  'starter.door': 'Cum deschid ușa de la scară?',
  'starter.queue': 'Ce este urgent în coadă?',
  'starter.assign': 'Cum desemnez un executant?',
  'starter.handoff': 'Cum transmit sesizarea unei organizații partenere?',
  'starter.answer': 'Cum răspund unui locatar?',
  'starter.orders': 'Ce comenzi am pe mine?',
  'starter.finish': 'Cum predau lucrarea?',
  'starter.deadline': 'Unde este termenul sesizării?',
  'starter.orderDeadline': 'Unde este termenul comenzii?',
  'starter.inspection': 'Cum bifez o inspecție?',
  'starter.report': 'Cum văd raportul pe bloc?',
  'starter.broadcast': 'Cum trimit un anunț locatarilor?',
  'starter.debtor': 'Cine are datorie la apartament?',
};
