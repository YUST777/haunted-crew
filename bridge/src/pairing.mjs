import { randomInt } from 'node:crypto';
import { tokenEquals } from './auth.mjs';

// One-time codes that let a Minecraft server fetch the view + command tokens without anyone
// copying secrets around. ~40 bits, single use, short-lived, and failed tries hit the auth limiter.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
const TTL_MS = 10 * 60_000;

export function createPairing({ now = Date.now } = {}) {
  const codes = new Map(); // code -> expiresAt

  const sweep = () => {
    const t = now();
    for (const [c, exp] of codes) if (exp <= t) codes.delete(c);
  };

  return {
    create() {
      sweep();
      let body = '';
      for (let i = 0; i < 8; i++) body += ALPHABET[randomInt(ALPHABET.length)];
      const code = `HC-${body.slice(0, 4)}-${body.slice(4)}`;
      codes.set(code, now() + TTL_MS);
      return { code, expiresInMs: TTL_MS };
    },
    // Returns true once per valid code. Accepts lower case and missing dashes.
    redeem(input) {
      sweep();
      if (typeof input !== 'string') return false;
      const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const norm = raw.startsWith('HC') && raw.length === 10 ? `HC-${raw.slice(2, 6)}-${raw.slice(6)}` : '';
      for (const code of codes.keys()) {
        if (tokenEquals(norm, code)) {
          codes.delete(code);
          return true;
        }
      }
      return false;
    },
  };
}
