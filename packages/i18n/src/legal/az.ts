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
  title: 'Şəxsi məlumatların emalı siyasəti',
  short: 'Məlumatların emalı siyasəti',
  about: 'Məlumatların tərkibi, emalın əsasları, alıcılar, saxlanma müddətləri və subyektin hüquqları',
  parts: [
    {
      heading: '1. Ümumi müddəalar',
      lines: [
        '1.1. Siyasət «Domovoy» proqram məhsulunda (bundan sonra — məhsul) şəxsi məlumatların emalı qaydasını müəyyən edir.',
        '1.2. Şəxsi məlumatların operatoru istifadəçinin çoxmənzilli binasına xidmət göstərən idarəetmə təşkilatıdır. Operator emalın məqsədlərini müəyyən edir və emala görə şəxsi məlumatların subyekti və nəzarət orqanları qarşısında məsuliyyət daşıyır.',
        '1.3. Məhsul şəxsi məlumatları 27.07.2006 tarixli № 152-ФЗ Federal Qanununun 6-cı maddəsinin 3-cü hissəsi əsasında operatorun tapşırığı ilə emal edir, öz emal məqsədlərinə malik deyil, tapşırıqdan kənar üçüncü şəxslərə məlumat ötürmür.',
        '1.4. Operatorun adı və əlaqə məlumatları məhsulun «Dəstək» bölməsində göstərilmişdir.',
      ],
    },
    {
      heading: '2. Emalın hüquqi əsasları',
      lines: [
        '2.1. Çoxmənzilli binanın idarə edilməsi müqaviləsi və ondan irəli gələn öhdəliklərin icrası: № 152-ФЗ Federal Qanununun 6-cı maddəsinin 1-ci hissəsinin 5-ci bəndi, Rusiya Federasiyasının Mənzil Məcəlləsinin 161-ci maddəsi.',
        '2.2. Operatorun üzərinə qanunvericiliklə qoyulmuş öhdəliklərin icrası: № 152-ФЗ Federal Qanununun 6-cı maddəsinin 1-ci hissəsinin 2-ci bəndi, Çoxmənzilli binaların idarə edilməsi üzrə fəaliyyətin həyata keçirilməsi Qaydaları (Rusiya Federasiyası Hökumətinin 15.05.2013 tarixli № 416 qərarı), Kommunal xidmətlərin göstərilməsi Qaydaları (Rusiya Federasiyası Hökumətinin 06.05.2011 tarixli № 354 qərarı).',
        '2.3. MAX informasiya sistemində sahiblər və sahələrin istifadəçiləri ilə qarşılıqlı əlaqə Rusiya Federasiyası Hökumətinin 26.01.2026 tarixli № 40 qərarının redaksiyasında № 416 Qaydaları ilə nəzərdə tutulmuşdur.',
        '2.4. Şəxsi məlumatların subyektinin razılığı: 2.1 və 2.2-ci bəndlərdə göstərilən əsasların hüdudlarından kənara çıxan hissədə, o cümlədən telefon nömrəsinin könüllü təqdim edilməsi zamanı.',
      ],
    },
    {
      heading: '3. Emal olunan məlumatların tərkibi',
      lines: [
        '3.1. MAX profilinin məlumatları: istifadəçinin identifikatoru, platforma tərəfindən ötürülmüş həcmdə ad və soyad.',
        '3.2. Ünvan məlumatları: bina, giriş, stoyak və istifadəçinin bağlandığı sahə, sahənin bağlanma kodu.',
        '3.3. Müraciətlərin məlumatları: müraciətin mətni, əlavə edilmiş fotoşəkillər və səsli mesajlar, müraciət üzrə yazışma, görülmüş işlərin qiymətləndirilməsi.',
        '3.4. Hesablama məlumatları: uçot cihazlarının göstəriciləri, hesablanmış məbləğlər, ödənişlər, borc və penya.',
        '3.5. Bina üzrə məlumatlar: sahiblərin ümumi yığıncağında səsvermə, qəbula yazılma, qapıların açılması jurnalı və verilmiş qonaq kodları.',
        '3.6. Əlaqə məlumatları: istifadəçi tərəfindən könüllü təqdim edilmiş telefon nömrəsi və elektron poçt ünvanı.',
        '3.7. Məhsul pasport məlumatlarını tələb etmir, cihazın yerini müəyyən etmir və istifadəçinin məhsuldan kənar yazışmasını emal etmir.',
      ],
    },
    {
      heading: '4. Emalın məqsədləri',
      lines: [
        '4.1. Müraciətlərin qəbulu və baxılması, operatorun reqlamentinə və normativ hüquqi aktlara uyğun olaraq müddətlərin təyin edilməsi, işlərin gedişi barədə məlumatlandırma.',
        '4.2. Haqqın hesablanması, uçot cihazlarının göstəricilərinin qəbulu və ödənişin həyata keçirilməsi.',
        '4.3. Sahiblərin ümumi yığıncağının keçirilməsi və səslərin sahələrin sahə paylarına uyğun hesablanması.',
        '4.4. Binanın girişinə daxil olmanın təmin edilməsi və birdəfəlik qonaq kodlarının verilməsi.',
        '4.5. Müddətlərə riayət olunması barədə istifadəçi və nəzarət orqanları qarşısında hesabatlılıq.',
      ],
    },
    {
      heading: '5. Məlumatların alıcıları',
      lines: [
        '5.1. Müraciət operatorun məsuliyyət zonasından kənara ötürüldükdə əlaqəli təşkilatlar: resurs təchizatı təşkilatı, podrat təşkilatı, yerli özünüidarə orqanı, dövlət mənzil nəzarəti orqanı. Müraciətin mahiyyəti və obyektin ünvanı ötürülür.',
        '5.2. Ödəniş qoşulduqda ödəniş servisi: ödənişin məbləği və təyinatı.',
        '5.3. Operator tərəfindən qoşulduqda mətnin avtomatik təhlili xidməti: müraciətin və ya sualın mətni, habelə istifadəçi barədə məhsulun interfeysində ona əlçatan həcmdə məlumatlar. Digər şəxslərin məlumatları ötürülmür. Təhlilin nəticəsi köməkçi xarakter daşıyır, müraciət üzrə qərarları operator qəbul edir.',
        '5.4. MAX platforması — mesajların çatdırılması üçün zəruri olan həcmdə.',
        '5.5. Şəxsi məlumatların sərhədlərarası ötürülməsi həyata keçirilmir. Verilənlər bazaları № 152-ФЗ Federal Qanununun 18-ci maddəsinin 5-ci hissəsinə uyğun olaraq Rusiya Federasiyasının ərazisində yerləşdirilir.',
      ],
    },
    {
      heading: '6. Emal və saxlanma müddətləri',
      lines: [
        '6.1. Məlumatlar çoxmənzilli binanın idarə edilməsi müqaviləsinin qüvvədə olduğu müddət ərzində və müvafiq sənədlər üçün qanunvericiliklə müəyyən edilmiş saxlanma müddətləri ərzində emal olunur.',
        '6.2. Müddətlər bitdikdən sonra məlumatlar silinir və ya şəxsiyyətsizləşdirilir. Müraciətlər barədə şəxsiyyətsizləşdirilmiş məlumatlar obyektin tarixçəsi kimi saxlanılır və şəxsi məlumatların subyektini müəyyən etməyə imkan vermir.',
      ],
    },
    {
      heading: '7. Şəxsi məlumatların subyektinin hüquqları',
      lines: [
        '7.1. Öz məlumatlarının emalı barədə məlumat almaq (№ 152-ФЗ Federal Qanununun 14-cü maddəsi): çat-botdakı /mydata əmri və tətbiqdəki «Profil» bölməsi yükləmə faylını formalaşdırır.',
        '7.2. Məlumatların dəqiqləşdirilməsi, bloklanması və silinməsi (№ 152-ФЗ Federal Qanununun 21-ci maddəsi): «Profil» bölməsində profilin silinməsi hesabı şəxsiyyətsizləşdirir; müraciətlər və göstəricilər barədə məlumatlar obyektin tarixçəsi kimi saxlanılır.',
        '7.3. Razılığın onun əsasında həyata keçirilən emal hissəsində geri götürülməsi, o cümlədən telefon nömrəsinin silinməsi.',
        '7.4. Sahədən istifadə hüququna xitam verildikdə sahənin bağlantısının ləğvi.',
        '7.5. «Dəstək» bölməsindəki əlaqə vasitələri ilə operatora, habelə Rabitə, İnformasiya Texnologiyaları və Kütləvi Kommunikasiyalar Sahəsində Nəzarət üzrə Federal Xidmətə müraciət etmək.',
      ],
    },
    {
      heading: '8. Mühafizə tədbirləri',
      lines: [
        '8.1. Məlumatlara çıxış rollar üzrə məhdudlaşdırılmışdır: istifadəçi öz məlumatlarına, operatorun işçiləri vəzifə öhdəlikləri həcmindəki məlumatlara, podrat təşkilatı isə ona həvalə edilmiş tapşırıqlara çıxış əldə edir.',
        '8.2. Operator işçilərinin hərəkətləri hərəkətlər jurnalında qeydə alınır.',
        '8.3. Məlumatların tətbiq ilə server arasında ötürülməsi qorunan kanal vasitəsilə həyata keçirilir; çıxış platforma tərəfindən imzalanmış işəsalma parametrləri əsasında verilir.',
      ],
    },
    {
      heading: '9. Siyasətin dəyişdirilməsi',
      lines: [
        '9.1. Qüvvədə olan redaksiya domovoy.homes/privacy ünvanında yerləşdirilir və məhsulda avtorizasiya olmadan əlçatandır.',
        '9.2. Redaksiyada şəxsi məlumatların subyektinin hüquqlarına toxunan dəyişiklik edildikdə məhsul razılığı təkrar soruşur.',
      ],
    },
  ],
};

