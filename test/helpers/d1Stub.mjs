// Minimal in-memory D1 stand-in for unit-testing the Worker's DB layer.
// It recognizes the exact statement shapes used by worker/src/db.ts
// (SELECT single row / SELECT ... WHERE id = ? / SELECT all / INSERT ...
// ON CONFLICT upsert / INSERT ... DO NOTHING / UPDATE / DELETE / batch /
// runtime DDL exec) and stores rows per table, mirroring the real schema.

function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function tableOf(sql) {
  const m = sql.match(/FROM (\w+)/) || sql.match(/INTO (\w+)/) || sql.match(/UPDATE (\w+)/);
  return m ? m[1] : null;
}

function isMultiRow(t) {
  return t === 'admin_drafts';
}

function whereIdArg(sql) {
  return /\bwhere\s+id\s*=\s*\?/i.test(sql);
}

export function createD1Stub() {
  const tables = {
    published_config: new Map(),
    admin_catalog: new Map(),
    admin_auth: new Map(),
    ai_settings: new Map(),
    admin_drafts: new Map(), // multi-row: string id → row
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
        // `WHERE id = ?` (drafts by id) uses the bound key; otherwise id=1.
        const key = whereIdArg(sql) ? args[0] : 1;
        const row = tables[t].get(key);
        return row ? { ...row } : null;
      },
      async all() {
        const t = tableOf(sql);
        if (!t || !tables[t]) throw new Error(`d1Stub: unknown table for: ${sql}`);
        if (whereIdArg(sql)) {
          const row = tables[t].get(args[0]);
          return { results: row ? [{ ...row }] : [] };
        }
        // No WHERE → all rows for multi-row tables, the id=1 row otherwise.
        const keys = isMultiRow(t) ? [...tables[t].keys()] : [1];
        const results = keys
          .map((k) => ({ ...tables[t].get(k) }))
          .sort(
            (a, b) =>
              String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) ||
              String(b.id).localeCompare(String(a.id))
          );
        return { results };
      },
      async run() {
        const s = normalize(sql);
        // DELETE FROM <t> WHERE id = ?
        if (s.startsWith('DELETE')) {
          const t = tableOf(sql);
          if (!t || !tables[t]) throw new Error(`d1Stub: unknown table for: ${sql}`);
          const had = tables[t].delete(args[0]);
          return { changes: had ? 1 : 0 };
        }
        const t = tableOf(sql);
        if (!t || !tables[t]) throw new Error(`d1Stub: unknown table for: ${sql}`);
        const isInsert = s.startsWith('INSERT');
        const isUpdate = s.startsWith('UPDATE');
        if (!isInsert && !isUpdate) {
          throw new Error('d1Stub: only INSERT/UPDATE/DELETE statements support run()');
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
        // INSERT paths (dispatch on the distinctive column names)
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
        if (s.includes('settings_json')) {
          tables[t].set(1, { id: 1, settings_json: args[0], updated_at: args[1] });
          return { changes: 1 };
        }
        if (s.includes('admin_drafts')) {
          tables[t].set(args[0], {
            id: args[0],
            name: args[1],
            note: args[2] ?? null,
            catalog_json: args[3],
            created_at: args[4],
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
          if (s.includes('ON CONFLICT') && s.includes('DO NOTHING')) {
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
    // Runtime DDL (CREATE TABLE IF NOT EXISTS) — a no-op in the stub.
    async exec() {
      return { count: 0, duration: 0 };
    },
  };
}
