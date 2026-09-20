import type { LegalNotes, LegalText } from './text.js';

/**
 * Документы, которые продукт показывает до обработки данных. Текст один и тот же
 * в боте, в приложении и на сайте: расхождение между копиями документа хуже, чем
 * его отсутствие.
 *
 * Обязательна из них политика обработки персональных данных: оператор публикует
 * её и обеспечивает неограниченный доступ (ч. 2 ст. 18.1 Федерального закона
 * от 27.07.2006 № 152-ФЗ). Пользовательское соглашение законом не требуется
 * и описывает правила сервиса.
 */
const privacy: LegalText = {
  slug: 'privacy',
  title: 'Shaxsiy maʼlumotlarni qayta ishlash siyosati',
  short: 'Maʼlumotlarni qayta ishlash siyosati',
  about: 'Maʼlumotlar tarkibi, qayta ishlash asoslari, oluvchilar, saqlash muddatlari va subyekt huquqlari',
  parts: [
    {
      heading: '1. Umumiy qoidalar',
      lines: [
        '1.1. Siyosat «Domovoy» dasturiy mahsulotida (keyingi oʻrinlarda, mahsulot) shaxsiy maʼlumotlarni qayta ishlash tartibini belgilaydi.',
        '1.2. Shaxsiy maʼlumotlar operatori foydalanuvchining koʻp kvartirali uyiga xizmat koʻrsatuvchi boshqaruv tashkiloti hisoblanadi. Operator qayta ishlash maqsadlarini belgilaydi va qayta ishlash uchun shaxsiy maʼlumotlar subyekti hamda nazorat qiluvchi organlar oldida javob beradi.',
        '1.3. Mahsulot shaxsiy maʼlumotlarni operatorning topshirigʻi boʻyicha 27.07.2006 yildagi № 152-ФЗ sonli Federal qonunning 6-moddasi 3-qismi asosida qayta ishlaydi, qayta ishlashning oʻz maqsadlariga ega emas, maʼlumotlarni topshiriq doirasidan tashqarida uchinchi shaxslarga uzatmaydi.',
        '1.4. Operatorning nomi va aloqa maʼlumotlari mahsulotning «Yordam» boʻlimida keltirilgan.',
      ],
    },
    {
      heading: '2. Qayta ishlashning huquqiy asoslari',
      lines: [
        '2.1. Koʻp kvartirali uyni boshqarish shartnomasi va u boʻyicha majburiyatlarning bajarilishi: № 152-ФЗ sonli Federal qonunning 6-moddasi 1-qismi 5-bandi, Rossiya Federatsiyasi Uy-joy kodeksining 161-moddasi.',
        '2.2. Operatorga qonun hujjatlari bilan yuklatilgan majburiyatlarning bajarilishi: № 152-ФЗ sonli Federal qonunning 6-moddasi 1-qismi 2-bandi, Koʻp kvartirali uylarni boshqarish boʻyicha faoliyatni amalga oshirish qoidalari (Rossiya Federatsiyasi Hukumatining 15.05.2013 yildagi № 416-sonli qarori), Kommunal xizmatlarni taqdim etish qoidalari (Rossiya Federatsiyasi Hukumatining 06.05.2011 yildagi № 354-sonli qarori).',
        '2.3. MAX axborot tizimida xonadon mulkdorlari va foydalanuvchilari bilan oʻzaro hamkorlik Rossiya Federatsiyasi Hukumatining 26.01.2026 yildagi № 40-sonli qarori tahriridagi № 416-sonli Qoidalarda nazarda tutilgan.',
        '2.4. Shaxsiy maʼlumotlar subyektining roziligi: 2.1 va 2.2-bandlarda koʻrsatilgan asoslar doirasidan chiqadigan qismda, shu jumladan telefon raqamini ixtiyoriy ravishda taqdim etishda.',
      ],
    },
    {
      heading: '3. Qayta ishlanadigan maʼlumotlar tarkibi',
      lines: [
        '3.1. MAX profili maʼlumotlari: foydalanuvchi identifikatori, platforma uzatgan hajmdagi ism va familiya.',
        '3.2. Manzil maʼlumotlari: uy, podyezd, umumiy quvur va foydalanuvchi bogʻlangan xonadon, xonadonni bogʻlash kodi.',
        '3.3. Murojaat maʼlumotlari: murojaat matni, ilova qilingan suratlar va ovozli xabarlar, ariza boʻyicha yozishmalar, bajarilgan ishlarga qoʻyilgan baho.',
        '3.4. Hisob-kitob maʼlumotlari: hisoblagichlar koʻrsatkichlari, hisoblangan summalar, toʻlovlar, qarzdorlik va penya.',
        '3.5. Uy toʻgʻrisidagi maʼlumotlar: mulkdorlarning umumiy yigʻilishida ovoz berish, qabulga yozilish, eshiklarning ochilish jurnali va berilgan mehmon kodlari.',
        '3.6. Aloqa maʼlumotlari: foydalanuvchi ixtiyoriy ravishda taqdim etgan telefon raqami va elektron pochta manzili.',
        '3.7. Mahsulot pasport maʼlumotlarini soʻramaydi, qurilmaning joylashuvini aniqlamaydi va foydalanuvchining mahsulotdan tashqaridagi yozishmalarini qayta ishlamaydi.',
      ],
    },
    {
      heading: '4. Qayta ishlash maqsadlari',
      lines: [
        '4.1. Murojaatlarni qabul qilish va koʻrib chiqish, operator reglamenti hamda normativ-huquqiy hujjatlar boʻyicha muddatlarni belgilash, ishlarning borishi toʻgʻrisida xabardor qilish.',
        '4.2. Toʻlovni hisoblash, hisoblagichlar koʻrsatkichlarini qabul qilish va toʻlovni amalga oshirish.',
        '4.3. Mulkdorlarning umumiy yigʻilishini oʻtkazish va ovozlarni xonadonlar maydoni ulushlari boʻyicha sanash.',
        '4.4. Podyezdga kirishni taʼminlash va bir martalik mehmon kodlarini berish.',
        '4.5. Muddatlarga rioya qilinishi toʻgʻrisida foydalanuvchi va nazorat qiluvchi organlar oldidagi hisobot.',
      ],
    },
    {
      heading: '5. Maʼlumotlarni oluvchilar',
      lines: [
        '5.1. Murojaat operatorning javobgarlik doirasidan tashqariga uzatilganda aloqador tashkilotlar: resurs yetkazib beruvchi tashkilot, pudratchi tashkilot, mahalliy oʻzini oʻzi boshqarish organi, davlat uy-joy nazorati organi. Murojaatning mohiyati va obyektning manzili uzatiladi.',
        '5.2. Toʻlov ulangan boʻlsa, toʻlov xizmati: toʻlov summasi va maqsadi.',
        '5.3. Operator tomonidan ulangan boʻlsa, matnni avtomatik tahlil qilish xizmati: murojaat yoki savol matni va foydalanuvchi toʻgʻrisidagi maʼlumotlar mahsulot interfeysida unga ochiq boʻlgan hajmda. Boshqa shaxslarning maʼlumotlari uzatilmaydi. Tahlil natijasi yordamchi xususiyatga ega, murojaat boʻyicha qarorlarni operator qabul qiladi.',
        '5.4. MAX platformasi, xabarlarni yetkazish uchun zarur hajmda.',
        '5.5. Shaxsiy maʼlumotlarni transchegaraviy uzatish amalga oshirilmaydi. Maʼlumotlar bazalari № 152-ФЗ sonli Federal qonunning 18-moddasi 5-qismiga muvofiq Rossiya Federatsiyasi hududida joylashtiriladi.',
      ],
    },
    {
      heading: '6. Qayta ishlash va saqlash muddatlari',
      lines: [
        '6.1. Maʼlumotlar koʻp kvartirali uyni boshqarish shartnomasining amal qilish muddati davomida va tegishli hujjatlar uchun qonun hujjatlarida belgilangan saqlash muddatlari davomida qayta ishlanadi.',
        '6.2. Muddatlar oʻtgandan soʻng maʼlumotlar oʻchiriladi yoki shaxssizlantiriladi. Murojaatlar toʻgʻrisidagi shaxssizlantirilgan maʼlumotlar obyekt tarixi sifatida saqlanadi va shaxsiy maʼlumotlar subyektini aniqlash imkonini bermaydi.',
      ],
    },
    {
      heading: '7. Shaxsiy maʼlumotlar subyektining huquqlari',
      lines: [
        '7.1. Oʻz maʼlumotlarining qayta ishlanishi toʻgʻrisida maʼlumot olish (№ 152-ФЗ sonli Federal qonunning 14-moddasi): chat-botdagi /mydata buyrugʻi va ilovadagi «Profil» boʻlimi yuklab berishni shakllantiradi.',
        '7.2. Maʼlumotlarni aniqlashtirish, bloklash va oʻchirish (№ 152-ФЗ sonli Federal qonunning 21-moddasi): «Profil» boʻlimida profilni oʻchirish hisob yozuvini shaxssizlantiradi; murojaatlar va koʻrsatkichlar toʻgʻrisidagi maʼlumotlar obyekt tarixi sifatida saqlanadi.',
        '7.3. Rozilik asosida amalga oshiriladigan qayta ishlash qismida rozilikni qaytarib olish, shu jumladan telefon raqamini oʻchirish.',
        '7.4. Xonadondan foydalanish huquqi tugatilganda uni uzish.',
        '7.5. «Yordam» boʻlimidagi aloqa maʼlumotlari boʻyicha operatorga, shuningdek Aloqa, axborot texnologiyalari va ommaviy kommunikatsiyalar sohasida nazorat qilish boʻyicha federal xizmatga murojaat qilish.',
      ],
    },
    {
      heading: '8. Himoya choralari',
      lines: [
        '8.1. Maʼlumotlarga kirish rollar boʻyicha chegaralangan: foydalanuvchi oʻz maʼlumotlariga, operator xodimlari lavozim majburiyatlari doirasidagi maʼlumotlarga, pudratchi tashkilot topshirilgan vazifalarga kirish huquqiga ega.',
        '8.2. Operator xodimlarining harakatlari harakatlar jurnalida qayd etiladi.',
        '8.3. Maʼlumotlarni ilova va server oʻrtasida uzatish himoyalangan kanal orqali amalga oshiriladi; kirish platforma imzolagan ishga tushirish parametrlari boʻyicha beriladi.',
      ],
    },
    {
      heading: '9. Siyosatni oʻzgartirish',
      lines: [
        '9.1. Amaldagi tahrir domovoy.homes/privacy manzilida joylashtiriladi va mahsulotda avtorizatsiyasiz ochiq boʻladi.',
        '9.2. Shaxsiy maʼlumotlar subyektining huquqlariga taalluqli tahrir oʻzgarganda mahsulot rozilikni qayta soʻraydi.',
      ],
    },
  ],
};

