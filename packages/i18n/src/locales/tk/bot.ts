import type { Dictionary } from '../../translate.js';

/** Строки, которые продукт показывает человеку. Ключ не переводится, переводится значение. */
export const bot: Dictionary = {
  'greeting.hello': 'Salam!',
  'greeting.resident': 'Jaý boýunça kömek ederin. Menýudan saýlaň ýa-da ýazyň: «kran akýar», «gapyny aç».',
  'start.code_unknown': 'Salgydaky kod gabat gelmedi: jaýda beýle obýekt ýok.',

  'lang.chosen': 'Dil: {язык}.',

  'legal.ask':
    'Domovoy şahsy maglumatlary dolandyryjy kompaniýanyň tabşyrygy boýunça işleýär.\n' +
    'Razylyk bolmasa, ne arzany, ne görkezijileri kabul edip bilerin.',
  'legal.accepted': 'Siz häzirki redaksiýa bilen ylalaşdyňyz.\nDoly tekstler düwmeler arkaly açylýar.',
  'legal.thanks': 'Sag boluň. Näme kömek gerek?',

  'flat.ask': 'Kwitansiýadaky kwartira kodyny iberiň: salgynyň ýanyndaky 8 belgi.',
  'flat.unknown':
    'Men siziň haýsy kwartiradadygyňyzy heniz bilemok.\n' +
    'Kwitansiýada salgynyň ýanynda 8 belgili kod çap edilen. Ony habar bilen iberiň.',
  'flat.bound': 'Taýýar, {номер} kwartira.',
  'flat.already': 'Siz eýýäm {номер} kwartira birikdirilen.',
  'flat.already_yours': '{номер} kwartira eýýäm siziňki.',
  'flat.other_code':
    'Sizde kwartira eýýäm birikdirilen. Bu kod {номер} kwartirany birikdirer. Ony birikdirmelimi?',
  'flat.title': '{номер} kwartira',
  'flat.title_address': '{номер} kwartira, {адрес}',
  'flat.short': '{номер} kw.',
  'flat.yours': 'Siziň {квартира}.',
  'flat.chosen': '{квартира} saýlandy: görkezijiler we kwitansiýa şonuň boýunça geçýär.',
  'flat.used': 'Görkezijiler we kwitansiýa: {квартира}',
  'flat.used_plain': 'Kwartira saýlandy',
  'flat.not_bound': 'Kwartira onsuzam birikdirilen däl',
  'flat.unbind_ask':
    'Kwartirany aýyrmalymy? Arzalar we görkezijiler jaýda galar, kwitansiýadaky kod bilen ýene birikdirip bolýar.',
  'flat.unbound': 'Kwartira aýryldy. Kwitansiýadaky kod bilen ýene birikdirip bolýar.',
  'flat.unbound_toast': 'Kwartira aýryldy',

  'code.bad_letter':
    'Kodda onda bolmaýan harp bar. Sanlara meňzeş harplar koda düşmeýär, ' +
    'ony kwitansiýada ýene bir gezek serediň.',
  'code.bad_length':
    'Kod gabat gelmedi: onda {надо} belgi bolmaly, siz bolsa {прислали} iberdiňiz. Ony täzeden ýygyň.',

  'sticker.other_house': 'Ýelmeýän belgidäki kod başga jaýdan: onuň boýunça arza açmaryn.',
  'object.ask': '{имя}, siz {объект} obýekti boýunça ýüz tutduňyz.',
  'object.known': 'Bu barada eýýäm habar berildi: arza {номер}, {состояние}.',
  'object.reporters': 'Ýüz tutmalar: {сколько}.',
  'object.same': 'Mesele şol bir bolsa, ony ýazaýyň, men sizi şu arza goşaryn.',
  'object.repaired': 'Soňky abatlaýyş: {дата}',
  'object.describe': 'Näme bolanyny bir habarda ýazyň, arzany özüm resmileşdirerin.',

  'request.new_ask':
    'Näme bolanyny ýazyň. Mysal üçin: 2-nji girelgede lampa ýanmaýar.\n' +
    'Surat iberip bolýar.',
  'request.accepted': 'Arza {номер} kabul edildi.',
  'request.what': 'Näme: {что}, {где}.',
  'request.react': '{срок} möhletine çenli jogap bereris.',
  'request.fix': '{срок} möhletine çenli bejererler.',
  'request.same': 'Bu şol bir arza {номер}, täzesini açamok.',
  'request.joined': 'Beýle mesele barada eýýäm habar berildi: arza {номер}, {состояние}.',
  'request.joined_you':
    'Bu barada eýýäm {который} adam ýazdy, olaryň biri siz. {срок} möhletine çenli bejererler.',
  'request.notify': 'Üýtgeşmeler barada habar bererin.',
  'request.planned': 'Şu işler sebäpli bolsa, arza gerek däl.',
  'request.optional': 'Jogap bermeseňiz hem bolýar, arza eýýäm kabul edildi.',
  'request.none': 'Arza heniz ýok.',
  'queue.resident':
    'Jaýyň nobatyny dolandyryjy kompaniýa alyp barýar. Siziň arzalaryňyz «Meniň arzalarym» böleginde.',
  'request.mine_count': 'Işdäki arzalaryňyz: {сколько}',
  'request.late': ', möhleti geçen {сколько}',
  'request.rest': 'Ýene arzalar: {сколько}. Sanaw goşundyda.',
  'request.all_open': 'Işde şular bar. Ýapylan arzalar goşundyda dur.',
  'request.not_found': 'Sizde {номер} arza ýok. Näme bolanyny ýazyň, täzesini resmileşdirerin.',
  'request.due': 'Möhleti: {срок}',
  'request.worker': 'Işi {кто} alyp barýar',
  'request.answers': 'Jogap berýän: {кто}',
  'request.state': 'Arza {номер}: {состояние}',
  'request.rating': ', siziň bahaňyz {оценка}',
  'request.rate_ask': 'Iş nähili kabul edildi?',
  'request.comment_sent': '{номер} arza boýunça ýetirdim.',
  'request.answer_sent': '{номер} arza boýunça ýetirdim: ussa siziň jogabyňyzy görer.',
  'request.reply_ask': 'Jogaby bir habarda ýazyň, şu arza boýunça ýetirerin.',
  'request.back_to_work': 'Arza {номер} ýene işde: siziň sözleriňizi ussa ýetirdim.',
  'request.withdraw_ask':
    'Arzany yzyna almalymy? Ussa onuň boýunça gelmez, ony gaýtaryp bolmaz, täzesini resmileşdirmeli bolar.',
  'request.withdraw_ask_number':
    'Arzany {номер} yzyna almalymy? Ussa onuň boýunça gelmez, ony gaýtaryp bolmaz, täzesini resmileşdirmeli bolar.',
  'request.where_unknown':
    '{причина}. Girelgedäki kody skanirläň ýa-da goşundyny açyň, ol ýerde salgyny saýlap bolýar.',
  'request.where_skipped': 'Bolýar, salgyny ussa ýerinde takyklar. Arza eýýäm nobatçy toparda.',
  'request.where_set': 'Ýazdym: {где}. Arza {номер} eýýäm nobatçy toparda.',
  'request.where_refused': 'Salgy takyklanmady',
  'request.same_here': 'Ýazdym: sizde-de şonuň ýaly. Arza {номер}, üýtgeşmeler barada habar bererin.',
  'request.same_counted':
    'Ýazdym: sizde-de şonuň ýaly. Arza {номер}, {сообщили}, üýtgeşmeler barada habar bererin.',
  'request.answered_already': 'Siz {номер} arza boýunça eýýäm jogap beripdiňiz.',
  'request.fine': 'Sag boluň, ýazdym: sebäbi umumy stoýakda däl-de, goňşynyň kwartirasynda.',
  'request.closed_already': 'Sag boluň. Şu arza boýunça işler eýýäm tamamlandy.',

  'meters.prompt': '{прибор}, hasaplaýjy {номер}.',
  'meters.previous': 'Öňki görkeziji: {значение}, {дата}',
  'meters.send_number': 'Görkezijini san bilen iberiň.',
  'meters.none':
    'Siziň kwartiraňyz boýunça hasaplaýjy ýazylmandyr. Olar bar bolsa, dolandyryjy kompaniýa habar beriň.',
  'meters.expired':
    'Hasaplaýjynyň barlag möhleti gutardy: {приборы}.\n' +
    'Ol barlanýança görkezijileri kabul edip bilmeýärin, bu hyzmat üçin ortaça kada boýunça hasaplanýar.\n' +
    'Barlagy dolandyryjy kompaniýadan sargap bolýar.',
  'meters.done': 'Bu aý üçin görkezijiler eýýäm tabşyryldy. Sag boluň.',
  'meters.progress':
    'Bu aý üçin görkezijiler: {всего} sanyndan {подано} tabşyryldy. Hasaplaýjyny saýlaň.',
  'meters.accepted': 'Kabul edildi: {значение}.',
  'meters.consumption': 'Döwürdäki sarp: {расход}.',
  'meters.refused': 'Görkeziji kabul edilmedi: {причина}',
  'meters.retry': 'Sany ýene bir gezek iberiň.',
  'meters.next_window': 'Indiki görkezijini aýyň {день} güninden kabul ederis.',
  'meters.not_number': 'Bu sana meňzänok. Görkezijini sanlar bilen iberiň, mysal üçin 123,456',
  'meters.not_reading':
    'Bu görkezijä meňzänok. Tablodaky sany iberiň ýa-da «Ýatyrmak» düwmesine basyň.',
  'meters.heard':
    '{значение} görkezijini eşitdim. Ony tabşyrmalymy?\nBeýle däl bolsa, sany sanlar bilen iberiň.',
  'meters.from_photo':
    'Suratda {значение} görýärin. Şu görkezijini tabşyrmalymy?\n' +
    'Tabloda başga san bolsa, ony habar bilen iberiň.',
  'meters.no_vision':
    'Suratdan görkeziji bu ýerde okalanok. Ony san bilen iberiň, mysal üçin 123,456',
  'meters.photo_aim':
    'Sanly tablony surata alyň ýa-da görkezijini san bilen iberiň, mysal üçin 123,456',
  'meters.photo_number': 'Görkezijini san bilen iberiň, mysal üçin 123,456',
  'meters.photo_unreadable':
    'Suratdaky sanlar saýgarylanok. Tablony ýakyndan, şöhlesiz we gyşartmazdan surata alyň, ' +
    'ýa-da görkezijini san bilen iberiň, mysal üçin 123,456',
  'meters.no_others': 'Görkezijisi tabşyrylmadyk başga enjam ýok.',
  'meters.exact':
    'Görkeziji takyk bolmaly: «takmynan» we «çemesi» hasaplama üçin ýaramaýar. ' +
    'Tabla serediň, hasaplaýjyny saýlaň we sany bütinleý iberiň, mysal üçin 123,456',
  'meters.no_such':
    'Siziň kwartiraňyz boýunça beýle görnüşli hasaplaýjy ýazylmandyr. Enjamlaryň sanawy aşakdaky düwme bilen açylýar.',
  'meters.need_flat':
    'Görkezijiler kwartira boýunça kabul edilýär: ilki ony kwitansiýadaky kod bilen birikdiriň.',
  'meters.which':
    'Görkeziji {значение}: sizde beýle görnüşli hasaplaýjy birnäçe. Haýsynyňkydygyny saýlaň.',
  'meters.which_value': '{значение} görkezijä meňzeýär. Bu haýsy hasaplaýjynyňky?',

  'bill.empty': 'Bu aý üçin hasaplama heniz ýok.',
  'bill.total': '{срок} möhletine çenli {сумма} tölemeli',
  'bill.paid': 'Hasaplandy {сумма}, bu aý üçin hemmesi tölendi',
  'bill.where': 'Nämeden düzülenini we näme üçindigini goşundyda görüň.',
  'pay.month_ask': 'Aý üçin {сумма} tölemelimi?',
  'pay.month_done': 'Tölendi {сумма}. Kwitansiýa goşunda geler.',
  'pay.debt_ask': 'Geçen aýlaryň bergisini {сумма} üzmelimi?',
  'pay.debt_done': 'Bergi üzüldi: {месяцы} üçin {сумма}.',

  'door.none': 'Domofon jaýa birikdirilmedik. Dolandyryjy kompaniýa ony goşundyda goşar.',
  'door.what': 'Nämäni açmaly?',
  'door.what_cameras': 'Nämäni açmaly ýa-da görmeli?',
  'door.opened': '{дверь}: açyldy.',
  'door.snapshot': '{камера}: şekil iberildi',
  'door.no_snapshot': 'Şekil gelmedi',
  'door.guest_code':
    'Myhman üçin kod: {код}\n' +
    'Goý, ony girelgedäki domofonda ýygsyn. Kod şu gün {время} sagadyna çenli işleýär.',

  'news.title': 'Dolandyryjy kompaniýanyň bildirişleri:',
  'news.empty':
    'Bildiriş heniz ýok.\n' +
    'Bu ýerde dolandyryjy kompaniýanyň habarlary peýda bolar: suwuň kesilmegi, arassaçylyk, abatlaýyş.',
  'news.all': 'Bildirişleriň hemmesi şular.',
  'news.underway': 'häzir dowam edýär',
  'news.rest_in_app': 'Dowamyny goşundyda okaň.',

  'neighbours.title': 'Goňşularyň arzalary',
  'neighbours.empty':
    'Goňşular heniz hiç zat habar bermedi.\n' +
    'Bu ýerde girelgedäki we howludaky döwükler peýda bolar: olary tassyklap bolýar.',
  'neighbours.about':
    'Goňşularyň habar beren döwükleri: {сколько}. ' +
    'Goşundyda nämedigi we nirededigi görünýär, sizde-de şonuň ýalydygyny tassyklap bolýar.',

  'vote.title': 'Eýeleriň ýygnaklary',
  'vote.none':
    'Häzir açyk ýygnak ýok.\n' +
    'Bu ýerde eýeleriň ýygnaklary peýda bolar: çözgüt kwartiralaryň meýdany boýunça hasaplanýar.',
  'vote.open': 'Açyk ýygnaklar: {сколько}',
  'vote.initiatives': 'goňşularyň teklipleri: {сколько}',
  'vote.protocol_in_app': 'Teswirnamanyň dolusy goşundyda.',
  'vote.abstain': 'Çözesim gelenok',
  'vote.counted': '«{собрание}» ýygnagy. Kwartiranyň sesi: {ответ}.',
  'vote.refused': 'Ses kabul edilmedi',
  'sign.refused': 'Gol kabul edilmedi',

  'support.ask': 'Soragy bir habarda ýazyň, dolandyryjy kompaniýa ýetirerin.',
  'support.ask_more': 'Täze soragy bir habarda ýazyň, öňkä bolsa düwme bilen jogap beriň.',
  'support.taken': 'Sorag kabul edildi: «{тема}». Jogap şu ýere geler.',
  'support.sent': 'Dolandyryjy gurama ýetirdim. Jogap şu ýere geler.',
  'support.reply_ask': 'Şu sorag boýunça habar ýazyň.',
  'support.all': 'Soraglaryň hemmesi şular.',
  'support.more': 'Ýene soraglar aşakda.',
  'contacts.tail': 'Galan aragatnaşyk maglumatlary goşundyda.',

  'gzhi.none': 'Siziň arzalaryňyz boýunça bozulan möhlet ýok, ýüz tutmaga esas ýok.',
  'gzhi.reason': '{номер} arza boýunça şikaýat üçin esas bar: {основание}.\nŞikaýatyň teksti:',
  'gzhi.reason_short': 'Esasy: {основание}.\nŞikaýatyň teksti:',
  'gzhi.sent_already': '{номер} arza boýunça şikaýat eýýäm iberildi: {организация}.',
  'gzhi.sent_before': 'Şu arza boýunça şikaýat eýýäm iberildi: {организация}.',
  'gzhi.number': 'Belgisi {номер}.',
  'gzhi.number_full': 'Şikaýatyň belgisi {номер}.',
  'gzhi.confirm': 'Şu şikaýaty ýaşaýyş jaý gözegçiligine ibermelimi? Ony yzyna alyp bolmaz.',
  'gzhi.sent': 'Şikaýat iberildi: {организация}.',
  'gzhi.answer_days': 'Jogap şu ýere geler, oňa 30 gün bar.',
  'gzhi.no_ground': 'Şu arza boýunça şikaýat üçin esas ýok.',

  'visit.in_chat': 'Kabul edişe ýazylmak meniň bilen şahsy ýazyşykda mümkin.',
  'visit.mine': 'Siz kabul edişe ýazyldyňyz: {когда}',
  'visit.booked': 'Kabul edişe ýazdym, {когда}',
  'visit.not_booked': 'Ýazmadym: {причина}',
  'visit.cancelled': 'Kabul edişe ýazgy ýatyryldy.',
  'visit.not_cancelled': 'Ýazgy ýatyrylmady',
  'visit.not_opened': 'Ýazgy açylmady',
  'visit.no_reception':
    'Ýazgy boýunça kabul ediş geçirilmeýär. Dolandyryjy kompaniýa ýazyň, nobatçy topar jogap berer.',
  'visit.no_slots': 'Ýakyn iki hepdede boş sagat ýok.',
  'visit.title': 'Ýazgy boýunça kabul ediş',
  'visit.title_office': 'Kabul ediş: {офис}',
  'visit.free': 'Boş sagatlar: {сколько}. Wagt goşundyda saýlanýar.',
  'visit.topic_ask': 'Näme bilen gelersiňiz? Bir setirde ýazyň.',
  'visit.taken': 'Bu sagat eýelenildi. Başgasyny saýlaň.',
  'visit.taken_none': 'Bu sagat eýelenildi, boş sagat häzirlikçe ýok.',

  'data.about': '{кто}\nSiz barada saklaýanym: {что}.',
  'data.file': 'Siziň maglumatlaryňyz faýl görnüşinde. {сводка}',
  'data.file_failed': 'Faýly ibermek başartmady. Şol bir maglumatlar goşundyda görünýär.',
  'forget.ask':
    'Profili pozmalymy? At öçer, kwartira aýrylar, habarnamalar gelmesini bes eder. ' +
    'Arzalar, görkezijiler we sesler jaýda atsyz görnüşde galar.',
  'forget.done': 'Profil pozuldy. Ýene gerek bolsam, maňa ýazaýyň: täzesini açaryn.',
  'notice.on': 'Ýene iberip başlaryn: {что}.',
  'notice.off': 'Mundan beýläk ibermerin: {что}. Awariýalar we öz arzalaryňyz barada bary bir habar bererin.',
  'notice.such': 'şeýle habarnamalar',

  'talk.start':
    'Jaý barada we nämäni nädip etmelidigi barada soraň. Jogap bererin we gerek bölegi açaryn.\n' +
    'Yzly-yzyna sorap bolýar, gürrüň düwme bilen tamamlanar.',
  'talk.byModel': 'Jogaby model düzdi.',
  'talk.more': 'Ýene soraň, jogap bererin. Ýa-da gürrüňi tamamlaň.',
  'help.bind':
    'Başlamak üçin kwitansiýadaky kwartira kodyny iberiň: salgynyň ýanyndaky 8 belgi.\n' +
    'Birikdirilenden soň bu ýerde arzalar, görkezijiler, kwitansiýa we girelgäniň gapylary bolar.',

  'dialog.describe': 'Näme bolanyny söz bilen ýazyň. Surat we faýl hem bolýar.',
  'dialog.photo_ask': 'Suratda näme bar? Söz bilen ýazyň.',
  'dialog.one_line': 'Näme bolanyny bir setirde ýazyň.',
  'dialog.unknown_attachment':
    'Beýle goşulan faýly saýgaryp bilemok. Söz bilen ýazyň ýa-da surat ýa-da faýl iberiň.',
  'dialog.need_text': 'Bu ýerde tekst gerek: jogaby habar bilen ýazyň.',
  'dialog.forgot': 'Ýüz tutmanyň näme baradadygy ýadymda däl. Näme bolanyny ýene bir gezek ýazyň.',
  'dialog.cancelled': 'Ýatyrdym. Näme etmeli?',
  'dialog.cancelled_toast': 'Ýatyryldy',

  'voice.not_heard':
    'Ses ýazgysyny saýgaryp bilmedim: dymyşlyk, şowhun ýa-da nätanyş dil. ' +
    'Ýene bir gezek aýdyň ýa-da söz bilen ýazyň.',
  'voice.failed': 'Ses tanamak hyzmaty häzir jogap bermeýär. Söz bilen ýazyň.',
  'voice.unheard': 'Ses ýazgysyny saýgaryp bilmedim. Näme bolanyny bir setirde ýazyň.',
  'thinking.default': 'Pikirlenýärin…',
  'thinking.voice': 'Ses ýazgysyny okaýaryn…',
  'thinking.photo': 'Surada seredýärin…',

  'emergency.call': 'Bu awariýa bolsa, gije-gündiz jaň ediň: {телефон}.',
  'app.install': 'MAX-da «Domovoy» mini-goşundysyny açyň.',

  'error.retry': 'Ýerine ýetirmek başartmady. Ýene bir gezek basyň ýa-da menýudan saýlaň.',
  'error.message': 'Habary işläp bolmady. Ýene synanyşyň ýa-da menýudan saýlaň.',
  'error.toast': 'Başartmady. Ýene synanyşyň',
  'error.failed': 'Başartmady: {причина}',
  'error.failed_short': 'Başartmady',
  'command.unknown': 'Mende beýle buýruk ýok. Nämäniň gerekdigini söz bilen ýazyp bolýar, düşünerin.',

  'menu.title': 'Domovoy',
  'menu.titleAt': '{название}: {адрес}',
  'menu.words': 'Söz bilen ýazyp bolýar: «gapyny aç», «näçe tölemeli», «kran akýar».',
  'menu.in_chat': 'Menýu meniň bilen ýazyşykda açylýar.',
  'menu.new': '✍️ Näme döwüldi',
  'menu.my': '📋 Meniň arzalarym',
  'menu.door': '🚪 Gapylar we kameralar',
  'menu.bill': '🧾 Näçe tölemeli',
  'menu.meters': '💧 Hasaplaýjylar',
  'menu.news': '📣 Bildirişler',
  'menu.vote': '🗳 Ýygnaklar',
  'menu.vote.about': 'Her sorag boýunça ses, meýdan paýlary boýunça hasap we netije boýunça teswirnama.',
  'menu.neighbours': '👥 Goňşularyň arzalary',
  'menu.neighbours.about':
    'Goňşular näme barada habar berdi: sizde-de şonuň ýalydygyny tassyklap bolýar.',
  'menu.house': '📊 Kompaniýanyň işi',
  'menu.capital': '🏗 Düýpli abatlaýyş',
  'menu.capital.about': 'Töleg, jaýyň ýygnany we sebit maksatnamasy boýunça iş ýyllary.',
  'menu.support': '✉️ Kompaniýa sorag',
  'menu.visit': '🗓 Ofisde kabul ediş',
  'menu.visit.about': 'Iki hepde öňe boş sagatlar, öz ýazgyňyz we ony ýatyrmak.',
  'menu.contacts': '☎️ Aragatnaşyk',
  'menu.flat': '🏢 Kwartira',
  'menu.mydata': '🗂 Meniň maglumatlarym',
  'menu.notices': '🔔 Habarnamalar',
  'menu.notices.about':
    'Nämäni ibermeli we näme barada dymmaly. Şol ýerde telefon we öz maglumatlaryňy ýüklemek.',
  'menu.lang': '🌐 Dil',
  'menu.group.money': '💳 Pul we hasaplaýjylar',
  'menu.group.house': '📣 Jaýyň habarlary',
  'menu.group.me': '☎️ Aragatnaşyk we profil',
  'menu.demo': '👥 Rol',

  'menu.group.home': '🏡 Meniň kwartiram',
  'menu.group.bind.about':
    'Siz şu jaýda ýaşaýan bolsaňyz, kwartirany kwitansiýadaky kod boýunça birikdiriň.',
  'menu.home.new': '✍️ Täze arza',
  'menu.home.meters': '💧 Görkezijiler',
  'menu.home.bill': '🧾 Kwitansiýa',
  'menu.home.flat': '🏢 Meniň kwartiram',
  'menu.home.visit.about': 'Boş sagatlar, öz ýazgyňyz we ony ýatyrmak.',

  'menu.contractor.my': '📋 Iş tabşyryklary',
  'menu.group.works': '🏢 Jaýyň işleri',

  'menu.staff.queue': '🗂 Jaýyň nobaty',
  'menu.staff.my': '📋 Meniň tabşyryklarym',
  'menu.staff.day': '🗓 Meniň günüm',
  'menu.staff.duty': '🌙 Nobatçylyk',
  'menu.staff.support': '💬 Ýaşaýjy soraglary',
  'menu.staff.visit': '🗓 Ýaşaýjylary kabul',
  'menu.staff.visit.about':
    'Kabul ediş sagatlary, ýaşaýjylaryň ýazgylary, kabul ediş belligi we ýazgysyz geleni ýazmak.',
  'menu.staff.broadcast': '✉️ Habar ýaýratmak',
  'menu.staff.report': '📊 Aýlyk jemi',
  'menu.staff.debts': '💰 Jaýyň bergileri',
  'menu.staff.vote.about':
    'Ýygnak yglan etmek, kworuma gözegçilik etmek we netije boýunça teswirnama düzmek.',
  'menu.staff.inspections': '🔍 Gözden geçirmeler',
  'menu.staff.inspections.about':
    'Çek-list boýunça aýlaw: bentler ýerinde bellenýär, tapylan dessine arza öwrülýär.',
  'menu.staff.plan': '🗺 Jaýyň meýilnamasy',
  'menu.staff.plan.about': 'Girelgeler we stoýaklar, mesele habar berlen ýerler bellenen.',
  'menu.staff.equipment': '🛗 Enjamlar',
  'menu.staff.equipment.about': 'Näme köplenç işden çykýar we näme ýakynda abatlaýyş talap eder.',
  'menu.staff.house_meters': '💧 Hasaba alyş nokady',
  'menu.staff.house_meters.about':
    'Jaýyň umumy sarpy aýlar boýunça, görkezijiler hem şol ýere girizilýär.',
  'menu.staff.residents': '👥 Jaýyň adamlary',
  'menu.staff.residents.about':
    'Kim nobatçy toparda, kim nobatçy, kime haýsy rol, ýaşaýja kwartira birikdirmek.',
  'menu.staff.stickers': '🏷 Ýelmeýän belgiler',
  'menu.staff.tariffs': '💵 Nyrhlar',
  'menu.staff.tariffs.about': 'Jaýyň kwitansiýasy düzülýän nyrh möçberleri.',
  'menu.staff.card': '🏠 Jaýyň kartoçkasy',
  'menu.staff.card.about': 'Aragatnaşyk, kabul ediş sagatlary, kwartiralar we jaýyň enjamlary.',
  'menu.staff.buildings': '🏘 Kompaniýanyň jaýlary',
  'menu.staff.buildings.about': 'Kompaniýanyň ähli salgylary: geçmek ýa-da täzesini açmak.',
  'menu.staff.audit': '📜 Hereketler žurnaly',
  'menu.staff.audit.about': 'Jaý boýunça kim näme etdi: arzalar, roller, görkezijiler, ýaýratmalar.',
  'menu.group.people': '💬 Ýaşaýjylar',
  'menu.group.app': '📱 Goşundyda',
  'menu.group.manage': '🗄 Jaýy dolandyrmak',

  'chat.answered_privately': '{кто}, size şahsy ýazyşmada jogap berdim.',
  'topic.bill': '🧾 Aýlyk kwitansiýa',
  'topic.request': '📋 Arzalar',
  'topic.news': '📣 Bildirişler',

  'action.accepted': '✅ Almak',
  'action.in_progress': '🔧 Işe almak',
  'action.needs_info': '❓ Takyklamak',
  'action.done': '🏁 Işi tabşyrmak',
  'action.confirmed': '✅ Hemmesi edildi, sag boluň',
  'action.rejected': '⛔ Ret etmek',
  'action.withdrawn': '✖️ Arzany yzyna almak',
  'action.return': '↩️ Edilmedi, gaýtarmak',
  'action.close': '✅ Arzany ýapmak',
  'action.answer': '💬 Jogap bermek',

  'comment.in_progress': 'Takyk näme edilmedi? Bir habarda ýazyň, ussa ýetirerin.',
  'comment.needs_info': 'Ýaşaýjydan näme takyklamaly? Soragy bir habarda ýazyň.',
  'comment.rejected': 'Arza näme üçin ret edilýär? Sebäbini ýaşaýjy görer.',
  'comment.done': 'Näme edildi? Gysgaça ýazyň, belligi ýaşaýjy görer.',
  'comment.confirmed': 'Işi kim kabul etdi? Bir habarda ýazyň, arzanyň taryhyna ýazaryn.',
  'comment.other': 'Sebäbini bir habarda ýazyň.',

  'doing.understood': 'Düşündim: {что}',
  'doing.which': 'Haýsy arza boýunça?',
  'doing.confirm': 'Etmelimi?',
  'doing.write_as': '«{что}» diýip ýazmalymy?',
  'doing.written': 'Ýazdym: {что}',
  'doing.gone': 'Bu iş eýýäm edildi ýa-da ýatyryldy.',
  'doing.assign': 'tabşyrygy bermek',
  'doing.accepted': 'arzany işe kabul etmek',
  'doing.in_progress': 'tabşyrygy işe almak',
  'doing.return': 'işi ussa gaýtarmak',
  'doing.needs_info': 'ýaşaýjydan takyklama soramak',
  'doing.done': 'işi tabşyrmak',
  'doing.confirmed': 'işi kabul etmek',
  'doing.rejected': 'arzany ret etmek',
  'doing.withdrawn': 'arzany yzyna almak',
  'doing.change': 'arzany üýtgetmek',

  'button.menu': '🏠 Menýu',
  'button.back': '⬅️ Yza',
  'button.cancel': '✖️ Ýatyrmak',
  'button.open_app': '📱 Goşundyny açmak',
  'button.in_app': 'Goşundyda açmak',
  'button.in_app_short': 'Goşundyda',
  'button.show': 'Görmek',
  'button.more': '⬇️ Ýene',
  'button.more_news': '⬇️ Ýene bildirişler',
  'button.new_request': '✍️ Arza resmileşdirmek',
  'button.also_me': '🙋 Mende-de şeýle',
  'button.works': '👌 Hemmesi işleýär',
  'button.accept_legal': '✅ Kabul edýärin',
  'button.legal_in_app': 'Resminamalar goşundyda',
  'button.flat': '🏢 Kwartira',
  'button.meters': '💧 Hasaplaýjylar',
  'button.support': '✉️ Kompaniýa sorag',
  'button.write_company': '✉️ Kompaniýa ýazmak',
  'button.bill_in_app': 'Kwitansiýa goşundyda',
  'button.requests_in_app': 'Arzalar goşundyda',
  'button.polls_in_app': 'Ýygnaklar goşundyda',
  'button.quality_in_app': 'Jaýyň işi goşundyda',
  'button.vote': 'Ses bermek',
  'button.visit_choose': 'Wagt saýlamak',
  'button.other_days': 'Beýleki günler goşundyda',
  'button.cancel_visit': '✖️ Ýazgyny ýatyrmak',
  'button.pay_month': '💳 Aý üçin {сумма}',
  'button.pay_month_yes': '💳 Hawa, {сумма} tölemeli',
  'button.pay_debt': '💰 Köne bergi {сумма}',
  'button.pay_debt_yes': '💰 Hawa, {сумма} üzmeli',
  'button.guest_code': '🔑 Myhmana kod',
  'button.copy_code': 'Kody göçürmek',
  'button.reply_request': '💬 Arza boýunça ýazmak',
  'button.answer_ticket': '💬 Sorag boýunça jogap',
  'button.unbind': '🏢 Kwartirany aýyrmak',
  'button.unbind_yes': '🚪 Hawa, aýyrmaly',
  'button.bind_yes': '🏢 Hawa, birikdirmeli',
  'button.export': '📄 Faýl bilen ibermek',
  'button.notices': '🔔 Habarnamalar',
  'button.mute': '🔕 Habarnamalar',
  'button.forget': '🗑 Meni pozmak',
  'button.forget_yes': '🗑 Hawa, pozmaly',
  'button.submit_reading': '✅ Hawa, tabşyrmaly',
  'button.skip_meter': '⏭ Geçmek',
  'button.to_meters': '💧 Hasaplaýjylaryň sanawyna',
  'button.rate_none': 'Bahasyz kabul etmek',
  'button.end_talk': '✖️ Gürrüňi tamamlamak',
  'button.where_unknown': '🤷 Takyk ýerini bilemok',
  'button.withdraw_yes': '✖️ Hawa, yzyna almaly',
  'button.complaint': '📨 Gözegçilige ibermek',
  'button.gzhi': '📄 Gözegçilige şikaýat etmek',
  'button.send_meters': '💧 Görkezijileri ibermek',
  'button.complaint_yes': '📨 Hawa, ibermeli',
  'button.sign': '🙋 Goldamak',
  'button.none_of': '✖️ Hiç haýsy boýunça',
  'button.stale': 'Bu düwme indi işlemeýär',
  'button.stale_more': 'Bu düwme köne habardan. Ine, nireden başlap bolýar.',
  'button.visit_other': '🕘 Başga wagt',
  'button.visit_drop': '🕘 Wagty üýtget',
  'button.rename': '✏️ Ady üýtget',
  'button.complaint_edit': '✏️ Teksti düzet',
  'button.not_my_flatmate': '🚫 Bu meniň goňşym däl',
  'button.owner_yes': '✅ Men eýesi',
  'button.owner_no': '👤 Ýaşaýaryn, emma eýesi däl',
  'button.dispute': '📄 Ret ediş bilen ylalaşamok',
  'button.missed': '🚪 Kwartira girip bilmedim',
  'button.connect': '🏢 Meniň jaýym bu ýerde ýok',

  'visit.set': 'Ýazdym: {номер} arzasy boýunça ussa {когда} geler. Meýilnamalar üýtgese, ýazyň.',
  'visit.missed_noted': '{номер} arzasy boýunça bellik etdim: kwartira girilmedi. Ýaşaýjy başga wagt saýlar.',
  'visit.dropped': '{номер} arzasy boýunça wagt aýryldy. Başgasyny saýlaň, ussa men habar bererin.',
  'visit.not_understood': 'Teklip edilenleriň arasynda beýle wagt ýok. Şulardan birini saýlaň.',

  'name.ask': 'Size nähili ýüzleneli? Häzir: {имя}. Ady bir habarda ýazyň.',
  'name.changed': 'Indi siz {имя}. Sizi ussa we dolandyryjy gurama şeýle görer.',

  'gzhi.edit_ask': 'Nämäni düzetmelidigini ýazyň: «girelge baradakyny aýyr», «üçünji gün akýandygyny goş».',
  'gzhi.edited': 'Düzetdim. Okaň we ähli zat dogry bolsa, iberiň.',
  'gzhi.not_edited': 'Nämäni düzetmelidigine düşünmedim. Başgaça aýdyň ýa-da şu durkuna iberiň.',

  'request.dispute_ask': 'Ret ediş bilen näme üçin ylalaşmaýandygyňyzy bir habarda ýazyň. Oňa täzeden serederler.',
  'request.disputed': 'Arza {номер} ýene işde. Dolandyryjy gurama ony täzeden serediär.',

  'flat.owner_ask':
    'Siz şu kwartiranyň eýesimi? Ýygnaklarda jaýlaryň eýeleri ses berýär, galan zatlar hemmä açyk.',
  'flat.owner_noted': 'Ýazdym: siz eýesi. Ýygnakdaky sesiňiz kwartiraňyzyň meýdany boýunça hasaplanýar.',
  'flat.tenant_noted': 'Ýazdym. Arzalar, görkezijiler we kwitansiýa size açyk, ýygnakdaky ses bolsa ýok.',
  'flat.neighbour_dropped': 'Bu adamy kwartiraňyzdan aýyrdym. Dolandyryjy gurama bu barada bilýär.',

  'connect.ask':
    'Öýüňiz bu ýerde heniz ýok ýaly. Salgyny bir habarda ýazyň, biz ony jaýyňyzyň dolandyryjy guramasyna ýetireris.',
  'connect.saved': 'Salgyny ýazdym. Jaý birikdirilen badyna ýazaryn.',

  'day.title': 'Sizdäki tabşyryklar: {сколько}, baryş wagty bellenenler: {назначено}.',
  'day.rest': 'Ýene tabşyryklar: {сколько}. Tutuş gün goşundyda görünýär.',
  'day.empty': 'Häzir sizde tabşyryk ýok.',
};
