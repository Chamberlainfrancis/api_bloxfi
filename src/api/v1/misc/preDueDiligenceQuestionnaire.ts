/**
 * Pre-due diligence questionnaire (v2) served by GET /api/v1/misc/pre-due-diligence-questionnaire.
 * Mirrors new-app-backend PRE_DUE_DILIGENCE_QUESTIONNAIRE for partner clients.
 */

export interface QuestionnaireFieldV2 {
  name: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'file' | 'url';
  required: boolean;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  dependsOn?: {
    field: string;
    value: string | string[];
  };
  accept?: string;
  maxFiles?: number;
}

export interface BankAccountQuestionnaireV2 {
  title: string;
  description: string;
  version: 2;
  sections: Array<{
    id: string;
    title: string;
    description?: string;
    fields: QuestionnaireFieldV2[];
  }>;
}

export const PRE_DUE_DILIGENCE_QUESTIONNAIRE: BankAccountQuestionnaireV2 = {
  title: 'Pre-Due Diligence Form',
  description:
    'Please provide additional information to help us verify your account purpose and source of funds',
  version: 2,
  sections: [
    {
      id: 'income_source',
      title: 'Source of Income',
      description: 'Tell us about your primary source of income',
      fields: [
        {
          name: 'incomeType',
          label: 'What best describes your situation?',
          type: 'select',
          required: true,
          options: [
            { value: 'freelancer', label: 'I am a freelancer' },
            { value: 'full_time_job', label: 'I have a full time job' },
            {
              value: 'content_creator',
              label: 'I am a content creator (Youtuber, Blogger)',
            },
            { value: 'independent_consultant', label: "I'm an independent consultant" },
            {
              value: 'family_support',
              label: "I'm financially supported by family and friends",
            },
            { value: 'business_payments', label: 'I receive business payments' },
            { value: 'diaspora_expat', label: 'I am in diaspora / an expat' },
          ],
        },
      ],
    },
    {
      id: 'freelancer_details',
      title: 'Freelancer Details',
      fields: [
        {
          name: 'freelancePlatform',
          label: 'Which freelance platform do you use?',
          type: 'select',
          required: true,
          options: [
            { value: 'fiverr', label: 'Fiverr' },
            { value: 'upwork', label: 'Upwork' },
            { value: 'toptal', label: 'Toptal' },
            { value: 'other', label: 'Other' },
          ],
          dependsOn: { field: 'incomeType', value: 'freelancer' },
        },
        {
          name: 'freelancePlatformOther',
          label: 'Please specify the platform',
          type: 'text',
          required: true,
          placeholder: 'Enter platform name',
          dependsOn: { field: 'freelancePlatform', value: 'other' },
        },
        {
          name: 'freelanceProfileUrl',
          label: 'Your freelance profile URL',
          type: 'url',
          required: true,
          placeholder: 'https://...',
          hint: 'Link to your profile on the freelance platform',
          dependsOn: { field: 'incomeType', value: 'freelancer' },
        },
        {
          name: 'linkedinProfileUrl',
          label: 'LinkedIn Profile URL (optional)',
          type: 'url',
          required: false,
          placeholder: 'https://linkedin.com/in/...',
          dependsOn: { field: 'incomeType', value: 'freelancer' },
        },
      ],
    },
    {
      id: 'full_time_job_details',
      title: 'Employment Details',
      fields: [
        {
          name: 'employerName',
          label: 'Which organization do you work for?',
          type: 'text',
          required: true,
          placeholder: 'Enter company/organization name',
          dependsOn: { field: 'incomeType', value: 'full_time_job' },
        },
      ],
    },
    {
      id: 'content_creator_details',
      title: 'Content Creator Details',
      fields: [
        {
          name: 'contentPlatform',
          label: 'What platform do you anticipate payment from?',
          type: 'select',
          required: true,
          options: [
            { value: 'youtube', label: 'YouTube' },
            { value: 'facebook', label: 'Facebook' },
            { value: 'twitter', label: 'X (Twitter)' },
            { value: 'tiktok', label: 'TikTok' },
            { value: 'instagram', label: 'Instagram' },
            { value: 'other', label: 'Other' },
          ],
          dependsOn: { field: 'incomeType', value: 'content_creator' },
        },
        {
          name: 'contentPlatformOther',
          label: 'Please specify the platform',
          type: 'text',
          required: true,
          placeholder: 'Enter platform name',
          dependsOn: { field: 'contentPlatform', value: 'other' },
        },
        {
          name: 'contentProfileUrl',
          label: 'Your content profile/channel URL',
          type: 'url',
          required: true,
          placeholder: 'https://...',
          hint: 'Link to your profile or channel',
          dependsOn: { field: 'incomeType', value: 'content_creator' },
        },
      ],
    },
    {
      id: 'family_support_details',
      title: 'Family Support Details',
      fields: [
        {
          name: 'fundsPurpose',
          label: 'What is the purpose of the funds?',
          type: 'select',
          required: true,
          options: [
            { value: 'family_support', label: 'Family Support' },
            { value: 'gift', label: 'Gift' },
            { value: 'family_project', label: 'Family Project' },
          ],
          dependsOn: { field: 'incomeType', value: 'family_support' },
        },
        {
          name: 'senderName',
          label: 'Name of family member/friend sending funds',
          type: 'text',
          required: true,
          placeholder: 'Enter full name',
          dependsOn: { field: 'incomeType', value: 'family_support' },
        },
        {
          name: 'senderRelationship',
          label: 'Relationship to sender',
          type: 'select',
          required: true,
          options: [
            { value: 'parent', label: 'Parent' },
            { value: 'sibling', label: 'Sibling' },
            { value: 'spouse', label: 'Spouse' },
            { value: 'child', label: 'Child' },
            { value: 'friend', label: 'Friend' },
            { value: 'other_relative', label: 'Other Relative' },
          ],
          dependsOn: { field: 'incomeType', value: 'family_support' },
        },
      ],
    },
    {
      id: 'business_payment_details',
      title: 'Business Payment Details',
      fields: [
        {
          name: 'businessType',
          label: 'What type of business do you operate?',
          type: 'text',
          required: true,
          placeholder: 'e.g., E-commerce, Consulting, etc.',
          dependsOn: { field: 'incomeType', value: 'business_payments' },
        },
        {
          name: 'businessRegistrationDocument',
          label: 'Business Registration Certificate (CAC)',
          type: 'file',
          required: true,
          hint: 'Upload your CAC certificate. You must be listed as the Ultimate Beneficial Owner (UBO).',
          accept: 'image/*,application/pdf',
          maxFiles: 1,
          dependsOn: { field: 'incomeType', value: 'business_payments' },
        },
      ],
    },
    {
      id: 'diaspora_expat_details',
      title: 'Diaspora / Expat Verification',
      fields: [
        {
          name: 'diasporaProofDocument',
          label: 'Proof of Diaspora Status',
          type: 'file',
          required: true,
          hint: 'Upload one of: Valid work visa, employment visa, foreign residence permit, or residence card.',
          accept: 'image/*,application/pdf',
          maxFiles: 2,
          dependsOn: { field: 'incomeType', value: 'diaspora_expat' },
        },
      ],
    },
    {
      id: 'transaction_expectations',
      title: 'Transaction Expectations',
      description: 'Help us understand your expected transaction patterns',
      fields: [
        {
          name: 'expectedAmountPerTransaction',
          label: 'Maximum amount you anticipate receiving per transaction ($)',
          type: 'select',
          required: true,
          options: [
            { value: '0-999', label: '$0 - $999' },
            { value: '1000-4999', label: '$1,000 - $4,999' },
            { value: '5000-9999', label: '$5,000 - $9,999' },
            { value: '10000+', label: '$10,000+' },
          ],
          dependsOn: {
            field: 'incomeType',
            value: [
              'freelancer',
              'full_time_job',
              'content_creator',
              'independent_consultant',
            ],
          },
        },
        {
          name: 'expectedPaymentFrequency',
          label: 'How frequently do you expect to receive payment?',
          type: 'select',
          required: true,
          options: [
            { value: 'weekly', label: 'Weekly' },
            { value: 'biweekly', label: 'Bi-weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'irregular', label: 'Irregular/As needed' },
          ],
          dependsOn: {
            field: 'incomeType',
            value: [
              'freelancer',
              'full_time_job',
              'content_creator',
              'independent_consultant',
            ],
          },
        },
      ],
    },
  ],
};
