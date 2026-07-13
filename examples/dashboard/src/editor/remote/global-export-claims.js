const claimsByRealm = new WeakMap()

/**
 * UMD exports are process-wide same-realm effects. Each name is reserved
 * before script insertion so concurrent engine instances cannot race to
 * install the same global. Reservations intentionally survive disposal:
 * third-party code may retain references or install irreversible effects.
 */
export class GlobalExportClaims {
  #claimed = new Map()
  #ownerToken = Symbol('dashboard-umd-owner')
  #services

  constructor(services) {
    this.#services = services
  }

  prepare(globalName, identity, request) {
    this.#services.scope.perform(request, () => {
      const claimedIdentity = this.#claimed.get(globalName)
      if (claimedIdentity !== undefined) {
        if (claimedIdentity !== identity) {
          throw new Error(
            `Remote global conflict: window.${globalName} is already bound to ${claimedIdentity}, not ${identity}`,
          )
        }
        return
      }

      const realm = this.#services.environment.window
      let realmClaims = claimsByRealm.get(realm)
      if (!realmClaims) {
        realmClaims = new Map()
        claimsByRealm.set(realm, realmClaims)
      }

      const owner = realmClaims.get(globalName)
      if (owner) {
        if (owner.ownerToken !== this.#ownerToken) {
          throw new Error(
            `Remote global conflict: window.${globalName} is reserved by Dashboard engine ${owner.instanceId}`,
          )
        }
        if (owner.identity !== identity) {
          throw new Error(
            `Remote global conflict: window.${globalName} is already bound to ${owner.identity}, not ${identity}`,
          )
        }
        this.#claimed.set(globalName, identity)
        return
      }
      if (Object.hasOwn(realm, globalName)) {
        throw new Error(
          `Remote global conflict: window.${globalName} already exists outside Dashboard engine ${this.#services.instanceId}`,
        )
      }

      realmClaims.set(globalName, {
        ownerToken: this.#ownerToken,
        identity,
        instanceId: this.#services.instanceId,
      })
      this.#claimed.set(globalName, identity)
    })
  }

  read(globalName) {
    return this.#services.environment.window[globalName]
  }

  clearClaims() {
    this.#claimed.clear()
  }
}
