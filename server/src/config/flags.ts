/**
 * Feature flags — single source of truth for all backend runtime toggles.
 *
 * Values are read once at module load from process.env.
 * Safe defaults are chosen so the server runs correctly out of the box
 * with a minimal .env (i.e. for local dev and demo deployments).
 *
 * PIPELINE_ENABLED     default: true   — enables the AI document processing pipeline.
 *                                        false blocks /documents/upload entirely (503).
 * INTEGRATIONS_ENABLED default: false  — reserved for future third-party integrations
 *                                        (e.g. EHR sync, pharmacy APIs). Currently a no-op.
 *                                        Defaults off so no outbound calls are made unless
 *                                        explicitly opted in.
 */

/**
 * Parse a string env var as a boolean.
 * Accepts "true" / "1" → true, "false" / "0" → false.
 * Any other value (including undefined / empty string) returns `defaultValue`.
 */
export function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return defaultValue;
}

export const flags = {
  PIPELINE_ENABLED:     parseBool(process.env.PIPELINE_ENABLED,     true),
  INTEGRATIONS_ENABLED: parseBool(process.env.INTEGRATIONS_ENABLED, false),
} as const;

export type Flags = typeof flags;
