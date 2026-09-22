import type { LegalNotes, LegalText } from './text.js';

const privacy: LegalText = {
  slug: 'privacy',
  title: 'Politica de prelucrare a datelor cu caracter personal',
  short: 'Politica de prelucrare a datelor',
  about: 'Componența datelor, temeiurile prelucrării, destinatarii, termenele de păstrare și drepturile persoanei vizate',
  parts: [
    {
      heading: '1. Dispoziții generale',
      lines: [
        '1.1. Politica stabilește modul de prelucrare a datelor cu caracter personal în produsul software „Domovoy” (în continuare, produsul).',
        '1.2. Operator de date cu caracter personal este organizația de administrare care deservește blocul de locuințe al utilizatorului. Operatorul stabilește scopurile prelucrării și răspunde pentru aceasta față de persoana vizată și față de organele de control.',
        '1.3. Produsul prelucrează datele cu caracter personal la însărcinarea operatorului, în temeiul alineatului 3 al articolului 6 din Legea federală din 27.07.2006 № 152-ФЗ, nu are scopuri proprii de prelucrare și nu transmite date către terți în afara însărcinării.',
        '1.4. Denumirea și datele de contact ale operatorului sunt indicate în secțiunea „Asistență” a produsului.',
      ],
    },
    {
      heading: '2. Temeiurile juridice ale prelucrării',
      lines: [
        '2.1. Contractul de administrare a blocului de locuințe și executarea obligațiilor care decurg din acesta: punctul 5 al alineatului 1 al articolului 6 din Legea federală № 152-ФЗ, articolul 161 din Codul locuinței al Federației Ruse.',
        '2.2. Executarea obligațiilor stabilite în sarcina operatorului de legislație: punctul 2 al alineatului 1 al articolului 6 din Legea federală № 152-ФЗ, Regulile de desfășurare a activității de administrare a blocurilor de locuințe (Hotărârea Guvernului Federației Ruse din 15.05.2013 № 416), Regulile de prestare a serviciilor comunale (Hotărârea Guvernului Federației Ruse din 06.05.2011 № 354).',
        '2.3. Interacțiunea cu proprietarii și cu utilizatorii spațiilor în sistemul informațional MAX este prevăzută de Regulile № 416 în redacția Hotărârii Guvernului Federației Ruse din 26.01.2026 № 40.',
        '2.4. Consimțământul persoanei vizate: în partea care depășește temeiurile indicate la punctele 2.1 și 2.2, inclusiv la furnizarea benevolă a numărului de telefon.',
      ],
    },
    {
      heading: '3. Componența datelor prelucrate',
      lines: [
        '3.1. Datele profilului MAX: identificatorul utilizatorului, numele și prenumele în volumul transmis de platformă.',
        '3.2. Datele de adresă: blocul, scara, coloana și locuința de care este legat utilizatorul, codul de asociere a locuinței.',
        '3.3. Datele solicitărilor: textul solicitării, fotografiile și mesajele vocale atașate, corespondența pe sesizare, nota acordată lucrărilor executate.',
        '3.4. Datele de calcul: indicațiile contoarelor, sumele calculate, plățile, datoria și penalitățile.',
        '3.5. Datele despre bloc: votul în adunarea generală a proprietarilor, programarea la audiență, jurnalul deschiderilor de uși și codurile pentru oaspeți emise.',
        '3.6. Datele de contact: numărul de telefon și adresa de poștă electronică furnizate benevol de utilizator.',
        '3.7. Produsul nu solicită datele de pașaport, nu determină amplasarea dispozitivului și nu prelucrează corespondența utilizatorului din afara produsului.',
      ],
    },
    {
      heading: '4. Scopurile prelucrării',
      lines: [
        '4.1. Primirea și examinarea solicitărilor, stabilirea termenelor potrivit regulamentului operatorului și actelor normative, informarea cu privire la mersul lucrărilor.',
        '4.2. Calculul plății, primirea indicațiilor contoarelor și efectuarea plății.',
        '4.3. Desfășurarea adunării generale a proprietarilor și numărarea voturilor după cotele de suprafață ale locuințelor.',
        '4.4. Asigurarea accesului în scară și emiterea codurilor de unică folosință pentru oaspeți.',
        '4.5. Raportarea privind respectarea termenelor către utilizator și către organele de control.',
      ],
    },
    {
      heading: '5. Destinatarii datelor',
      lines: [
        '5.1. Organizațiile conexe, la transmiterea unei solicitări în afara zonei de responsabilitate a operatorului: organizația furnizoare de resurse, organizația antreprenoare, organul administrației publice locale, organul de supraveghere de stat în domeniul locativ. Se transmit esența solicitării și adresa obiectului.',
        '5.2. Serviciul de plăți, în cazul în care plata este conectată: suma și destinația plății.',
        '5.3. Serviciul de analiză automată a textului, în cazul în care este conectat de operator: textul solicitării sau al întrebării și informațiile despre utilizator în volumul disponibil acestuia în interfața produsului. Datele altor persoane nu se transmit. Rezultatul analizei are caracter auxiliar, deciziile pe solicitare sunt luate de operator.',
        '5.4. Platforma MAX, în volumul necesar pentru livrarea mesajelor.',
        '5.5. Transferul transfrontalier al datelor cu caracter personal nu se efectuează. Bazele de date sunt amplasate pe teritoriul Federației Ruse, în conformitate cu alineatul 5 al articolului 18 din Legea federală № 152-ФЗ.',
      ],
    },
    {
      heading: '6. Termenele de prelucrare și de păstrare',
      lines: [
        '6.1. Datele se prelucrează pe durata contractului de administrare a blocului de locuințe și pe durata termenelor de păstrare stabilite de legislație pentru documentele corespunzătoare.',
        '6.2. La expirarea termenelor, datele se șterg sau se anonimizează. Informațiile anonimizate despre solicitări se păstrează ca istoric al obiectului și nu permit identificarea persoanei vizate.',
      ],
    },
    {
      heading: '7. Drepturile persoanei vizate',
      lines: [
        '7.1. Obținerea informațiilor despre prelucrarea datelor proprii (articolul 14 din Legea federală № 152-ФЗ): comanda /mydata în chat-bot și secțiunea „Profil” din aplicație generează descărcarea datelor.',
        '7.2. Rectificarea, blocarea și ștergerea datelor (articolul 21 din Legea federală № 152-ФЗ): ștergerea profilului în secțiunea „Profil” anonimizează contul; informațiile despre solicitări și indicații se păstrează ca istoric al obiectului.',
        '7.3. Retragerea consimțământului în partea prelucrării efectuate în temeiul acestuia, inclusiv ștergerea numărului de telefon.',
        '7.4. Dezasocierea locuinței la încetarea dreptului de folosință asupra acesteia.',
        '7.5. Adresarea către operator la contactele din secțiunea „Asistență”, precum și către Serviciul Federal de Supraveghere în domeniul Comunicațiilor, Tehnologiei Informației și Comunicării în Masă.',
      ],
    },
    {
      heading: '8. Măsuri de protecție',
      lines: [
        '8.1. Accesul la date este delimitat pe roluri: utilizatorul primește acces la datele proprii, angajații operatorului, la datele în volumul atribuțiilor de serviciu, organizația antreprenoare, la sarcinile încredințate.',
        '8.2. Acțiunile angajaților operatorului se consemnează în jurnalul acțiunilor.',
        '8.3. Transmiterea datelor între aplicație și server se efectuează printr-un canal protejat; accesul se acordă pe baza parametrilor de pornire semnați de platformă.',
      ],
    },
    {
      heading: '9. Modificarea Politicii',
      lines: [
        '9.1. Redacția în vigoare este publicată la adresa domovoy.homes/privacy și este disponibilă în produs fără autorizare.',
        '9.2. La modificarea redacției care afectează drepturile persoanei vizate, produsul solicită consimțământul din nou.',
      ],
    },
  ],
};

