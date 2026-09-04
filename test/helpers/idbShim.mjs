// Minimal in-memory IndexedDB shim for Node tests of the config cache.
// Implements exactly the surface used by src/services/configCache.ts:
//   indexedDB.open(name, version) → request (onupgradeneeded / onsuccess)
//   db.transaction(storeName, mode) → tx (objectStore(), oncomplete, onerror)
//   store.get/put/delete/clear → request (result / onsuccess)
//   db.close(), indexedDB.deleteDatabase(name)
// All async completions happen on microtasks, like a real IDB.

export function createIdbShim() {
  // name → Map(storeName → Map(key → value))
  const dbs = new Map();

  const tick = () => Promise.resolve();

  function makeRequest() {
    return { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null };
  }

  function makeStore(map, tx) {
    return {
      get(key) {
        const req = makeRequest();
        tick().then(() => {
          req.result = map.has(key) ? map.get(key) : undefined;
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      },
      put(value, key) {
        const req = makeRequest();
        tick().then(() => {
          map.set(key, value);
          if (req.onsuccess) req.onsuccess();
          tick().then(() => {
            if (tx && tx.oncomplete) tx.oncomplete();
          });
        });
        return req;
      },
      delete(key) {
        const req = makeRequest();
        tick().then(() => {
          map.delete(key);
          if (req.onsuccess) req.onsuccess();
          if (tx && tx.oncomplete) tx.oncomplete();
        });
        return req;
      },
      clear() {
        const req = makeRequest();
        tick().then(() => {
          map.clear();
          if (req.onsuccess) req.onsuccess();
          if (tx && tx.oncomplete) tx.oncomplete();
        });
        return req;
      },
    };
  }

  const factory = {
    open(name, _version) {
      const req = makeRequest();
      tick().then(() => {
        let storeMap = dbs.get(name);
        const isNew = !storeMap;
        if (isNew) {
          storeMap = new Map();
          dbs.set(name, storeMap);
        }
        const db = {
          objectStoreNames: { contains: (s) => storeMap.has(s) },
          createObjectStore(s) {
            if (!storeMap.has(s)) storeMap.set(s, new Map());
            return makeStore(storeMap.get(s), null);
          },
          transaction(storeName) {
            if (!storeMap.has(storeName)) throw new Error(`shim: no such store ${storeName}`);
            const tx = {
              objectStore: () => makeStore(storeMap.get(storeName), tx),
              oncomplete: null,
              onerror: null,
              onabort: null,
            };
            return tx;
          },
          close() {},
        };
        req.result = db;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) {
      const req = makeRequest();
      tick().then(() => {
        dbs.delete(name);
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    // Test escape hatches
    _dbs: dbs,
    _reset() {
      dbs.clear();
    },
  };

  return factory;
}
