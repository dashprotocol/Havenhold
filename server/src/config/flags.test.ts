import { describe, expect, it } from 'vitest';
import { parseBool } from './flags';

describe('parseBool', () => {
  it('returns default when env var is absent', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
  });

  it('returns default for empty string', () => {
    expect(parseBool('', true)).toBe(true);
    expect(parseBool('', false)).toBe(false);
  });

  it('parses truthy strings', () => {
    expect(parseBool('true', false)).toBe(true);
    expect(parseBool('1', false)).toBe(true);
    expect(parseBool('TRUE', false)).toBe(true);
    expect(parseBool('  True  ', false)).toBe(true);
  });

  it('parses falsy strings', () => {
    expect(parseBool('false', true)).toBe(false);
    expect(parseBool('0', true)).toBe(false);
    expect(parseBool('FALSE', true)).toBe(false);
    expect(parseBool('  False  ', true)).toBe(false);
  });

  it('falls back to default for unrecognised values', () => {
    expect(parseBool('yes', false)).toBe(false);
    expect(parseBool('no', true)).toBe(true);
    expect(parseBool('enabled', false)).toBe(false);
    expect(parseBool('on', true)).toBe(true);
  });
});

describe('safe defaults', () => {
  it('PIPELINE_ENABLED defaults to true when env var is unset', () => {
    expect(parseBool(undefined, true)).toBe(true);
  });

  it('INTEGRATIONS_ENABLED defaults to false when env var is unset', () => {
    expect(parseBool(undefined, false)).toBe(false);
  });
});
