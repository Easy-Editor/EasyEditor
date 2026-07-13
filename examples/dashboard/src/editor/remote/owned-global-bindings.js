/**
 * Installs only missing host globals and remembers exactly which values belong
 * to this adapter instance. Existing host values are never overwritten.
 */
export class OwnedGlobalBindings {
  #bindings
  #owned = new Map()
  #realm

  constructor({ bindings, realm }) {
    this.#bindings = bindings
    this.#realm = realm
  }

  install(perform) {
    for (const [name, value] of Object.entries(this.#bindings)) {
      if (this.#owned.has(name) || Reflect.has(this.#realm, name)) continue

      perform(
        {
          name: `window.${name}`,
          resourceType: 'runtime-global',
          type: 'registration',
        },
        () => {
          // Authorization may invoke arbitrary host code. Recheck before the
          // write so that a value installed during authorization is preserved.
          if (Reflect.has(this.#realm, name)) return
          if (!Reflect.set(this.#realm, name, value) || Reflect.get(this.#realm, name) !== value) {
            throw new Error(`Unable to install Dashboard host global: ${name}`)
          }
          this.#owned.set(name, value)
        },
      )
    }
  }

  dispose() {
    const errors = []

    for (const [name, value] of this.#owned) {
      // A later owner replaced the value, so this adapter no longer has the
      // authority to mutate that property during cleanup.
      if (Reflect.get(this.#realm, name) !== value) {
        this.#owned.delete(name)
        continue
      }

      if (!Reflect.deleteProperty(this.#realm, name)) {
        errors.push(new Error(`Unable to remove Dashboard host global: ${name}`))
        continue
      }
      this.#owned.delete(name)
    }

    if (errors.length) throw new AggregateError(errors, 'Dashboard host global cleanup failed')
  }
}
