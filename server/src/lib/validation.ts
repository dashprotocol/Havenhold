import { AnalysisType, type Severity } from '@prisma/client';

export interface MedicationInteractionCandidate {
  medicationA: string;
  medicationB: string;
  severity: Severity;
  description: string;
}

const VALID_ANALYSIS_TYPES = new Set<AnalysisType>(Object.values(AnalysisType));

export function getAnalysisType(value: unknown): AnalysisType {
  if (typeof value === 'string' && VALID_ANALYSIS_TYPES.has(value as AnalysisType)) {
    return value as AnalysisType;
  }
  return AnalysisType.BALANCED;
}

export function normalizeSeverity(value: unknown): Severity | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'MILD' || normalized === 'MODERATE' || normalized === 'SEVERE') {
    return normalized;
  }
  return null;
}

export function toMedicationInteractionCandidate(value: unknown): MedicationInteractionCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const severity = normalizeSeverity(record.severity);

  if (
    typeof record.medicationA !== 'string' ||
    typeof record.medicationB !== 'string' ||
    !severity ||
    typeof record.description !== 'string'
  ) {
    return null;
  }

  return {
    medicationA: record.medicationA,
    medicationB: record.medicationB,
    severity,
    description: record.description,
  };
}

export function sanitizeQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((question) => question.trim())
    .filter((question) => question.length > 0);
}
