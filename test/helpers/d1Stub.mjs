// Minimal in-memory D1 stand-in for unit-testing the Worker's DB layer.
// It recognizes the exact statement shapes used by worker/src/db.ts
// (SELECT single row / INSERT ... ON CONFLICT upsert / INSERT ... DO NOTHING
// / UPDATE / batch) and stores one row per table under id=1, mirroring the
// real schema.

function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function tableOf(sql) {
  const m = sql.match(/FROM (\w+)/) || sql.match(/INTO (\w+)/) || sql.match(/UPDATE (\w+)/);
  return m ? m[1] : null;
}

export function createD1Stub() {
  const tables = {
    published_config: new Map(),
    admin_catalog: new Map(),
    admin_auth: new Map(),
  };

  function makeStmt(sql) {
    let args = [];
    const bound = {
      bind(...a) {
        args = a;
        return bound;
      },
      async first() {
        const t = tableOf(sql);
        if (!t || !tables[t]) throw new Error(`d1Stub: unknown table for: ${sql}`);
        const row = tables[t].get(1);
        return row ? { ...row } : null;
      },
      async all() {
        const t = tableOf(sql);
        if (!t || !tables[t]) throw new Error(`d1Stub: unknown table for: ${sql}`);
        const row = tables[t].get(1);
        return { results: row ? [{ ...row }] : [] };
      },
      async run() {
        const t = tableOf(sql);
        if (!t || !tables[t]) throw new Error(`d1Stub: unknown table for: ${sql}`);
        const s = normalize(sql);
        const isInsert = s.startsWith('INSERT');
        const isUpdate = s.startsWith('UPDATE');
        if (!isInsert && !isUpdate) {
          throw new Error('d1Stub: only INSERT/UPDATE statements support run()');
        }
        if (isUpdate) {
          if (!s.includes('admin_auth')) throw new Error(`d1Stub: unsupported UPDATE: ${sql}`);
          const row = tables[t].get(1);
          if (!row) return { changes: 0 };
          tables[t].set(1, {
            ...row,
            salt: args[0],
            hash: args[1],
            iterations: args[2],
            passcode_version: (row.passcode_version ?? 0) + 1,
            updated_at: args[3],
          });
          return { changes: 1 };
        }
        // INSERT paths
        if (s.includes('payload_json')) {
          tables[t].set(1, {
            id: 1,
            version: args[0],
            updated_at: args[1],
            payload_json: args[2],
            note: args[3] ?? null,
          });
          return { changes: 1 };
        }
        if (s.includes('catalog_json')) {
          tables[t].set(1, {
            id: 1,
            version: args[0],
            updated_at: args[1],
            catalog_json: args[2],
            note: args[3] ?? null,
          });
          return { changes: 1 };
        }
        if (s.includes('admin_auth')) {
          if (s.includes('ON CONFLICT')) {
            // INSERT ... DO NOTHING: only wins when no row exists yet.
            if (tables[t].has(1)) return { changes: 0 };
            tables[t].set(1, {
              id: 1,
              salt: args[0],
              hash: args[1],
              iterations: args[2],
              passcode_version: 1,
              updated_at: args[3],
            });
            return { changes: 1 };
          }
          throw new Error(`d1Stub: unsupported admin_auth INSERT: ${sql}`);
        }
        throw new Error(`d1Stub: unrecognized statement: ${sql}`);
      },
    };
    return bound;
  }

  return {
    _tables: tables,
    prepare: makeStmt,
    async batch(stmts) {
      // One transaction: run sequentially (single-threaded, like D1).
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
}
