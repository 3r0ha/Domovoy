import type { LegalNotes, LegalText } from './text.js';

const privacy: LegalText = {
  slug: 'privacy',
  title: 'Personal Data Processing Policy',
  short: 'Data Processing Policy',
  about: 'Composition of the data, grounds for processing, recipients, storage periods and the rights of the data subject',
  parts: [
    {
      heading: '1. General provisions',
      lines: [
        '1.1. The Policy determines the procedure for processing personal data in the software product "Domovoy" (hereinafter, the product).',
        '1.2. The operator of personal data is the management organisation servicing the apartment building of the user. The operator determines the purposes of processing and is answerable for it to the personal data subject and to the supervisory authorities.',
        '1.3. The product processes personal data on the instructions of the operator on the basis of part 3 of article 6 of Federal Law of 27.07.2006 № 152-ФЗ, has no purposes of processing of its own and does not transfer data to third parties outside those instructions.',
        '1.4. The name and contact details of the operator are given in the "Support" section of the product.',
      ],
    },
    {
      heading: '2. Legal grounds for processing',
      lines: [
        '2.1. The apartment building management contract and the performance of obligations under it: clause 5 of part 1 of article 6 of Federal Law № 152-ФЗ, article 161 of the Housing Code of the Russian Federation.',
        '2.2. The performance of obligations imposed on the operator by legislation: clause 2 of part 1 of article 6 of Federal Law № 152-ФЗ, the Rules for carrying out activities in the management of apartment buildings (Decree of the Government of the Russian Federation of 15.05.2013 № 416), the Rules for the provision of utility services (Decree of the Government of the Russian Federation of 06.05.2011 № 354).',
        '2.3. Interaction with owners and users of premises in the MAX information system is provided for by Rules № 416 as amended by Decree of the Government of the Russian Federation of 26.01.2026 № 40.',
        '2.4. The consent of the personal data subject: in the part going beyond the grounds specified in clauses 2.1 and 2.2, including where a telephone number is provided voluntarily.',
      ],
    },
    {
      heading: '3. Composition of the data processed',
      lines: [
        '3.1. MAX profile data: the user identifier, the first name and the surname to the extent transferred by the platform.',
        '3.2. Address data: the building, the entrance, the riser and the premises to which the user is linked, the code for linking the premises.',
        '3.3. Request data: the text of the request, the attached photographs and voice messages, the correspondence on the service request, the rating of the works performed.',
        '3.4. Settlement data: meter readings, charges, payments, debt and penalties.',
        '3.5. Building data: voting at the general meeting of owners, appointment booking, the log of door openings and the guest codes issued.',
        '3.6. Contact data: the telephone number and the e-mail address provided by the user voluntarily.',
        '3.7. The product does not request passport data, does not determine the location of the device and does not process the correspondence of the user outside the product.',
      ],
    },
    {
      heading: '4. Purposes of processing',
      lines: [
        '4.1. Receipt and consideration of requests, the setting of deadlines under the regulations of the operator and under regulatory legal acts, informing about the progress of the works.',
        '4.2. Calculation of charges, receipt of meter readings and execution of payment.',
        '4.3. Holding of the general meeting of owners and counting of votes by shares of the area of the premises.',
        '4.4. Provision of access to the entrance and issue of one-time guest codes.',
        '4.5. Reporting on the observance of deadlines to the user and to the supervisory authorities.',
      ],
    },
    {
      heading: '5. Recipients of the data',
      lines: [
        '5.1. Adjacent organisations where a request is transferred outside the area of responsibility of the operator: the utility supplier, the contractor organisation, the local self-government body, the state housing supervision body. The substance of the request and the address of the object are transferred.',
        '5.2. The payment service where payment is connected: the amount and the purpose of the payment.',
        '5.3. The automatic text analysis service where it is connected by the operator: the text of the request or of the question and information about the user to the extent available to the user in the interface of the product. The data of other persons is not transferred. The result of the analysis is of an auxiliary nature; decisions on a request are taken by the operator.',
        '5.4. The MAX platform to the extent necessary for the delivery of messages.',
        '5.5. Cross-border transfer of personal data is not carried out. The databases are located in the territory of the Russian Federation in accordance with part 5 of article 18 of Federal Law № 152-ФЗ.',
      ],
    },
    {
      heading: '6. Periods of processing and storage',
      lines: [
        '6.1. The data is processed during the term of the apartment building management contract and during the storage periods established by legislation for the corresponding documents.',
        '6.2. Upon expiry of those periods the data is deleted or anonymised. Anonymised information on requests is kept as the history of the object and does not allow the personal data subject to be identified.',
      ],
    },
    {
      heading: '7. Rights of the personal data subject',
      lines: [
        '7.1. Obtaining information on the processing of their own data (article 14 of Federal Law № 152-ФЗ): the /mydata command in the chat bot and the "Profile" section in the app generate an export.',
        '7.2. Rectification, blocking and deletion of data (article 21 of Federal Law № 152-ФЗ): deletion of the profile in the "Profile" section anonymises the account; information on requests and readings is kept as the history of the object.',
        '7.3. Withdrawal of consent in respect of the processing carried out on its basis, including deletion of the telephone number.',
        '7.4. Unlinking of the premises upon termination of the right to use them.',
        '7.5. Application to the operator using the contacts from the "Support" section, and also to the Federal Service for Supervision of Communications, Information Technology and Mass Media.',
      ],
    },
    {
      heading: '8. Protection measures',
      lines: [
        '8.1. Access to the data is differentiated by role: the user obtains access to their own data, the employees of the operator, to the data within the scope of their official duties, the contractor organisation, to the tasks assigned to it.',
        '8.2. The actions of the employees of the operator are recorded in the action log.',
        '8.3. The transfer of data between the app and the server is carried out over a protected channel; access is granted on the basis of launch parameters signed by the platform.',
      ],
    },
    {
      heading: '9. Amendment of the Policy',
      lines: [
        '9.1. The current version is placed at domovoy.homes/privacy and is available in the product without authorisation.',
        '9.2. Where an amendment of the version affects the rights of the personal data subject, the product requests consent again.',
      ],
    },
  ],
};