const terms: LegalText = {
  slug: 'terms',
  title: 'Foydalanuvchi shartnomasi',
  short: 'Foydalanuvchi shartnomasi',
  about: 'Shartnoma predmeti, tomonlarning majburiyatlari, javobgarlikni cheklash',
  parts: [
    {
      heading: '1. Shartnoma predmeti',
      lines: [
        '1.1. Shartnoma MAX axborot tizimidagi chat-bot va mini-ilovani oʻz ichiga olgan «Domovoy» dasturiy mahsulotidan foydalanish shartlarini belgilaydi.',
        '1.2. Mahsulotdan foydalanishni boshlash shartnoma shartlarini va shaxsiy maʼlumotlarni qayta ishlash siyosatini qabul qilishni anglatadi.',
        '1.3. Koʻp kvartirali uyni boshqarish boʻyicha xizmatlarni boshqaruv tashkiloti koʻrsatadi. Mahsulot murojaatlarni qabul qilishni, xabardor qilishni va tashkilot ishi toʻgʻrisidagi maʼlumotlarni koʻrsatishni taʼminlaydi.',
      ],
    },
    {
      heading: '2. Foydalanuvchining majburiyatlari',
      lines: [
        '2.1. Nosozliklar toʻgʻrisida ishonchli maʼlumot berish. Bila turib yolgʻon avariya murojaatini yuborish avariya-dispetcherlik xizmatini chalgʻitadi.',
        '2.2. Hisoblagichlar koʻrsatkichlarini ularning haqiqiy qiymatlariga muvofiq topshirish.',
        '2.3. Murojaatlarda uchinchi shaxslarning shaxsiy maʼlumotlari va tasvirlarini ularning roziligisiz joylashtirmaslik.',
        '2.4. Mahsulotda oʻz MAX profilidan amalga oshirilgan harakatlar uchun javobgarlikni zimmasiga olish.',
      ],
    },
    {
      heading: '3. Mahsulot funksiyalari',
      lines: [
        '3.1. Murojaatni roʻyxatga olish, tashkilot reglamenti va normativ-huquqiy hujjatlar boʻyicha javob berish muddati hamda bajarish muddatini hisoblash, ishlarning borishi va xronologiyasini koʻrsatish.',
        '3.2. Foydalanuvchi murojaatlari boʻyicha oʻzgarishlar toʻgʻrisida, uydagi ishlar toʻgʻrisida va mulkdorlarning umumiy yigʻilishlari oʻtkazilishi toʻgʻrisida xabardor qilish.',
        '3.3. Hisoblagichlar koʻrsatkichlarini qabul qilish, hisoblangan summalarni koʻrsatish va toʻlov xizmati ulangan boʻlsa, toʻlovni amalga oshirish.',
        '3.4. Domofon uskunasi ulangan boʻlsa, podyezdga kirishni boshqarish va mehmon kodlarini berish.',
      ],
    },
    {
      heading: '4. Murojaatlarni avtomatik tahlil qilish',
      lines: [
        '4.1. Murojaatlarni tahlil qilish va yordamchining javoblari til modeli qoʻllanilgan holda shakllantiriladi hamda maʼlumot xususiyatiga ega.',
        '4.2. Yuridik ahamiyatga boshqaruv tashkilotining murojaat boʻyicha javobi ega. Muddatlar normativ-huquqiy hujjatlar va tashkilot reglamenti bilan belgilanadi.',
        '4.3. Maʼlumot uchun berilgan javob tashkilot javobiga mos kelmaganda tashkilot javobi ustunlikka ega.',
      ],
    },
    {
      heading: '5. Javobgarlikni cheklash',
      lines: [
        '5.1. Mahsulot bajarilgan ishlar sifati uchun va boshqaruv tashkilotining qarorlari uchun javobgar emas.',
        '5.2. Mahsulotning ishlashi MAX axborot tizimi, aloqa operatori va tashkilotning server infratuzilmasi ishiga bogʻliq.',
        '5.3. Mahsulot ishlamaydigan davrda avariya holati yuz bersa, murojaat «Yordam» boʻlimida koʻrsatilgan avariya-dispetcherlik xizmati telefoni orqali yuboriladi.',
      ],
    },
    {
      heading: '6. Foydalanishni tugatish',
      lines: [
        '6.1. Foydalanuvchi «Profil» boʻlimida xonadonni uzishga va profilni oʻchirishga haqli.',
        '6.2. Tashkilot koʻp kvartirali uyni boshqarishni tugatganda kirishni toʻxtatishga haqli.',
        '6.3. Shartnomaning amaldagi tahriri domovoy.homes/terms manzilida joylashtiriladi.',
      ],
    },
  ],
};

export const uz: LegalText[] = [privacy, terms];

export const uzNotes: LegalNotes = {
  updated: 'Tahrir sanasi: {date}',
  prevails: 'Yuridik kuchga rus tilidagi tahrir ega',
  languages: 'Hujjat tili',
};