const terms: LegalText = {
  slug: 'terms',
  title: 'Acordul de utilizare',
  short: 'Acordul de utilizare',
  about: 'Obiectul acordului, obligațiile părților, limitarea răspunderii',
  parts: [
    {
      heading: '1. Obiectul acordului',
      lines: [
        '1.1. Acordul stabilește condițiile de utilizare a produsului software „Domovoy”, care include un chat-bot și o mini-aplicație în sistemul informațional MAX.',
        '1.2. Începerea utilizării produsului înseamnă acceptarea condițiilor acordului și a politicii de prelucrare a datelor cu caracter personal.',
        '1.3. Serviciile de administrare a blocului de locuințe sunt prestate de organizația de administrare. Produsul asigură primirea solicitărilor, informarea și afișarea informațiilor despre activitatea organizației.',
      ],
    },
    {
      heading: '2. Obligațiile utilizatorului',
      lines: [
        '2.1. Să comunice informații veridice despre defecțiuni. Transmiterea unei solicitări de avarie vădit false distrage serviciul de dispecerat pentru avarii.',
        '2.2. Să transmită indicațiile contoarelor în conformitate cu valorile lor reale.',
        '2.3. Să nu includă în solicitări datele cu caracter personal și imaginile terților fără consimțământul acestora.',
        '2.4. Să răspundă pentru acțiunile săvârșite în produs din profilul său MAX.',
      ],
    },
    {
      heading: '3. Funcțiile produsului',
      lines: [
        '3.1. Înregistrarea solicitării, calcularea termenului de reacție și a termenului de execuție potrivit regulamentului organizației și actelor normative, afișarea mersului lucrărilor și a cronologiei.',
        '3.2. Notificarea privind modificările pe solicitările utilizatorului, privind lucrările din bloc și privind desfășurarea adunărilor generale ale proprietarilor.',
        '3.3. Primirea indicațiilor contoarelor, afișarea sumelor calculate și efectuarea plății în cazul în care serviciul de plăți este conectat.',
        '3.4. Gestionarea accesului în scară și emiterea codurilor pentru oaspeți în cazul în care echipamentul de interfonie este conectat.',
      ],
    },
    {
      heading: '4. Analiza automată a solicitărilor',
      lines: [
        '4.1. Analiza solicitărilor și răspunsurile asistentului sunt generate cu aplicarea unui model lingvistic și au caracter informativ.',
        '4.2. Valoare juridică are răspunsul organizației de administrare pe solicitare. Termenele se stabilesc prin acte normative și prin regulamentul organizației.',
        '4.3. În caz de neconcordanță între răspunsul informativ și răspunsul organizației, prioritate are răspunsul organizației.',
      ],
    },
    {
      heading: '5. Limitarea răspunderii',
      lines: [
        '5.1. Produsul nu poartă răspundere pentru calitatea lucrărilor executate și pentru deciziile organizației de administrare.',
        '5.2. Disponibilitatea produsului depinde de funcționarea sistemului informațional MAX, a operatorului de comunicații și a infrastructurii de servere a organizației.',
        '5.3. În situație de avarie, în perioada de indisponibilitate a produsului, solicitarea se transmite la telefonul serviciului de dispecerat pentru avarii indicat în secțiunea „Asistență”.',
      ],
    },
    {
      heading: '6. Încetarea utilizării',
      lines: [
        '6.1. Utilizatorul are dreptul să dezasocieze locuința și să șteargă profilul în secțiunea „Profil”.',
        '6.2. Organizația are dreptul să înceteze accesul la încetarea administrării blocului de locuințe.',
        '6.3. Redacția în vigoare a acordului este publicată la adresa domovoy.homes/terms.',
      ],
    },
  ],
};

export const ro: LegalText[] = [privacy, terms];

export const roNotes: LegalNotes = {
  updated: 'Redacția din {date}',
  prevails: 'Valoare juridică are redacția în limba rusă',
  languages: 'Limba documentului',
};
