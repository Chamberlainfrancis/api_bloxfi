/**
 * File upload & KYB document types. Spec §1.4, §1.5.
 */

/** Response 201 for POST /files */
export interface UploadFileResponse {
  fileId: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string; // ISO 8601
}

/** Document type for POST /users/:userId/kyb/documents */
export type KybDocumentType =
  | 'CERTIFICATE_OF_INCORPORATION'
  | 'ARTICLES_OF_ASSOCIATION'
  | 'PROOF_OF_ADDRESS'
  | 'DIRECTOR_ID'
  | 'BENEFICIAL_OWNER_ID'
  | 'TAX_REGISTRATION'
  | 'BANK_STATEMENT'
  | 'SHAREHOLDERS_REGISTER';

export interface AttachDocumentItem {
  type: KybDocumentType;
  fileId: string;
  subType?: string; // e.g. PASSPORT for DIRECTOR_ID
  issuedCountry?: string;
  issueDate?: string;
  expiryDate?: string | null;
  documentNumber?: string;
  ownerName?: string;
}

/** Response 201 for POST /users/:userId/kyb/documents */
export interface AttachDocumentsResponse {
  documentsAdded: number;
  documents: Array<{
    id: string;
    type: string;
    status: string;
    uploadedAt: string; // ISO 8601
  }>;
}
