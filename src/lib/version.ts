/**
 * Build-stamped version (git short hash + build time), visible in the header.
 * Under vitest `define` isn't applied, so guard the constant at runtime.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev build'
