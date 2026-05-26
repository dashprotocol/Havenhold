/**
 * Frontend feature flags — mirrors the backend flags module.
 *
 * Values are baked in at Vite build time from VITE_* env vars.
 * Safe defaults match the backend so the app works out of the box
 * without any extra env configuration.
 *
 * VITE_DEMO_MODE            default: true
 * VITE_PIPELINE_ENABLED     default: true
 * VITE_INTEGRATIONS_ENABLED default: false
 */

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return defaultValue;
}

export const flags = {
  DEMO_MODE:            parseBool(import.meta.env.VITE_DEMO_MODE,            true),
  PIPELINE_ENABLED:     parseBool(import.meta.env.VITE_PIPELINE_ENABLED,     true),
  INTEGRATIONS_ENABLED: parseBool(import.meta.env.VITE_INTEGRATIONS_ENABLED, false),
} as const;
