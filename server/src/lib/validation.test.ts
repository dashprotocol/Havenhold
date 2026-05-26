import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisType } from '@prisma/client';
import {
  getAnalysisType,
  normalizeSeverity,
  sanitizeQuestions,
  toMedicationInteractionCandidate,
} from './validation';

test('normalizeSeverity accepts case-insensitive values', () => {
  assert.equal(normalizeSeverity('Severe'), 'SEVERE');
  assert.equal(normalizeSeverity(' moderate '), 'MODERATE');
  assert.equal(normalizeSeverity('MILD'), 'MILD');
  assert.equal(normalizeSeverity('unknown'), null);
});

test('toMedicationInteractionCandidate validates and normalizes payloads', () => {
  const candidate = toMedicationInteractionCandidate({
    medicationA: 'Warfarin',
    medicationB: 'Aspirin',
    severity: 'Severe',
    description: 'Increased bleeding risk',
  });

  assert.deepEqual(candidate, {
    medicationA: 'Warfarin',
    medicationB: 'Aspirin',
    severity: 'SEVERE',
    description: 'Increased bleeding risk',
  });

  assert.equal(
    toMedicationInteractionCandidate({ medicationA: 'A', medicationB: 'B', severity: 'invalid', description: 'x' }),
    null,
  );
});

test('sanitizeQuestions keeps only non-empty strings', () => {
  const questions = sanitizeQuestions(['What changed?', 42, { q: 'next?' }, '   ', 'How often?']);
  assert.deepEqual(questions, ['What changed?', 'How often?']);
  assert.deepEqual(sanitizeQuestions('not-an-array'), []);
});

test('getAnalysisType falls back safely', () => {
  assert.equal(getAnalysisType('SCIENTIFIC'), AnalysisType.SCIENTIFIC);
  assert.equal(getAnalysisType('NOT_A_TYPE'), AnalysisType.BALANCED);
  assert.equal(getAnalysisType(undefined), AnalysisType.BALANCED);
});
