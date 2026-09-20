import type { Dictionary } from '../../translate.js';

/** Строки, которые продукт показывает человеку. Ключ не переводится, переводится значение. */
export const bot: Dictionary = {
  'greeting.hello': 'Bună ziua!',
  'greeting.resident':
    'Vă ajut cu blocul: să anunțați o defecțiune, să trimiteți cifrele de pe contoare,\n' +
    'să vedeți factura, să deschideți ușa de la scară.\n\n' +
    'Puteți scrie pur și simplu în cuvinte: «curge robinetul», «deschide ușa», «când se face curat la scară».',
  'start.code_unknown': 'Codul din link nu s-a potrivit: în bloc nu există un astfel de obiect.',

  'lang.chosen': 'Limba: {язык}.',

  'legal.ask':
    'Domovoy prelucrează datele cu caracter personal la cererea organizației de administrare a blocului.\n' +
    'Politica de prelucrare și acordul de utilizare, pe butoanele de mai jos.\n' +
    'Apăsând «Accept», sunteți de acord cu ele. Fără acord nu pot primi o sesizare ' +
    'și nu pot salva indicațiile.',
  'legal.accepted':
    'Ați acceptat redacția în vigoare.\nTextele complete se deschid pe butoane.',
  'legal.thanks': 'Mulțumesc. Cu ce vă ajut?',

  'flat.ask': 'Trimiteți codul apartamentului din factură: 8 semne lângă adresă.',
  'flat.unknown':
    'Încă nu știu în ce apartament sunteți.\n' +
    'În factură este tipărit un cod din 8 semne lângă adresă. Trimiteți-l într-un mesaj.',
  'flat.bound':
    'Gata. Acum știu că sunteți în apartamentul {номер}.\n' +
    'Puteți trimite cifrele de pe contoare, vedea factura și vota la adunările blocului.',
  'flat.already': 'Sunteți deja asociat apartamentului {номер}.',
  'flat.already_yours': 'Apartamentul {номер} este deja al dumneavoastră.',
  'flat.other_code':
    'Aveți deja un apartament asociat. Acest cod va asocia apartamentul {номер}. Îl asociem?',
  'flat.title': 'apartamentul {номер}',
  'flat.title_address': 'apartamentul {номер}, {адрес}',
  'flat.short': 'ap. {номер}',
  'flat.yours': '{квартира} dumneavoastră.',
  'flat.chosen': 'Este ales {квартира}: pe el merg indicațiile și factura.',
  'flat.used': 'Indicații și factură: {квартира}',
  'flat.used_plain': 'Apartament ales',
  'flat.not_bound': 'Apartamentul oricum nu este asociat',
  'flat.unbind_ask':
    'Dezasociem apartamentul? Sesizările și indicațiile rămân la bloc, îl puteți asocia din nou cu codul din factură.',
  'flat.unbound':
    'Apartamentul este dezasociat. Îl puteți asocia din nou cu codul din factură.',
  'flat.unbound_toast': 'Apartament dezasociat',

  'code.bad_letter':
    'În cod este o literă care nu apare în el. Literele asemănătoare cu cifrele nu intră în cod, ' +
    'uitați-vă încă o dată în factură.',
  'code.bad_length':
    'Codul nu s-a potrivit: trebuie să aibă {надо} semne, iar dumneavoastră ați trimis {прислали}. Scrieți-l din nou.',

  'sticker.other_house':
    'Codul de pe autocolant este de la alt bloc: nu deschid o sesizare pe el.',
  'object.ask': '{имя}, v-ați adresat despre obiectul: {объект}.',
  'object.known': 'Despre aceasta s-a anunțat deja: sesizarea {номер}, {состояние}.',
  'object.reporters': 'Anunțuri: {сколько}.',
  'object.same': 'Dacă problema este aceeași, descrieți-o și vă adaug la această sesizare.',
  'object.repaired': 'Ultima reparație: {дата}',
  'object.describe':
    'Descrieți într-un singur mesaj ce s-a întâmplat, iar sesizarea o întocmesc eu.',

  'request.new_ask':
    'Scrieți ce s-a întâmplat. De exemplu: la scara 2 nu arde becul.\n' +
    'Puteți trimite o fotografie.',
  'request.accepted': 'Sesizarea {номер} este primită.',
  'request.what': 'Ce: {что}, {где}.',
  'request.react': 'Răspundem până la {срок}.',
  'request.fix': 'Se repară până la {срок}.',
  'request.same': 'Este aceeași sesizare {номер}, nu deschid una nouă.',
  'request.joined': 'Despre o astfel de problemă s-a anunțat deja: sesizarea {номер}, {состояние}.',
  'request.joined_you':
    'Sunteți al {который}-lea care a scris despre aceasta. Se repară până la {срок}.',
  'request.notify': 'Vă anunț despre schimbări.',
  'request.planned': 'Sesizarea nu este necesară dacă este vorba despre aceste lucrări.',
  'request.optional': 'Puteți să nu răspundeți, sesizarea este deja primită.',
  'request.none': 'Deocamdată nu sunt sesizări.',
  'queue.resident':
    'Coada blocului este ținută de administrația blocului. Sesizările dumneavoastră sunt în secțiunea «Sesizările mele».',
  'request.mine_count': 'Sesizările dumneavoastră în lucru: {сколько}',
  'request.late': ', depășite {сколько}',
  'request.rest': 'Alte sesizări: {сколько}. Lista este în aplicație.',
  'request.all_open':
    'Aceasta este tot ce este în lucru. Sesizările închise se află în aplicație.',
  'request.not_found':
    'Nu aveți sesizarea {номер}. Scrieți ce s-a întâmplat și întocmesc una nouă.',
  'request.due': 'Termen: până la {срок}',
  'request.worker': 'Lucrarea este executată de {кто}',
  'request.answers': 'Răspunde: {кто}',
  'request.state': 'Sesizarea {номер}: {состояние}',
  'request.rating': ', nota dumneavoastră {оценка}',
  'request.rate_ask': 'Cum ați recepționat lucrarea?',
  'request.comment_sent': 'Am transmis pe sesizarea {номер}.',
  'request.answer_sent':
    'Am transmis pe sesizarea {номер}: tehnicianul va vedea răspunsul dumneavoastră.',
  'request.reply_ask': 'Scrieți răspunsul într-un singur mesaj, îl transmit pe această sesizare.',
  'request.back_to_work':
    'Sesizarea {номер} este din nou în lucru: am transmis cuvintele dumneavoastră tehnicianului.',
  'request.withdraw_ask':
    'Retragem sesizarea{номер}? Tehnicianul nu va veni pe ea, nu va putea fi readusă, va trebui întocmită una nouă.',
  'request.where_unknown':
    '{причина}. Scanați codul de la scară sau deschideți aplicația, acolo puteți alege adresa.',
  'request.where_skipped':
    'Bine, adresa o precizează tehnicianul la fața locului. Sesizarea este deja la echipa de serviciu.',
  'request.where_set': 'Am notat: {где}. Sesizarea {номер} este deja la echipa de serviciu.',
  'request.where_refused': 'Adresa nu a fost precizată',
  'request.same_here':
    'Am notat: la dumneavoastră este la fel. Sesizarea {номер}, vă anunț despre schimbări.',
  'request.same_counted':
    'Am notat: la dumneavoastră este la fel. Sesizarea {номер}, {сообщили}, vă anunț despre schimbări.',
  'request.answered_already': 'Ați răspuns deja pe sesizarea {номер}.',
  'request.fine':
    'Mulțumesc, am notat: cauza nu este în coloana comună, ci în apartamentul vecinului.',
  'request.closed_already': 'Mulțumesc. Pe această sesizare lucrările sunt deja încheiate.',

  'meters.prompt': '{прибор}, contorul {номер}.',
  'meters.previous': 'Indicația precedentă: {значение} din {дата}',
  'meters.send_number': 'Trimiteți indicația ca număr.',
  'meters.none':
    'Pe apartamentul dumneavoastră nu sunt înregistrate contoare. Dacă există, spuneți-i administrației blocului.',
  'meters.expired':
    'A expirat termenul de verificare a contorului: {приборы}.\n' +
    'Până nu este verificat nu pot primi indicațiile, iar pentru acest serviciu se calculează după norma medie.\n' +
    'Verificarea se comandă la administrația blocului.',
  'meters.done': 'Indicațiile pentru luna aceasta au fost deja transmise. Mulțumesc.',
  'meters.progress':
    'Indicații pentru luna aceasta: transmise {подано} din {всего}. Alegeți contorul.',
  'meters.accepted': 'Primit: {значение}.',
  'meters.consumption': 'Consumul pe perioadă: {расход}.',
  'meters.refused': 'Indicația nu este primită: {причина}',
  'meters.retry': 'Trimiteți numărul încă o dată.',
  'meters.next_window': 'Următoarea indicație o primim de pe {день}.',
  'meters.not_number':
    'Nu seamănă cu un număr. Trimiteți indicația în cifre, de exemplu 123,456',
  'meters.not_reading':
    'Aceasta nu seamănă cu o indicație. Trimiteți numărul de pe afișaj sau apăsați «Anulare».',
  'meters.heard':
    'Am auzit indicația {значение}. O transmitem?\nDacă nu este așa, trimiteți numărul în cifre.',
  'meters.from_photo':
    'În fotografie văd {значение}. Transmitem această indicație?\n' +
    'Dacă pe afișaj este alt număr, trimiteți-l într-un mesaj.',
  'meters.no_vision':
    'Indicația din fotografie nu se citește aici. Trimiteți-o ca număr, de exemplu 123,456',
  'meters.photo_aim':
    'Fotografiați afișajul cu cifrele sau trimiteți indicația ca număr, de exemplu 123,456',
  'meters.photo_number': 'Trimiteți indicația ca număr, de exemplu 123,456',
  'meters.photo_unreadable':
    'Cifrele din imagine nu se deslușesc. Fotografiați afișajul mai de aproape, fără reflexe și înclinare, ' +
    'sau trimiteți indicația ca număr, de exemplu 123,456',
  'meters.no_others': 'Nu mai sunt alte contoare fără indicații.',
  'meters.exact':
    'Indicația trebuie să fie exactă: «aproximativ» și «circa» nu sunt bune pentru calcul. ' +
    'Uitați-vă pe afișaj, alegeți contorul și trimiteți numărul întreg, de exemplu 123,456',
  'meters.no_such':
    'Pe apartamentul dumneavoastră nu este înregistrat un contor de acest fel. Lista contoarelor se deschide cu butonul de mai jos.',
  'meters.need_flat':
    'Indicațiile se primesc pe apartament: mai întâi asociați-l cu codul din factură.',
  'meters.which':
    'Indicația {значение}: aveți mai multe contoare de acest fel. Alegeți al cui este.',
  'meters.which_value': 'Seamănă cu indicația {значение}. Al cărui contor este?',

  'bill.empty': 'Pentru luna aceasta încă nu sunt sume calculate.',
  'bill.total': 'De achitat {сумма} până la {срок}',
  'bill.paid': 'Calculat {сумма}, pentru luna aceasta totul este achitat',
  'bill.where': 'Din ce s-a format și pentru ce, vedeți în aplicație.',
  'pay.month_ask': 'Achităm {сумма} pentru lună?',
  'pay.month_done': 'Achitat {сумма}. Factura vine în aplicație.',
  'pay.debt_ask': 'Stingem datoria pentru lunile trecute {сумма}?',
  'pay.debt_done': 'Datoria este stinsă: {сумма} pentru {месяцы}.',

  'door.none':
    'Interfonul nu este conectat la bloc. Administrația blocului îl va adăuga în aplicație.',
  'door.what': 'Ce deschidem?',
  'door.what_cameras': 'Ce deschidem sau ce vedem?',
  'door.opened': '{дверь}: deschis.',
  'door.snapshot': '{камера}: cadrul este trimis',
  'door.no_snapshot': 'Cadrul nu a venit',
  'door.guest_code':
    'Codul pentru oaspete: {код}\n' +
    'Să îl formeze la interfonul de la scară. Codul funcționează astăzi până la {время}.',

  'news.title': 'Anunțurile administrației blocului:',
  'news.empty':
    'Deocamdată nu sunt anunțuri.\n' +
    'Aici vor apărea mesajele administrației blocului: opriri de apă, curățenie, reparații.',
  'news.all': 'Acestea sunt toate anunțurile.',
  'news.underway': 'au loc acum',
  'news.rest_in_app': 'Restul citiți în aplicație.',

  'neighbours.title': 'Sesizările vecinilor',
  'neighbours.empty':
    'Vecinii nu au anunțat încă nimic.\n' +
    'Aici vor apărea defecțiunile de la scară și din curte despre care au scris vecinii: pot fi confirmate.',
  'neighbours.about':
    'Vecinii au anunțat despre {сколько}. ' +
    'În aplicație se vede ce și unde și puteți confirma că la dumneavoastră este la fel.',

  'vote.title': 'Adunările proprietarilor',
  'vote.none':
    'Acum nu sunt adunări deschise.\n' +
    'Aici vor apărea adunările proprietarilor: decizia se socotește după suprafața apartamentelor.',
  'vote.open': 'Adunări deschise: {сколько}',
  'vote.initiatives': 'propuneri ale vecinilor: {сколько}',
  'vote.protocol_in_app': 'Procesul-verbal integral este în aplicație.',
  'vote.abstain': 'Nu vreau să decid',
  'vote.counted': 'Adunarea «{собрание}». Votul apartamentului: {ответ}.',
  'vote.refused': 'Votul nu este primit',
  'sign.refused': 'Semnătura nu este primită',

  'support.ask':
    'Scrieți întrebarea într-un singur mesaj, o transmit administrației blocului.',
  'support.ask_more':
    'Întrebarea nouă scrieți-o într-un singur mesaj, iar la cea veche răspundeți cu butonul.',
  'support.taken': 'Întrebarea este primită: «{тема}». Răspunsul vine aici.',
  'support.sent': 'Am transmis organizației de administrare. Răspunsul vine aici.',
  'support.reply_ask': 'Scrieți un mesaj pe această solicitare.',
  'support.all': 'Acestea sunt toate solicitările.',
  'support.more': 'Alte solicitări mai jos.',
  'contacts.tail': 'Celelalte contacte sunt în aplicație.',

  'gzhi.none':
    'Pe sesizările dumneavoastră nu sunt termene încălcate, nu este cu ce să vă adresați.',
  'gzhi.reason':
    'Pe sesizarea {номер} există temei pentru o plângere: {основание}.\nTextul plângerii:',
  'gzhi.reason_short': 'Temei: {основание}.\nTextul plângerii:',
  'gzhi.sent_already':
    'Plângerea pe sesizarea {номер} a fost deja trimisă: {организация}.',
  'gzhi.sent_before': 'Plângerea pe această sesizare a fost deja trimisă: {организация}.',
  'gzhi.number': 'Numărul {номер}.',
  'gzhi.number_full': 'Numărul plângerii {номер}.',
  'gzhi.confirm': 'Trimitem această plângere la inspecția de locuințe? Nu va putea fi retrasă.',
  'gzhi.sent': 'Plângerea a fost trimisă: {организация}.',
  'gzhi.answer_days': 'Răspunsul vine aici, pentru el sunt 30 de zile.',
  'gzhi.no_ground': 'Pe această sesizare nu sunt temeiuri pentru o plângere.',

  'visit.in_chat': 'Vă puteți programa la audiență în corespondența privată cu mine.',
  'visit.mine': 'Sunteți programat la audiență: {когда}',
  'visit.booked': 'V-am programat la audiență, {когда}',
  'visit.not_booked': 'Nu v-am programat: {причина}',
  'visit.cancelled': 'Programarea la audiență este anulată.',
  'visit.not_cancelled': 'Programarea nu s-a anulat',
  'visit.not_opened': 'Programarea nu s-a deschis',
  'visit.no_reception':
    'Audiențele cu programare nu se țin. Scrieți administrației blocului, răspunde echipa de serviciu.',
  'visit.no_slots': 'Nu sunt ore libere în următoarele două săptămâni.',
  'visit.title': 'Audiență cu programare',
  'visit.title_office': 'Audiență: {офис}',
  'visit.free': 'Ore libere: {сколько}. Ora se alege în aplicație.',
  'visit.topic_ask': 'Cu ce veniți? Scrieți într-un rând.',
  'visit.taken': 'Această oră a fost ocupată. Alegeți alta.',
  'visit.taken_none': 'Această oră a fost ocupată, libere deocamdată nu sunt.',

  'data.about': '{кто}.\nPăstrez despre dumneavoastră: {что}.',
  'data.file': 'Datele dumneavoastră ca fișier. {сводка}',
  'data.file_failed':
    'Fișierul nu a putut fi trimis. Aceleași date se văd în aplicație.',
  'forget.ask':
    'Ștergem profilul? Numele se șterge, apartamentul se dezasociază, notificările nu mai vin. ' +
    'Sesizările, indicațiile și voturile rămân la bloc, fără nume.',
  'forget.done':
    'Profilul este șters. Dacă aveți nevoie de mine din nou, scrieți-mi: deschid unul nou.',
  'notice.on': 'Voi trimite din nou: {что}.',
  'notice.off':
    'Nu mai trimit: {что}. Despre avarii și despre sesizările dumneavoastră vă anunț oricum.',
  'notice.such': 'astfel de notificări',

  'talk.start':
    'Întrebați despre bloc și despre cum se face ceva. Răspund și deschid secțiunea potrivită.\n' +
    'Puteți întreba în continuare, conversația se încheie cu butonul.',
  'talk.more': 'Mai întrebați și vă răspund. Sau încheiați conversația.',
  'help.bind':
    'Pentru a începe, trimiteți codul apartamentului din factură: 8 semne lângă adresă.\n' +
    'După asociere aici vor fi sesizările, indicațiile, factura și ușile de la scară.',

  'dialog.describe': 'Descrieți în cuvinte ce s-a întâmplat. Merg fotografia și fișierul.',
  'dialog.photo_ask': 'Ce este în imagine? Scrieți în cuvinte.',
  'dialog.one_line': 'Scrieți într-un rând ce s-a întâmplat.',
  'dialog.unknown_attachment':
    'Un astfel de atașament nu îl pot desluși. Scrieți în cuvinte sau trimiteți o fotografie ori un fișier.',
  'dialog.need_text': 'Aici este nevoie de text: scrieți răspunsul într-un mesaj.',
  'dialog.forgot':
    'Nu îmi amintesc despre ce era solicitarea. Scrieți încă o dată ce s-a întâmplat.',
  'dialog.cancelled': 'Am anulat. Ce trebuie făcut?',
  'dialog.cancelled_toast': 'Am anulat',

  'voice.not_heard':
    'Nu am deslușit mesajul vocal: liniște, zgomot sau o limbă necunoscută. Spuneți încă o dată sau scrieți în cuvinte.',
  'voice.failed': 'Transcrierea nu răspunde acum. Scrieți în cuvinte.',
  'voice.unheard':
    'Nu am deslușit mesajul vocal. Scrieți într-un rând ce s-a întâmplat.',
  'thinking.default': 'Mă gândesc…',
  'thinking.voice': 'Transcriu…',
  'thinking.photo': 'Mă uit la imagine…',

  'emergency.call': 'Dacă este o avarie, sunați non-stop: {телефон}.',
  'app.install': 'Deschideți mini-aplicația «Domovoy» în MAX.',

  'error.retry': 'Nu a reușit. Apăsați încă o dată sau alegeți din meniu.',
  'error.message': 'Mesajul nu a putut fi prelucrat. Încercați din nou sau alegeți din meniu.',
  'error.toast': 'Nu a reușit. Încercați din nou',
  'error.failed': 'Nu a reușit: {причина}',
  'error.failed_short': 'Nu a reușit',
  'command.unknown':
    'Nu am o astfel de comandă. Puteți scrie în cuvinte ce vă trebuie, înțeleg.',

  'menu.title': 'Domovoy',
  'menu.words':
    'Puteți scrie în cuvinte: «deschide ușa», «cât am de plată», «curge robinetul».',
  'menu.in_chat': 'Meniul se deschide în corespondența cu mine.',
  'menu.new': '✍️ Ce s-a stricat',
  'menu.my': '📋 Sesizările mele',
  'menu.door': '🚪 Uși și camere',
  'menu.bill': '🧾 Cât am de plată',
  'menu.meters': '💧 Contoare',
  'menu.news': '📣 Anunțuri',
  'menu.vote': '🗳 Adunări',
  'menu.vote.about':
    'Vot la fiecare întrebare, socoteala după cotele de suprafață și procesul-verbal la final.',
  'menu.neighbours': '👥 Sesizările vecinilor',
  'menu.neighbours.about':
    'Despre ce au anunțat deja vecinii: puteți confirma că la dumneavoastră este la fel.',
  'menu.house': '📊 Munca administrației',
  'menu.capital': '🏗 Reparație capitală',
  'menu.capital.about':
    'Contribuția, suma acumulată de bloc și anii lucrărilor din programul regional.',
  'menu.support': '✉️ Întrebare administrației',
  'menu.visit': '🗓 Audiență la birou',
  'menu.visit.about':
    'Ore libere cu două săptămâni înainte, programarea proprie și anularea ei.',
  'menu.contacts': '☎️ Contacte',
  'menu.flat': '🏢 Apartament',
  'menu.mydata': '🗂 Datele mele',
  'menu.notices': '🔔 Notificări',
  'menu.notices.about':
    'Ce să trimit și despre ce să tac. Tot acolo sunt telefonul și descărcarea datelor proprii.',
  'menu.lang': '🌐 Limba',
  'menu.group.money': '💳 Bani și contoare',
  'menu.group.money.about':
    'Cât aveți de plată luna aceasta și unde să trimiteți cifrele de pe contoare.',
  'menu.group.house': '📣 Noutățile blocului',
  'menu.group.house.about':
    'Anunțurile administrației blocului, adunările vecinilor și lucrul pe bloc.',
  'menu.group.me': '☎️ Legătură și profil',
  'menu.group.me.about':
    'Cum luați legătura cu administrația blocului și ce știe produsul despre dumneavoastră.',
  'menu.demo': '👥 Rol',

  'menu.group.home': '🏡 Apartamentul meu',
  'menu.group.home.about':
    'Facturile, contoarele și sesizările dumneavoastră pe apartamentul propriu.',
  'menu.group.bind.about':
    'Dacă locuiți în acest bloc, asociați apartamentul cu codul din factură.',
  'menu.home.new': '✍️ Sesizare nouă',
  'menu.home.meters': '💧 Indicații',
  'menu.home.bill': '🧾 Factură',
  'menu.home.flat': '🏢 Apartamentul meu',
  'menu.home.visit.about': 'Ore libere, programarea proprie și anularea ei.',

  'menu.contractor.my': '📋 Comenzi de lucru',
  'menu.group.works': '🏢 Treburile blocului',
  'menu.group.contractor.about':
    'Legătura cu administrația blocului, anunțurile și ușile de la scări.',
  'menu.group.works.about':
    'Cum respectă blocul termenele, datoriile, adunările și ușile de la scări.',

  'menu.staff.queue': '🗂 Coada blocului',
  'menu.staff.my': '📋 Comenzile mele',
  'menu.staff.duty': '🌙 Serviciu',
  'menu.staff.support': '💬 Întrebările locatarilor',
  'menu.staff.visit': '🗓 Audiența locatarilor',
  'menu.staff.visit.about':
    'Orele de audiență, programările locatarilor, marcarea prezenței și programarea celui venit fără programare.',
  'menu.staff.broadcast': '✉️ Difuzare',
  'menu.staff.report': '📊 Sinteza lunii',
  'menu.staff.debts': '💰 Datoriile blocului',
  'menu.staff.vote.about':
    'Anunțarea unei adunări, urmărirea cvorumului și întocmirea procesului-verbal la final.',
  'menu.staff.inspections': '🔍 Inspecții',
  'menu.staff.inspections.about':
    'Rond după listă de control: punctele se bifează la fața locului, ce se găsește devine imediat sesizare.',
  'menu.staff.plan': '🗺 Planul blocului',
  'menu.staff.plan.about': 'Scările și coloanele cu semne unde s-a anunțat o problemă.',
  'menu.staff.equipment': '🛗 Echipamente',
  'menu.staff.equipment.about':
    'Ce se defectează mai des și ce va cere reparație în curând.',
  'menu.staff.house_meters': '💧 Nod de evidență',
  'menu.staff.house_meters.about':
    'Consumul comun al blocului pe luni, tot acolo se introduc indicațiile.',
  'menu.staff.residents': '👥 Oamenii blocului',
  'menu.staff.residents.about':
    'Cine este în tură, cine este de serviciu, cine ce rol are, asocierea apartamentului unui locatar.',
  'menu.staff.stickers': '🏷 Autocolante',
  'menu.staff.tariffs': '💵 Tarife',
  'menu.staff.tariffs.about': 'Cotele din care se formează factura blocului.',
  'menu.staff.card': '🏠 Fișa blocului',
  'menu.staff.card.about':
    'Contacte, ore de audiență, apartamente și echipamentele blocului.',
  'menu.staff.buildings': '🏘 Blocurile administrației',
  'menu.staff.buildings.about':
    'Toate adresele administrației: comutați sau adăugați una nouă.',
  'menu.staff.audit': '📜 Jurnalul acțiunilor',
  'menu.staff.audit.about':
    'Cine și ce a făcut pe bloc: sesizări, roluri, indicații, difuzări.',
  'menu.group.people': '💬 Locatari',
  'menu.group.people.about':
    'Întrebările locatarilor, audiența cu programare și mesajele către bloc.',
  'menu.group.staff_me.about':
    'Apartamentul propriu, datele, notificările și legătura cu administrația blocului ca locatar.',
  'menu.group.app': '📱 În aplicație',
  'menu.group.app.about':
    'Ecrane care nu se citesc în corespondență: ronduri, planul blocului, aparate.',
  'menu.group.manage': '🗄 Administrarea blocului',
  'menu.group.manage.about':
    'Tarife, fișa blocului, adresele administrației și jurnalul acțiunilor.',

  'topic.bill': '🧾 Factura lunii',
  'topic.request': '📋 Sesizări',
  'topic.news': '📣 Anunțuri',

  'action.accepted': '✅ Preiau',
  'action.in_progress': '🔧 În lucru',
  'action.needs_info': '❓ De precizat',
  'action.done': '🏁 Predau lucrarea',
  'action.confirmed': '✅ Totul e făcut, mulțumesc',
  'action.rejected': '⛔ Resping',
  'action.withdrawn': '✖️ Retrag sesizarea',
  'action.return': '↩️ Nefăcut, înapoi',
  'action.close': '✅ Închid sesizarea',
  'action.answer': '💬 Răspund',

  'comment.in_progress':
    'Ce anume nu este făcut? Scrieți într-un singur mesaj, transmit tehnicianului.',
  'comment.needs_info':
    'Ce trebuie precizat cu locatarul? Scrieți întrebarea într-un singur mesaj.',
  'comment.rejected': 'De ce se respinge sesizarea? Motivul îl vede locatarul.',
  'comment.done': 'Ce s-a făcut? Scrieți scurt, nota o vede locatarul.',
  'comment.confirmed':
    'Cine a recepționat lucrarea? Scrieți într-un singur mesaj, notez în istoricul sesizării.',
  'comment.other': 'Descrieți motivul într-un singur mesaj.',

  'doing.understood': 'Am înțeles: {что}',
  'doing.which': 'Pe care sesizare?',
  'doing.confirm': 'Facem?',
  'doing.write_as': 'Notăm ca «{что}»?',
  'doing.written': 'Am notat: {что}',
  'doing.gone': 'Această treabă este deja făcută sau anulată.',
  'doing.assign': 'repartizarea comenzii de lucru',
  'doing.accepted': 'preluarea sesizării în lucru',
  'doing.in_progress': 'luarea comenzii de lucru în lucru',
  'doing.return': 'întoarcerea lucrării la tehnician',
  'doing.needs_info': 'cererea unei precizări de la locatar',
  'doing.done': 'predarea lucrării',
  'doing.confirmed': 'recepția lucrării',
  'doing.rejected': 'respingerea sesizării',
  'doing.withdrawn': 'retragerea sesizării',
  'doing.change': 'modificarea sesizării',

  'button.menu': '🏠 Meniu',
  'button.back': '⬅️ Înapoi',
  'button.cancel': '✖️ Anulare',
  'button.open_app': '📱 Deschide aplicația',
  'button.in_app': 'Deschide în aplicație',
  'button.in_app_short': 'În aplicație',
  'button.show': 'Vezi',
  'button.more': '⬇️ Încă',
  'button.more_news': '⬇️ Încă anunțuri',
  'button.new_request': '✍️ Întocmesc sesizare',
  'button.also_me': '🙋 Și la mine',
  'button.works': '👌 Totul merge',
  'button.accept_legal': '✅ Accept',
  'button.legal_in_app': 'Documentele în aplicație',
  'button.flat': '🏢 Apartament',
  'button.meters': '💧 Contoare',
  'button.support': '✉️ Întrebare administrației',
  'button.write_company': '✉️ Scriu administrației',
  'button.bill_in_app': 'Factura în aplicație',
  'button.requests_in_app': 'Sesizările în aplicație',
  'button.polls_in_app': 'Adunările în aplicație',
  'button.quality_in_app': 'Munca blocului în aplicație',
  'button.vote': 'Votez',
  'button.visit_choose': 'Aleg ora',
  'button.other_days': 'Alte zile în aplicație',
  'button.cancel_visit': '✖️ Anulez programarea',
  'button.pay_month': '💳 Pe lună {сумма}',
  'button.pay_month_yes': '💳 Da, achit {сумма}',
  'button.pay_debt': '💰 Datorie veche {сумма}',
  'button.pay_debt_yes': '💰 Da, sting {сумма}',
  'button.guest_code': '🔑 Cod pentru oaspete',
  'button.copy_code': 'Copiez codul',
  'button.reply_request': '💬 Scriu pe sesizare',
  'button.answer_ticket': '💬 Răspund pe solicitare',
  'button.unbind': '🏢 Dezasociez apartamentul',
  'button.unbind_yes': '🚪 Da, dezasociez',
  'button.bind_yes': '🏢 Da, asociez',
  'button.export': '📄 Trimite ca fișier',
  'button.notices': '🔔 Notificări',
  'button.mute': '🔕 Notificări',
  'button.forget': '🗑 Ștergeți-mă',
  'button.forget_yes': '🗑 Da, ștergeți',
  'button.submit_reading': '✅ Da, transmit',
  'button.skip_meter': '⏭ Omit',
  'button.to_meters': '💧 La lista contoarelor',
  'button.rate_none': 'Recepționez fără notă',
  'button.end_talk': '✖️ Închei conversația',
  'button.where_unknown': '🤷 Nu știu unde anume',
  'button.withdraw_yes': '✖️ Da, retrag',
  'button.complaint': '📨 Trimit la inspecție',
  'button.gzhi': '📄 Mă plâng la inspecție',
  'button.send_meters': '💧 Trimit indicațiile',
  'button.complaint_yes': '📨 Da, trimit',
  'button.sign': '🙋 Susțin',
  'button.none_of': '✖️ Pe niciuna',
  'button.stale': 'Acest buton nu mai funcționează',
  'button.stale_more': 'Acest buton este dintr-un mesaj vechi. Iată de unde puteți începe.',
};
