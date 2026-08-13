/// <reference types="@cloudflare/workers-types" />
/**
 * Spectre Pocket static-site Worker.
 *
 * Re-serves the built `dist/` (bound as ASSETS, SPA fallback to /index.html
 * handled by `not_found_handling` in wrangler.toml). Stateless passthrough: no
 * routes, no logic, no storage — the vault (IndexedDB) and passkeys live in the
 * browser and never cross this worker.
 */
export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    return env.ASSETS.fetch(request)
  },
}