const terms: LegalText = {
  slug: 'terms',
  title: 'User Agreement',
  short: 'User Agreement',
  about: 'Subject of the agreement, obligations of the parties, limitation of liability',
  parts: [
    {
      heading: '1. Subject of the agreement',
      lines: [
        '1.1. The Agreement determines the conditions of use of the software product "Domovoy", comprising a chat bot and a mini app in the MAX information system.',
        '1.2. The commencement of use of the product means acceptance of the conditions of the Agreement and of the personal data processing policy.',
        '1.3. Services for the management of the apartment building are rendered by the management organisation. The product provides for the receipt of requests, for informing and for the display of information on the work of the organisation.',
      ],
    },
    {
      heading: '2. Obligations of the user',
      lines: [
        '2.1. To report reliable information on faults. The submission of a knowingly false emergency request distracts the emergency dispatch service.',
        '2.2. To submit meter readings in accordance with their actual values.',
        '2.3. Not to place in requests the personal data and images of third parties without their consent.',
        '2.4. To bear responsibility for the actions performed in the product from their own MAX profile.',
      ],
    },
    {
      heading: '3. Functions of the product',
      lines: [
        '3.1. Registration of a request, calculation of the response deadline and of the completion deadline under the regulations of the organisation and under regulatory legal acts, display of the progress of the works and of their chronology.',
        '3.2. Notification of changes on the requests of the user, of works in the building and of the holding of general meetings of owners.',
        '3.3. Receipt of meter readings, display of charges and execution of payment where the payment service is connected.',
        '3.4. Management of access to the entrance and issue of guest codes where intercom equipment is connected.',
      ],
    },
    {
      heading: '4. Automatic analysis of requests',
      lines: [
        '4.1. The analysis of requests and the answers of the assistant are generated with the use of a language model and are of a reference nature.',
        '4.2. The answer of the management organisation on a request is the legally significant one. Deadlines are established by regulatory legal acts and by the regulations of the organisation.',
        '4.3. Where a reference answer diverges from the answer of the organisation, the answer of the organisation prevails.',
      ],
    },
    {
      heading: '5. Limitation of liability',
      lines: [
        '5.1. The product bears no liability for the quality of the works performed or for the decisions of the management organisation.',
        '5.2. The availability of the product depends on the operation of the MAX information system, of the communications operator and of the server infrastructure of the organisation.',
        '5.3. In an emergency situation during a period of unavailability of the product, a request shall be made by the telephone of the emergency dispatch service indicated in the "Support" section.',
      ],
    },
    {
      heading: '6. Termination of use',
      lines: [
        '6.1. The user has the right to unlink the premises and to delete the profile in the "Profile" section.',
        '6.2. The organisation has the right to terminate access upon termination of the management of the apartment building.',
        '6.3. The current version of the Agreement is placed at domovoy.homes/terms.',
      ],
    },
  ],
};

export const en: LegalText[] = [privacy, terms];

export const enNotes: LegalNotes = {
  updated: 'Version of {date}',
  prevails: 'The Russian version is the legally binding one',
  languages: 'Document language',
};
