/**
 * Strips common PHI patterns from text before sending to any AI API.
 * Dates are intentionally kept — they are needed for appointment extraction
 * and are not the primary re-identification risk. The high-risk identifiers
 * are SSNs, contact info, and record numbers.
 * Production path: Anthropic BAA + proper NER-based de-identification.
 */
export function deidentify(text: string): string {
  return text
    // SSN
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
    // Phone numbers
    .replace(/\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // MRN / medical record numbers
    .replace(/\bMRN[:\s#]*\d+\b/gi, 'MRN: [MRN]');
}
