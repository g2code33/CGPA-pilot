// Minimal in-memory R2 bucket stand-in for Worker asset tests.
// Implements put/get/list (with prefix + cursor pagination) with the exact
// shapes worker/src/assets.ts and the /api/assets route use.

export function createR2Stub() {
  const objects = new Map(); // key → { bytes: Uint8Array, contentType: string | null }
  const puts = [];

  const stub = {
    /** Test helper: number of put() calls (dedup checks). */
    puts,
    /** Test helper: direct peek at stored bytes. */
    objects,

    async put(key, bytes, opts = {}) {
      puts.push(key);
      objects.set(key, { bytes, contentType: opts?.httpMetadata?.contentType ?? null });
      return { key, size: bytes.byteLength };
    },

    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        key,
        size: o.bytes.byteLength,
        body: new Blob([o.bytes], { type: o.contentType ?? undefined }),
        httpMetadata: { contentType: o.contentType },
        // Real R2ObjectBody exposes both; readers that want the bytes whole use
        // arrayBuffer() (the streaming `body` is for proxying responses).
        arrayBuffer: async () => Uint8Array.from(o.bytes).buffer,
        text: async () => new TextDecoder().decode(o.bytes),
      };
    },

    async list({ prefix, limit = 1000, cursor } = {}) {
      let keys = [...objects.keys()].sort();
      if (prefix) keys = keys.filter((k) => k.startsWith(prefix));
      let start = 0;
      if (cursor) {
        const idx = keys.indexOf(cursor);
        start = idx >= 0 ? idx + 1 : 0;
      }
      const page = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: page.map((k) => ({ key: k, size: objects.get(k).bytes.byteLength })),
        truncated,
        cursor: truncated ? page[page.length - 1] : undefined,
      };
    },
  };
  return stub;
}
