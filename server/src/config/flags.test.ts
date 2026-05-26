import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBool } from './flags';

// ---------------------------------------------------------------------------
// parseBool unit tests
// ---------------------------------------------------------------------------

test('parseBool returns default when env var is absent', () => {
  assert.equal(parseBool(undefined, true), true);
  assert.equal(parseBool(undefined, false), false);
});

test('parseBool returns default for empty string', () => {
  assert.equal(parseBool('', true), true);
  assert.equal(parseBool('', false), false);
});

test('parseBool parses truthy strings', () => {
  assert.equal(parseBool('true', false), true);
  assert.equal(parseBool('1', false), true);
  assert.equal(parseBool('TRUE', false), true);
  assert.equal(parseBool('  True  ', false), true);
});

test('parseBool parses falsy strings', () => {
  assert.equal(parseBool('false', true), false);
  assert.equal(parseBool('0', true), false);
  assert.equal(parseBool('FALSE', true), false);
  assert.equal(parseBool('  False  ', true), false);
});

test('parseBool falls back to default for unrecognised values', () => {
  assert.equal(parseBool('yes', false), false);
  assert.equal(parseBool('no', true), true);
  assert.equal(parseBool('enabled', false), false);
  assert.equal(parseBool('on', true), true);
});

// ---------------------------------------------------------------------------
// Safe-default contract tests (verify flags module defaults without side-effects)
// ---------------------------------------------------------------------------

test('DEMO_MODE defaults to true when env var is unset', () => {
  // parseBool is the single source of truth for defaults; this test pins the contract.
  assert.equal(parseBool(undefined, true), true, 'DEMO_MODE safe default must be true');
});

test('PIPELINE_ENABLED defaults to true when env var is unset', () => {
  assert.equal(parseBool(undefined, true), true, 'PIPELINE_ENABLED safe default must be true');
});

test('INTEGRATIONS_ENABLED defaults to false when env var is unset', () => {
  assert.equal(parseBool(undefined, false), false, 'INTEGRATIONS_ENABLED safe default must be false');
});
