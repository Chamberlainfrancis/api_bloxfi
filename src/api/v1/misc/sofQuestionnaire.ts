/**
 * USD Account / Source-of-Funds questionnaire served by
 * GET /api/v1/misc/source-of-funds-questionnaire.
 * Onramp account create answers must match these field names/values.
 */

export interface SofQuestionnaireField {
  name: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'file' | 'url';
  required: boolean;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  accept?: string;
}

export interface SofQuestionnaire {
  title: string;
  description: string;
  fields: SofQuestionnaireField[];
}

export const OCCUPATION_CODES = [
  { value: '132011', label: 'Accountant and auditor' },
  { value: '272011', label: 'Actor' },
  { value: '152011', label: 'Actuary' },
  { value: '291291', label: 'Acupuncturist' },
  { value: '519191', label: 'Adhesive bonding machine operator and tender' },
  { value: '113012', label: 'Administrative services manager' },
  { value: '112011', label: 'Advertising and promotions manager' },
  { value: '413011', label: 'Advertising sales agent' },
  { value: '172011', label: 'Aerospace engineer' },
  { value: '131011', label: 'Agent and business manager of artists performers and athletes' },
  { value: '194010', label: 'Agricultural and food science technician' },
  { value: '191010', label: 'Agricultural and food scientist' },
  { value: '172021', label: 'Agricultural engineer' },
  { value: '452011', label: 'Agricultural inspector' },
  { value: '493011', label: 'Aircraft mechanic and service technician' },
  { value: '532010', label: 'Aircraft pilots and flight engineer' },
  { value: '512011', label: 'Aircraft structure surfaces rigging and systems assembler' },
  { value: '532020', label: 'Air traffic controller and airfield operations specialist' },
  { value: '533011', label: 'Ambulance driver and attendant except emergency medical technician' },
  { value: '452021', label: 'Animal breeder' },
  { value: '392021', label: 'Animal caretaker' },
  { value: '339011', label: 'Animal control worker' },
  { value: '392011', label: 'Animal trainer' },
  { value: '171011', label: 'Architect except landscape and naval' },
  { value: '173011', label: 'Architectural and civil drafter' },
  { value: '119041', label: 'Architectural and engineering manager' },
  { value: '254010', label: 'Archivist curator and museum technician' },
  { value: '271010', label: 'Artist and related worker' },
  { value: '192010', label: 'Astronomer and physicist' },
  { value: '272021', label: 'Athletes and sports competitor' },
  { value: '192021', label: 'Atmospheric and space scientist' },
  { value: '151251', label: 'Software Developers and Programmers' },
  { value: '999999', label: 'Unemployed with no work experience' },
] as const;

export const SOF_QUESTIONNAIRE: SofQuestionnaire = {
  title: 'USD Account Questionnaire',
  description: 'Please provide the following information to complete your bank account request',
  fields: [
    {
      name: 'employmentStatus',
      label: 'Employment Status',
      type: 'select',
      required: true,
      options: [
        { value: 'employed', label: 'Employed' },
        { value: 'self_employed', label: 'Self Employed' },
        { value: 'unemployed', label: 'Unemployed' },
        { value: 'student', label: 'Student' },
        { value: 'retired', label: 'Retired' },
      ],
    },
    {
      name: 'expectedMonthlyPayments',
      label: 'Expected Monthly Payments (USD)',
      type: 'select',
      required: true,
      options: [
        { value: '0_4999', label: '$0 - $4,999' },
        { value: '5000_9999', label: '$5,000 - $9,999' },
        { value: '10000_49999', label: '$10,000 - $49,999' },
      ],
    },
    {
      name: 'primaryPurpose',
      label: 'Primary Purpose of Account',
      type: 'select',
      required: true,
      options: [
        { value: 'personal', label: 'Personal' },
        { value: 'business', label: 'Business' },
        { value: 'salary', label: 'Salary' },
        { value: 'freelance', label: 'Freelance' },
      ],
    },
    {
      name: 'sourceOfFunds',
      label: 'Source of Funds',
      type: 'select',
      required: true,
      options: [
        { value: 'salary', label: 'Salary' },
        { value: 'savings', label: 'Savings' },
        { value: 'business', label: 'Business' },
        { value: 'freelance', label: 'Freelance' },
        { value: 'investment', label: 'Investment' },
        { value: 'government_benefits', label: 'Government Benefits' },
        { value: 'pension', label: 'Pension' },
      ],
    },
    {
      name: 'mostRecentOccupation',
      label: 'Most Recent Occupation',
      // Free text for Graph (`background_information.occupation`); SOC codes
      // in OCCUPATION_CODES remain available as client-side suggestions only.
      type: 'text',
      required: false,
      placeholder: 'e.g. Software Developer',
      hint: 'Free-text occupation title (Graph). Optional SOC codes in OCCUPATION_CODES may be used as suggestions.',
    },
    {
      name: 'sourceOfFundsDocument',
      label: 'Source of Funds Document',
      type: 'url',
      required: false,
      hint: 'HTTPS URL to a PDF, JPEG, or PNG. May also be sent as top-level sourceOfFundsDocument.',
      accept: 'application/pdf,image/jpeg,image/png',
    },
  ],
};