const terms: LegalText = {
  slug: 'terms',
  title: 'İstifadəçi razılaşması',
  short: 'İstifadəçi razılaşması',
  about: 'Razılaşmanın predmeti, tərəflərin öhdəlikləri, məsuliyyətin məhdudlaşdırılması',
  parts: [
    {
      heading: '1. Razılaşmanın predmeti',
      lines: [
        '1.1. Razılaşma MAX informasiya sistemindəki çat-bot və mini-tətbiqi özündə birləşdirən «Domovoy» proqram məhsulunun istifadə şərtlərini müəyyən edir.',
        '1.2. Məhsuldan istifadəyə başlanması razılaşmanın və şəxsi məlumatların emalı siyasətinin şərtlərinin qəbul edilməsi deməkdir.',
        '1.3. Çoxmənzilli binanın idarə edilməsi üzrə xidmətləri idarəetmə təşkilatı göstərir. Məhsul müraciətlərin qəbulunu, məlumatlandırmanı və təşkilatın işi barədə məlumatların əks etdirilməsini təmin edir.',
      ],
    },
    {
      heading: '2. İstifadəçinin öhdəlikləri',
      lines: [
        '2.1. Nasazlıqlar barədə doğru məlumat vermək. Bilərəkdən yalan qəza müraciətinin göndərilməsi qəza-dispetçer xidmətini yayındırır.',
        '2.2. Uçot cihazlarının göstəricilərini onların faktiki qiymətlərinə uyğun təqdim etmək.',
        '2.3. Müraciətlərdə üçüncü şəxslərin şəxsi məlumatlarını və təsvirlərini onların razılığı olmadan yerləşdirməmək.',
        '2.4. Öz MAX profilindən məhsulda edilmiş hərəkətlərə görə məsuliyyət daşımaq.',
      ],
    },
    {
      heading: '3. Məhsulun funksiyaları',
      lines: [
        '3.1. Müraciətin qeydiyyatı, təşkilatın reqlamentinə və normativ hüquqi aktlara uyğun olaraq reaksiya müddətinin və icra müddətinin hesablanması, işlərin gedişinin və xronologiyanın əks etdirilməsi.',
        '3.2. İstifadəçinin müraciətləri üzrə dəyişikliklər, binada aparılan işlər və sahiblərin ümumi yığıncaqlarının keçirilməsi barədə bildiriş.',
        '3.3. Uçot cihazlarının göstəricilərinin qəbulu, hesablanmış məbləğlərin əks etdirilməsi və ödəniş servisi qoşulduqda ödənişin həyata keçirilməsi.',
        '3.4. Binanın girişinə daxil olmanın idarə edilməsi və domofon avadanlığı qoşulduqda qonaq kodlarının verilməsi.',
      ],
    },
    {
      heading: '4. Müraciətlərin avtomatik təhlili',
      lines: [
        '4.1. Müraciətlərin təhlili və köməkçinin cavabları dil modelinin tətbiqi ilə formalaşdırılır və arayış xarakteri daşıyır.',
        '4.2. Hüquqi əhəmiyyət daşıyan idarəetmə təşkilatının müraciət üzrə cavabıdır. Müddətlər normativ hüquqi aktlar və təşkilatın reqlamenti ilə müəyyən edilir.',
        '4.3. Arayış xarakterli cavab təşkilatın cavabı ilə uyğun gəlmədikdə təşkilatın cavabı üstünlük təşkil edir.',
      ],
    },
    {
      heading: '5. Məsuliyyətin məhdudlaşdırılması',
      lines: [
        '5.1. Məhsul görülmüş işlərin keyfiyyətinə və idarəetmə təşkilatının qərarlarına görə məsuliyyət daşımır.',
        '5.2. Məhsulun əlçatanlığı MAX informasiya sisteminin, rabitə operatorunun və təşkilatın server infrastrukturunun işindən asılıdır.',
        '5.3. Məhsulun əlçatan olmadığı dövrdə qəza vəziyyəti yarandıqda müraciət «Dəstək» bölməsində göstərilmiş qəza-dispetçer xidmətinin telefonu ilə göndərilir.',
      ],
    },
    {
      heading: '6. İstifadənin dayandırılması',
      lines: [
        '6.1. İstifadəçi «Profil» bölməsində sahənin bağlantısını ləğv etmək və profili silmək hüququna malikdir.',
        '6.2. Təşkilat çoxmənzilli binanın idarə edilməsinə xitam verildikdə çıxışı dayandırmaq hüququna malikdir.',
        '6.3. Razılaşmanın qüvvədə olan redaksiyası domovoy.homes/terms ünvanında yerləşdirilir.',
      ],
    },
  ],
};

export const az: LegalText[] = [privacy, terms];

export const azNotes: LegalNotes = {
  updated: '{date} tarixli redaksiya',
  prevails: 'Hüquqi qüvvəyə malik olan rusca redaksiyadır',
  languages: 'Sənədin dili',
};
