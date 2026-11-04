import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

// Hashing first makes the comparison constant-time regardless of length.
export function tokenEquals(given, expected) {
  if (!given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

// Returns 'ingest', 'command', 'view' or null. Ingest and command both imply view.
export function roleFor(token, tokens) {
  if (tokenEquals(token, tokens.ingest)) return 'ingest';
  if (tokens.command && tokenEquals(token, tokens.command)) return 'command';
  if (tokenEquals(token, tokens.view)) return 'view';
  return null;
}

// Fixed-window limiter for failed auth attempts, per remote address.
export function createFailLimiter({ max = 20, windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    blocked(ip) {
      const h = hits.get(ip);
      return Boolean(h && now() - h.start < windowMs && h.count >= max);
    },
    fail(ip) {
      const t = now();
      const h = hits.get(ip);
      if (!h || t - h.start >= windowMs) hits.set(ip, { start: t, count: 1 });
      else h.count++;
    },
    sweep() {
      const t = now();
      for (const [ip, h] of hits) if (t - h.start >= windowMs) hits.delete(ip);
    },
  };
}
