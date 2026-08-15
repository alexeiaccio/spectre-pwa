import type { Site, Vault } from './schema.ts'

/** Append a site to an identity, returning a new Vault (no-op if the identity is missing). */
export const addSite = (
  vault: Vault,
  identityId: string,
  site: Site,
): Vault => ({
  ...vault,
  identities: vault.identities.map((i) =>
    i.id === identityId ? { ...i, sites: [...i.sites, site] } : i,
  ),
})

/** Replace one site in place (matched by id). No-op if the site or identity is missing. */
export const updateSite = (
  vault: Vault,
  identityId: string,
  site: Site,
): Vault => ({
  ...vault,
  identities: vault.identities.map((i) =>
    i.id === identityId
      ? { ...i, sites: i.sites.map((st) => (st.id === site.id ? site : st)) }
      : i,
  ),
})

/** Remove one site by id. No-op if the site or identity is missing. */
export const deleteSite = (
  vault: Vault,
  identityId: string,
  siteId: string,
): Vault => ({
  ...vault,
  identities: vault.identities.map((i) =>
    i.id === identityId
      ? { ...i, sites: i.sites.filter((st) => st.id !== siteId) }
      : i,
  ),
})

/** Remove an identity by id. No-op if the identity is missing. */
export const deleteIdentity = (vault: Vault, identityId: string): Vault => ({
  ...vault,
  identities: vault.identities.filter((i) => i.id !== identityId),
})

/** Record the Spectre passphrase on an identity (auto-unlocks future visits). */
export const setIdentityPassphrase = (
  vault: Vault,
  identityId: string,
  passphrase: string,
): Vault => ({
  ...vault,
  identities: vault.identities.map((i) =>
    i.id === identityId ? { ...i, passphrase } : i,
  ),
})
