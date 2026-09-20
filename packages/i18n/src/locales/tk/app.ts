import type { Dictionary } from '../../translate.js';

/** Строки, которые продукт показывает человеку. Ключ не переводится, переводится значение. */
export const app: Dictionary = {
  'status.new': 'täze',
  'status.accepted': 'işe kabul edildi',
  'status.in_progress': 'ýerine ýetirilýär',
  'status.needs_info': 'ýaşaýjynyň jogabyna garaşýar',
  'status.done': 'ýerine ýetirildi, kabul edilmegine garaşýar',
  'status.confirmed': 'ýapyldy, iş kabul edildi',
  'status.rejected': 'ret edildi',
  'status.withdrawn': 'ýaşaýjy yzyna aldy',

  'category.elevator': 'Lift',
  'category.plumbing': 'Suw üpjünçiligi we lagym',
  'category.heating': 'Ýyladyş',
  'category.electricity': 'Elektrik',
  'category.cleaning': 'Arassaçylyk',
  'category.yard': 'Howly we töwerek',
  'category.safety': 'Howpsuzlyk',
  'category.document': 'Kepilnamalar we resminamalar',
  'category.other': 'Beýleki',

  'categoryShort.elevator': 'Lift',
  'categoryShort.plumbing': 'Suw',
  'categoryShort.heating': 'Ýylylyk',
  'categoryShort.electricity': 'Yşyk',
  'categoryShort.cleaning': 'Arassaçylyk',
  'categoryShort.yard': 'Howly',
  'categoryShort.safety': 'Howpsuzlyk',
  'categoryShort.document': 'Kepilnamalar',
  'categoryShort.other': 'Beýleki',

  'meter.cold_water': 'Sowuk suw',
  'meter.hot_water': 'Yssy suw',
  'meter.electricity': 'Elektrik',
  'meter.heating': 'Ýyladyş',
  'meter.gas': 'Gaz',

  'meterUnit.cold_water': 'm³',
  'meterUnit.hot_water': 'm³',
  'meterUnit.electricity': 'kWh',
  'meterUnit.heating': 'Gcal',
  'meterUnit.gas': 'm³',

  'basis.meter': 'hasaplaýjy boýunça',
  'basis.average': 'ortaça boýunça',
  'basis.norm': 'kadalaýyn hasap boýunça',

  'noticeKind.meters': 'Hasaplaýjylaryň görkezijileri',
  'noticeKind.works': 'Meýilnamalaýyn işler',
  'noticeKind.polls': 'Eýeleriň ýygnaklary',
  'noticeKind.news': 'Jaýyň bildirişleri',

  'charge.maintenance': 'Saklaýyş we şu wagtky abatlaýyş',
  'charge.common': '{ресурс}: jaýyň umumy hajatlaryna',
  'charge.recalculation': 'Gaýtadan hasaplama: {ресурс} kadadan uzak wagtlap kesildi',

  'chargeDetail.rate': '{расход} {единица} × {тариф} ₽',
  'chargeDetail.area': '{площадь} m² × {тариф} ₽',
  'chargeDetail.recalculation': 'kadadan artyk {часы} sag × 0,15% × {сумма} ₽',
  'chargeDetail.basis': '{расчёт} · {основание}',

  'month.1': 'ýanwar',
  'month.2': 'fewral',
  'month.3': 'mart',
  'month.4': 'aprel',
  'month.5': 'maý',
  'month.6': 'iýun',
  'month.7': 'iýul',
  'month.8': 'awgust',
  'month.9': 'sentýabr',
  'month.10': 'oktýabr',
  'month.11': 'noýabr',
  'month.12': 'dekabr',

  'monthOf.1': 'ýanwar',
  'monthOf.2': 'fewral',
  'monthOf.3': 'mart',
  'monthOf.4': 'aprel',
  'monthOf.5': 'maý',
  'monthOf.6': 'iýun',
  'monthOf.7': 'iýul',
  'monthOf.8': 'awgust',
  'monthOf.9': 'sentýabr',
  'monthOf.10': 'oktýabr',
  'monthOf.11': 'noýabr',
  'monthOf.12': 'dekabr',

  'error.forbidden': 'Bu başganyň maglumatlary, olary açyp bolmaýar',
  'error.request_not_found': 'Arza tapylmady',
  'error.request_closed': 'Arza eýýäm ýapyldy',
  'error.transition_not_allowed': 'Arzanyň ýagdaýy beýle üýtgemeýär',
  'error.too_many_requests': 'Bir sagatda arza gaty köp. Indiki sagatda dowam ederis',
  'error.apartment_not_bound':
    'Bu ýaşalýan jaýa degişli, ilki kwartirany kwitansiýadaky kod bilen birikdiriň',
  'error.apartment_required': 'Ilki kwartirany kwitansiýadaky kod bilen birikdiriň',
  'error.code_not_apartment': 'Bu kod kwartiranyňky däl',
  'error.code_not_valid': 'Kod gabat gelmeýär ýa-da güýjüni ýitiripdir',
  'error.code_not_found': 'Sizde beýle kod ýok',
  'error.meter_not_found': 'Hasaplaýjy tapylmady',
  'error.reading_invalid': 'Görkeziji noldan kiçi bolmadyk san bolmaly',
  'error.reading_decreased': 'Hasaplaýjy öňkiden az görkezip bilmeýär',
  'error.reading_too_large': 'Baha hasaplaýjynyň tablosyna sygmaýar',
  'error.reading_duplicate': 'Bu hasaplaşyk döwri üçin görkeziji eýýäm tabşyryldy',
  'error.meter_not_verified':
    'Hasaplaýjynyň barlag möhleti gutardy, görkezijileri kabul edip bolmaýar',
  'error.meter_not_in_photo': 'Suratda hasaplaýjynyň tablosy görünmeýär',
  'error.nothing_to_pay': 'Tölemeli zat ýok: hemmesi tölendi',
  'error.payments_unavailable': 'Töleg häzir elýeterli däl, soňrak synanyşyň',
  'error.devices_unavailable': 'Akylly jaý häzir elýeterli däl',
  'error.device_not_found': 'Enjam tapylmady',
  'error.device_not_openable': 'Bu enjam açylmaýar',
  'error.device_not_viewable': 'Bu enjamda kamera ýok',
  'error.visit_not_found': 'Ýazgy tapylmady',
  'error.visit_exists': 'Sizde eýýäm kabul edişe ýazgy bar',
  'error.slot_taken': 'Bu wagt eýýäm bant, başgasyny saýlaň',
  'error.reception_empty': 'Dolandyryjy gurama ýazgy boýunça kabul etmeýär',
  'error.ticket_not_found': 'Sorag tapylmady',
  'error.ticket_closed': 'Sorag ýapyldy, soragy täzeden beriň',
  'error.poll_not_found': 'Ses berişlik tapylmady',
  'error.poll_closed': 'Netijeler jemlendi, sesi kabul edip bolmaýar',
  'error.poll_open': 'Ýygnak heniz dowam edýär, teswirnama netijeler boýunça düzülýär',
  'error.already_knocked': 'Ýokarky goňşa eýýäm habar berildi',
  'error.no_upstairs': 'Bu kwartiranyň ýokarsynda goňşy ýok',
  'error.upstairs_unknown': 'Ýokarky goňşy heniz goşundyda ýok, ony bu ýerden çagyryp bolmaýar',
  'error.complaint_exists': 'Bu arza boýunça şikaýat eýýäm iberildi',
  'error.text_empty': 'Näme bolanyny söz bilen ýazyň',
  'error.message_empty': 'Habar boş',
  'error.language_unknown': 'Mende beýle dil ýok',
  'error.initiative_not_found': 'Teklip tapylmady',
  'error.initiative_closed': 'Bu teklip boýunça ýygnak eýýäm yglan edildi',
  'error.initiative_exists': 'Siziň tekibiňiz eýýäm gol ýygnaýar',

  'notice.status': 'Arza {номер} {состояние}.\n{суть}\n{место}.',
  'notice.statusOf.accepted': 'işe kabul edildi',
  'notice.statusOf.in_progress': 'ýerine ýetirilýär',
  'notice.statusOf.needs_info': 'siziň takyklamaňyza garaşýar',
  'notice.statusOf.done': 'ýerine ýetirildi, siziň kabul etmegiňize garaşýar',
  'notice.statusOf.confirmed': 'ýapyldy, iş kabul edildi',
  'notice.statusOf.rejected': 'ret edildi',
  'notice.statusOf.withdrawn': 'yzyna alyndy',
  'notice.message': 'Arza {номер}. {автор} ýazýar:\n{текст}',
  'notice.author.company': 'Dolandyryjy kompaniýa',
  'notice.author.resident': 'Ýaşaýjy',
  'notice.author.neighbour': 'Goňşy',
  'notice.attachments.one': '{сколько} goşulan faýl iberdi',
  'notice.attachments.few': '{сколько} goşulan faýl iberdi',
  'notice.attachments.many': '{сколько} goşulan faýl iberdi',
  'notice.broadcast': 'Dolandyryjy kompaniýanyň habary{дом}',
  'notice.guestEntry': 'Myhman kody işledi: {устройство}, {время}',
  'notice.guestDoor': 'gapy',
  'notice.neighbourQuestion':
    'Stoýak boýunça goňşy habar berýär: {суть}.\nArza {номер} işde.\nSizde-de şonuň ýalymy?',
  'notice.knock':
    'Domovoy gapyňyzy kakýar: aşaky goňşuda {суть}.\n' +
    'Sizde suw akyp durmy, serediň. Akýan bolsa, suwy ýapyň we aşakdaky düwmä basyň, arza eýýäm açyldy.',
  'notice.neighbourAlert':
    'Awariýa: {категория}, {место}.\nArza {номер} işde, möhleti {срок}.\n' +
    'Üýtgeşmeler barada özüm ýazaryn. Sizde-de şonuň ýalymy?',
  'notice.overdue': 'Arza {номер}: {что}.\n{место}.\n{дальше}',
  'notice.overdueOf.reaction': 'arza şu wagta çenli işe kabul edilmedi',
  'notice.overdueOf.resolution': 'işler wada berlen möhletde edilmedi',
  'notice.overdueEscalate': 'Ýaşaýyş jaý gözegçiligine ýüz tutmaga esas bar.',
  'notice.overdueWait': 'Üýtgeşmeler barada habar bereris.',
  'notice.worksSoon': 'Ertir meýilnamalaýyn işler: {категория}.\n{адресаты}, {до}.\n{название}.',
  'notice.worksStarted':
    'Meýilnamalaýyn işler başlady: {категория}.\n{название}: {адресаты}.\n' +
    '{до} tamamlamagy meýilleşdirýäris.',
  'notice.worksFinished':
    'Meýilnamalaýyn işler tertip boýunça tamamlandy: {название}, {адресаты}.\n' +
    'Mesele galan bolsa, ýazyň, arza resmileşdirerin.',
  'notice.acceptance':
    'Arza {номер}: iş ýerine ýetirildi diýlip bellendi.\n{место}.\n' +
    'Hemmesi ýerinde bolsa, hiç zat etmeli däl, {часы} soň arza özi ýapylar.\n' +
    'Mesele galan bolsa, ony işe gaýtaryň, ussa ýene geler.',
  'notice.autoConfirmed':
    'Arza {номер} ýapyldy: {часы} içinde garşylyk gelmedi.\n{место}.\n' +
    'Mesele galan bolsa, täze arza dörediň, öňkisi obýektiň taryhynda galar.',
  'notice.staffRequest':
    'Dolandyryjy kompaniýa siziň kwartiraňyz boýunça arza açdy: {суть}.\n{номер}, möhleti {срок}.',
  'notice.complaintSent': 'Şikaýat iberildi: {организация}.{номер}\nJogap 30 günüň içinde gelýär.',
  'notice.complaintNumber': '\nBelgisi {номер}.',
  'notice.debt': '{долг}\n\nAşakdaky düwme bilen töläp bolýar.',

  'hours.one': '{сколько} sagat',
  'hours.few': '{сколько} sagat',
  'hours.many': '{сколько} sagat',
  'days.one': '{сколько} gün',
  'days.few': '{сколько} gün',
  'days.many': '{сколько} gün',
  'days.left.one': '{сколько} gün galdy',
  'days.left.few': '{сколько} gün galdy',
  'days.left.many': '{сколько} gün galdy',
  'months.one': '{сколько} aý',
  'months.few': '{сколько} aý',
  'months.many': '{сколько} aý',

  'answer.houseNow': 'Häzir jaýda:\n{строки}',
  'answer.houseWork': '{название}: {до}.',
  'answer.houseIncident': '{название}: arza {номер}, möhleti {срок}.',
  'answer.houseShared':
    'Jaýda awariýa we iş yglan edilmedi, ýöne jaý boýunça arzalar eýýäm bar:\n{строки}',
  'answer.houseSharedLine': '{название}: arza {номер}, {состояние}.',
  'answer.houseAhead': 'Häzir jaýda hiç zat kesilmedi. Iň ýakyny: {событие}, {когда}.',
  'answer.houseQuiet': 'Häzir jaýda hiç zat kesilmedi, awariýa hem ýok.',
  'answer.billEmpty': 'Bu aý üçin hasaplama heniz ýok.',
  'answer.billLeft': 'Tölege {сумма}, aýyň {число} çenli.',
  'answer.billPaid': 'Bu aý üçin hemmesi tölendi.',
  'answer.requestsEmpty': 'Siziň açyk arzaňyz ýok.',
  'answer.requests': 'Siziň arzalaryňyz:\n{строки}',
  'answer.requestLine': '{номер}: {состояние}, möhleti {срок}.',
  'answer.requestWaiting': 'siziň kabul etmegiňize garaşýar',
  'answer.requestWorking': 'işde',
  'answer.requestNew': 'täze',

  'meters.remind':
    'Hasaplaýjylaryň görkezijilerini tabşyrmaly wagt, {осталось}:\n{приборы}\n' +
    'Aşakdaky düwmä basyň we hasaplaýjydaky sanlary iberiň.',
  'meters.expired':
    'Barlag möhleti gutardy: {приборы}.\nTäze barlaga çenli kadalaýyn hasap boýunça hasaplanýar.',
  'meters.name': '{прибор} ({номер})',
  'meters.spike':
    '«{прибор}» hasaplaýjysy boýunça döwrüň sarpy: {расход} {единица}, bu adatdakysyndan ep-esli köp.\n' +
    'Adatdakysyndan köp sarp etmedik bolsaňyz, kranlary we unitazyň bakyny barlaň.',
  'meters.aboveNeighbours':
    '{номер} hasaplaýjysy boýunça sarp goňşulardakydan köp: meňzeş kwartiralarda ' +
    '{соседи} {единица} bolsa, sizde {расход} {единица}.\n' +
    'Barlamaga degýär: köplenç bu syzýan bak ýa-da garyjy kran bolýar.',

  'debt.total': 'Tölenmedik {сумма}:\n{строки}',
  'debt.line': '  {период}: {сумма}',
  'debt.linePenalty': '  {период}: {сумма} we jerime {пени}',
  'debt.penalty': '\n\nGijikdirilendigi üçin jerime: {пени}\nJemi tölemeli: {итого}',
  'debt.short': 'Köne bergi, {месяцы} üçin: {сумма}',
  'debt.shortPenalty': 'Köne bergi, {месяцы} üçin: {сумма}, gijikdirme jerimesi {пени}',
  'debt.range': '{от} — {до} aralygy',
  'debt.period': '{месяц} {год}',

  'support.answered': '{сотрудник}, dolandyryjy kompaniýa, «{тема}» soragyna jogap berýär:\n{текст}',
  'support.waiting': 'Dolandyryjy kompaniýanyň jogabyna garaşýar.',
  'support.earlier': 'Öň ýene {сколько}, dolusy goşundyda.',
  'support.you': 'Siz',
  'support.company': 'Dolandyryjy kompaniýa',
  'support.resident': 'Ýaşaýjy',

  'poll.meeting': 'Eýeleriň ýygnagy',
  'poll.survey': 'Ýaşaýjylaryň sowalnamasy',
  'poll.started': '{вид}: {название}\n\n{вопрос}\n\n{порядок}',
  'poll.orderMeeting': '{правило}. Ses berişlik {от} — {до} aralygynda dowam edýär.',
  'poll.orderSurvey':
    '{до} çenli jogap berip bolýar. Sowalnama eýeleriň ýygnagynyň ýerini tutmaýar.',
  'poll.remind': '«{название}» ýygnagy {до} ýapylýar.\n{нехватка}',
  'poll.remindFew': 'Hemmeler ses bermedi: ses az wagty çözgüt kabul edilmez.',
  'poll.remindArea':
    'Ähli meýdanyň eýeleri ses bermedi: {площадь} m² ýetmeýär. Ses az wagty çözgüt kabul edilmez.',
  'poll.closed':
    'Ýygnak tamamlandy: {название}\n{итог}\nGatnaşyk: {участие}, tarapdar: jaýyň meýdanynyň {за}.',
  'poll.noQuorum': 'Kworum ýok, ýygnak bolmady.',
  'poll.passed': 'Çözgüt kabul edildi.',
  'poll.failed': 'Çözgüt kabul edilmedi.',
  'poll.voteReplaced':
    '«{название}» ýygnagy boýunça {квартира} kwartirasynyň sesini {кто} üýtgetdi: {ответ}.\n' +
    'Ýaşalýan jaýyň bir sesi bar, iň soňkusy hasaba alynýar.',
  'poll.choice.for': 'tarapdar',
  'poll.choice.against': 'garşy',
  'poll.choice.abstain': 'saklandy',
  'poll.elder':
    'Goňşular sizi {подъезд} girelgäniň ulusy edip saýladylar.\n' +
    'Girelgäniň umumy emlägi boýunça arzalar indi siziňki: olar size görünýär we işi siz kabul edýärsiňiz.',

  'pollRule.simple': 'Ýönekeý köplük',
  'pollRule.qualified': 'Hünärli köplük',

  'poll.tally.for': 'Tarapdar',
  'poll.tally.against': 'Garşy',
  'poll.tally.abstain': 'Saklandy',
  'poll.base.participants': 'ses berenlerden',
  'poll.base.building': 'ähli eýelerden',
  'poll.threshold.strict': '{доля} dan köp',
  'poll.threshold.plain': '{доля}',

  'poll.result.survey': 'Ýaşaýjylaryň sowalnamasy, ýygnagyň çözgüdi däl. Jogap berdiler: jaýyň meýdanynyň {участие}.',
  'poll.result.meeting': '{правило}. Gatnaşyk: jaýyň meýdanynyň {участие}.',
  'poll.result.quorum':
    'Heniz hemmesi ses bermedi: çözgüdiň kabul edilmegi üçin ýene {площадь} m² eýeleriniň sesi gerek.',
  'poll.result.share': '{ответ}: {доля}',
  'poll.result.needed': '{база} {порог} gerek, ýygnalany {набрано}.',
  'poll.result.mine': 'Kwartiranyň sesi: {ответ}.',
  'poll.result.mineBy': 'Kwartiranyň sesi: {ответ} ({кто} berdi, kwartiranyň bir sesi bar).',

  'protocol.title': 'Eýeleriň umumy ýygnagynyň teswirnamasy',
  'protocol.surveyTitle': 'Ýaşaýjylaryň sowalnamasynyň netijeleri',
  'protocol.number': '№ {номер}',
  'protocol.company': 'Dolandyryjy kompaniýa: {название}',
  'protocol.form': 'Görnüşi: ulgam arkaly gaýybana ses berişlik',
  'protocol.surveyForm': 'Dolandyryjy guramanyň sowalnamasy: umumy ýygnagyň çözgüdi däl',
  'protocol.notice': 'Ýygnak hakynda habar: {номер}',
  'protocol.initiator': 'Başlangyççy: {кто}',
  'protocol.surveyBy': 'Geçirdi: {кто}',
  'protocol.administrator': 'Ýygnagyň administratory: {кто}',
  'protocol.voting': 'Ses berişlik: {от} — {до} aralygynda',
  'protocol.agenda': 'Gün tertibiniň meselesi',
  'protocol.counting': 'Sesleri sanamak',
  'protocol.totalArea': 'Jaýlaryň umumy meýdany: {площадь} m²',
  'protocol.turnout': 'Gatnaşdy: {площадь} m² ({доля})',
  'protocol.quorumYes': 'Kworum: bar, {порог} dan köp talap edilýär',
  'protocol.quorumUnknown': 'Kworum: tassyklanmaýar, {сколько} jaýyň meýdany girizilmedik',
  'protocol.quorumNo': 'Kworum: ýok, {площадь} m² ýetmeýär',
  'protocol.line': '{ответ}: {площадь} m² ({доля})',
  'protocol.decision': 'Çözgüt',
  'protocol.rule': '{правило}: {база} {набрано}, bosaga {порог}.',
  'protocol.moreThan': '{доля} dan köp',
  'protocol.atLeast': '{доля} dan az däl',
  'protocol.noQuorum': 'Ýygnak bolmady: kworum ýok.',
  'protocol.formed': 'Teswirnama {дата} düzüldi',
  'protocol.surveyFormed': 'Netijeler {дата} jemlenildi',
  'protocol.attachments': 'Goşundylar: eýeleriň sanawy, eýeleriň çözgütleri, ýygnagy geçirmek hakynda habar.',
  'protocol.originals':
    'Çözgütleriň we teswirnamanyň asyl nusgalary dolandyryjy gurama, soňra bolsa döwlet ýaşaýyş jaý ' +
    'gözegçiligi edarasyna tabşyrylýar.',

  'initiative.proposed': 'Goňşy teklip edýär: {название}\n\n{описание}',
  'initiative.meetingCalled':
    'Siziň tekibiňiz boýunça ýygnak yglan edildi: {название}.\nSes aşakdaky düwme bilen berilýär.',
  'initiative.enough': 'Ýygnak talap etmek üçin gollar ýeterlik',
  'initiative.need': 'Ýygnagyň bellenmegi üçin ýene {площадь} m² eýeleriniň goly gerek',
  'initiative.signatures': 'Gollar: {сколько}.',

  'binding.neighbour':
    'Siziň {квартира} kwartiraňyza ýene bir ýaşaýjy birikdirildi: {кто}.\n' +
    'Eger bu siziň goňşyňyz bolmasa, dolandyryjy kompaniýa habar beriň.',
  'binding.bound':
    'Dolandyryjy kompaniýa sizi {квартира} kwartira birikdirdi.\n' +
    'Indi hasaplaýjynyň görkezmeleri we ýygnaklarda ses berişlik açyk.',
  'binding.unbound':
    'Dolandyryjy kompaniýa sizi {квартира} kwartiradan aýyrdy.\n' +
    'Eger bu ýalňyş bolsa, kwitansiýadaky kod bilen täzeden birikdiriň.',
  'binding.unboundPlain':
    'Dolandyryjy kompaniýa sizi kwartiradan aýyrdy.\n' +
    'Eger bu ýalňyş bolsa, kwitansiýadaky kod bilen täzeden birikdiriň.',

  'quality.short': 'Häzir açyk arzalar: {открыто}{просрочено}{срок}.',
  'quality.overdueShort': ', möhleti geçen {сколько}',
  'quality.rateShort': ', {дни} dowamynda möhletinde {доля}',
  'quality.title': 'Dolandyryjy kompaniýa {дни} dowamynda nähili işleýär:',
  'quality.titleAt': 'Dolandyryjy kompaniýa {дни} dowamynda nähili işleýär, {адрес}:',
  'quality.created': '  Berlen arzalar: {сколько}',
  'quality.closed': '  Ýapyldy: {сколько}',
  'quality.inTime': '  Möhletinde: {доля}',
  'quality.hours': '  Ortaça iş wagty: {часы} sag',
  'quality.hoursBefore': '  Ortaça iş wagty: {часы} sag, bir aý öň {раньше} sag',
  'quality.rating': '  Ýaşaýjylaryň bahasy: 5 balldan {оценка} ({сколько} adam baha berdi)',
  'quality.open': 'Häzir açyk arzalar: {сколько}',
  'quality.openOverdue': 'Häzir açyk arzalar: {сколько}, möhleti geçen {просрочено}',

  'clarify.where': 'Bu nirede boldy?',
  'clarify.whichFlat': 'Bu haýsy kwartirada boldy?',
  'clarify.flat': '{номер} kwartira',
  'clarify.entrance': '{номер} girelge',

  'device.snapshot': '{устройство}: {время} kadry',

  'visit.booked': 'Dolandyryjy gurama sizi kabul edişe ýazdy: {когда}.\n{тема}',
  'visit.cancelled': '{день} sagat {время} kabul ediş dolandyryjy gurama tarapyndan ýatyryldy.',

  'assistant.offTopic':
    'Men diňe jaý we şu goşundy boýunça kömek edýärin: arzalar, hasaplaýjylar, kwitansiýa, ýygnaklar, ' +
    'gapylar we dolandyryjy gurama soraglar. Galanlaryna dolandyryjy guramadan adam jogap berer.',
  'assistant.fallback':
    'Soragy düşünmedim. Bu ýerde döwük barada habar berip, görkezijileri tabşyryp, arzalary görüp ' +
    'we dolandyryjy gurama ýazyp bolýar.',
  'assistant.section': '{раздел}: {описание}.',
  'assistant.answerInQuestionLanguage': 'Sorag haýsy dilde berlen bolsa, şol dilde jogap ber.',
  'assistant.answerInLanguage':
    'Soragyň dili düşnüksiz bolsa, {язык} diýlip atlandyrylýan dilde jogap ber.',
  'assistant.reportLanguage':
    'language meýdanynda soragyň diliniň kodyny gaýtar, şulardan biri: {коды}.',
  'assistant.offerLanguage': 'Siziň bilen {язык} dilinde gepleşip bilerin: aşakdaky düwmä basyň.',
  'assistant.languageButton': '{язык} dilinde gepleşmek',

  'capability.new.title': 'Döwük barada habar bermek',
  'capability.new.about':
    'Näme döwlenini söz ýa-da surat bilen beýan etmek: önüm kategoriýany kesgitlär we möhleti aýdar',
  'capability.list.title': 'Meniň arzalarym',
  'capability.list.about':
    'Öz arzalaryňyzy görmek: ýagdaýy, möhleti, işi kim alyp barýar, we edileni kabul etmek',
  'capability.meters.title': 'Hasaplaýjylaryň görkezijileri',
  'capability.meters.about': 'Suw, elektrik we ýylylyk hasaplaýjylarynyň görkezijilerini tabşyrmak',
  'capability.bill.title': 'Kwitansiýa we töleg',
  'capability.bill.about': 'Aýlyk hasaplamany, bergini we jerimäni görmek we tölemek',
  'capability.home.title': 'Jaý: gapylar we kameralar',
  'capability.home.about':
    'Girelgäniň gapysyny ýa-da şlagbaumy açmak, kameranyň şekilini görmek, myhmana bir gezeklik kod bermek',
  'capability.news.title': 'Jaýyň bildirişleri',
  'capability.news.about':
    'Dolandyryjy guramanyň bildirişlerini okamak we meýilnamalaýyn işler barada bilmek',
  'capability.tour.title': 'Goşundy boýunça gezelenç',
  'capability.tour.about':
    'Bölümleriň gysga görkezilişinden geçmek: näme nirede ýerleşýär we nireden başlamaly',
  'capability.polls.title': 'Eýeleriň ýygnaklary',
  'capability.polls.about': 'Ýygnakda ses bermek, goňşynyň teklibini goldamak, teswirnamany okamak',
  'capability.support.title': 'Dolandyryjy gurama sorag',
  'capability.support.about':
    'Sorag bermek we ýazyşyk arkaly jogap almak, telefonlary we iş tertibini görmek',
  'capability.visits.title': 'Kabul edişe ýazylmak',
  'capability.visits.about': 'Dolandyryjy guramada boş kabul ediş sagadyny saýlamak',
  'capability.bind.title': 'Kwartirany birikdirmek',
  'capability.bind.about':
    'Hasaplaýjylar, kwitansiýa we ýygnakdaky ses açylar ýaly kwitansiýadaky kody girizmek',
  'capability.capital.title': 'Düýpli abatlaýyş',
  'capability.capital.about':
    'Tölegi, jaýyň ýygnanyny we sebit maksatnamasy boýunça iş ýyllaryny görmek',
  'capability.quality.title': 'Kompaniýa nähili işleýär',
  'capability.quality.about':
    'Näçe arzanyň möhletinde ýapylanyny we jaýda köplenç nämäniň döwülýänini görmek',
  'capability.language.title': 'Önümiň dili',
  'capability.language.about': 'Önümiň siziň bilen gepleşýän dilini saýlamak',
  'capability.profile.title': 'Profil we meniň maglumatlarym',
  'capability.profile.about': 'Telefon, habarnamalar, öz maglumatlaryňy ýüklemek we profili pozmak',
  'capability.stickers.title': 'Obýekt kodlary',
  'capability.stickers.about':
    'Girelgäniň, liftiň ýa-da kwartiranyň kody bolan ýelmeýän belgi almak',
};
