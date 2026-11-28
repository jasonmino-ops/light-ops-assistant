/** Per-page GET scheduling only. No result cache, persistence or business authority. */
export class DiningReadRequests {
  private readonly pending = new Map<string, { revision: number; promise: Promise<unknown> }>()

  run<T>(key: string, revision: number, read: () => Promise<T>): Promise<T> {
    const earlier = this.pending.get(key)
    if (earlier?.revision === revision) return earlier.promise as Promise<T>

    // A mutation needs a new read, but must not overlap the old read of this resource.
    const promise = (earlier ? earlier.promise.catch(() => undefined) : Promise.resolve()).then(read)
    const entry = { revision, promise }
    this.pending.set(key, entry)
    void promise.finally(() => {
      if (this.pending.get(key) === entry) this.pending.delete(key)
    }).catch(() => undefined)
    return promise
  }
}
