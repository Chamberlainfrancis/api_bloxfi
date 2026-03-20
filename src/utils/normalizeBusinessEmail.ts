/** Normalize businessInfo.email for uniqueness (ASCII lower + trim). */
export function normalizeBusinessEmail(email: string): string {
  return email.trim().toLowerCase();
}
