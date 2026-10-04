// Coalesce refreshes and serve a bounded stale snapshot while a new one is read.
export function createSnapshotReader(load, { ttlMs = 15000, staleMs = 120000, now = Date.now } = {}) {
  let value, updatedAt = 0, pending;
  const refresh = () => {
    if (pending) return pending;
    pending = Promise.resolve().then(load).then((result) => {
      value = result;
      updatedAt = now();
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
  const read = () => {
    const age = now() - updatedAt;
    if (value !== undefined && age < ttlMs) return Promise.resolve(value);
    if (value !== undefined && age < ttlMs + staleMs) {
      refresh().catch(() => {});
      return Promise.resolve(value);
    }
    return refresh();
  };
  read.refresh = refresh;
  return read;
}
