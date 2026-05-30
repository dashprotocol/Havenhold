import { describe, expect, it } from 'vitest';
import { AnalysisType } from '@prisma/client';
import {
  getAnalysisType,
  normalizeSeverity,
  sanitizeQuestions,
  toMedicationInteractionCandidate,
} from './validation';

describe('validation helpers', () => {
  it('normalizeSeverity accepts case-insensitive values', () => {
    expect(normalizeSeverity('Severe')).toBe('SEVERE');
    expect(normalizeSeverity(' moderate ')).toBe('MODERATE');
    expect(normalizeSeverity('MILD')).toBe('MILD');
    expect(normalizeSeverity('unknown')).toBeNull();
  });

  it('toMedicationInteractionCandidate validates and normalizes payloads', () => {
    const candidate = toMedicationInteractionCandidate({
      medicationA: 'Warfarin',
      medicationB: 'Aspirin',
      severity: 'Severe',
      description: 'Increased bleeding risk',
    });

    expect(candidate).toEqual({
      medicationA: 'Warfarin',
      medicationB: 'Aspirin',
      severity: 'SEVERE',
      description: 'Increased bleeding risk',
    });

    expect(
      toMedicationInteractionCandidate({ medicationA: 'A', medicationB: 'B', severity: 'invalid', description: 'x' }),
    ).toBeNull();
  });

  it('sanitizeQuestions keeps only non-empty strings', () => {
    const questions = sanitizeQuestions(['What changed?', 42, { q: 'next?' }, '   ', 'How often?']);
    expect(questions).toEqual(['What changed?', 'How often?']);
    expect(sanitizeQuestions('not-an-array')).toEqual([]);
  });

  it('getAnalysisType falls back safely', () => {
    expect(getAnalysisType('SCIENTIFIC')).toBe(AnalysisType.SCIENTIFIC);
    expect(getAnalysisType('NOT_A_TYPE')).toBe(AnalysisType.BALANCED);
    expect(getAnalysisType(undefined)).toBe(AnalysisType.BALANCED);
  });
});
