import { execFile, spawn } from 'node:child_process';

// Kiro account status and sign-in, driven through the official CLI. We never see credentials:
// `kiro-cli login --use-device-flow` prints a link + code the player opens in their browser.

const STATUS_TTL_MS = 15_000;
const URL_RE = /https:\/\/[^\s"'<>]+/;
const CODE_RE = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/;
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');

export function createKiro({ command = 'kiro-cli', demo = false, log = console }) {
  let cache = null;
  let login = null; // { proc, url, code, lines, done }

  function status() {
    if (demo) return Promise.resolve({ signedIn: true, user: 'demo mode', demo: true });
    if (cache && Date.now() - cache.at < STATUS_TTL_MS) return Promise.resolve(cache.value);
    return new Promise((resolve) => {
      execFile(command, ['whoami'], { timeout: 10_000 }, (err, stdout, stderr) => {
        const out = stripAnsi(`${stdout}\n${stderr}`).trim();
        let value;
        if (err && err.code === 'ENOENT') value = { signedIn: false, installed: false, user: null };
        else if (/not logged in/i.test(out) || (err && !out)) value = { signedIn: false, installed: true, user: null };
        else value = { signedIn: !err, installed: true, user: out.split('\n').find((l) => l.trim())?.trim().slice(0, 80) ?? null };
        cache = { at: Date.now(), value };
        resolve(value);
      });
    });
  }

  // Starts (or reuses) a device-flow login and resolves once the link/code appear (or after 15 s
  // with whatever the CLI printed, so the player still sees what it asked for).
  function startLogin() {
    if (demo) return Promise.resolve({ demo: true, done: true });
    if (login && !login.done) return Promise.resolve(view(login));
    const state = { url: null, code: null, lines: [], done: false };
    login = state;
    cache = null;
    const proc = spawn(command, ['login', '--license', 'free', '--use-device-flow'], { stdio: ['ignore', 'pipe', 'pipe'] });
    state.proc = proc;
    const onData = (buf) => {
      for (const raw of stripAnsi(buf.toString()).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        state.lines.push(line.slice(0, 200));
        if (state.lines.length > 8) state.lines.shift();
        state.url ??= line.match(URL_RE)?.[0] ?? null;
        state.code ??= line.match(CODE_RE)?.[0] ?? null;
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      state.done = true;
      state.error = err.code === 'ENOENT' ? `${command} is not installed` : err.message;
    });
    proc.on('exit', (code) => {
      state.done = true;
      state.exitCode = code;
      cache = null;
      log.log?.(`[kiro] login finished (${code})`);
    });
    const timeout = setTimeout(() => proc.kill(), 15 * 60_000);
    timeout.unref?.();
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if ((state.url && state.code) || state.done || Date.now() - started > 15_000) {
          clearInterval(poll);
          resolve(view(state));
        }
      }, 100);
    });
  }

  // Plan credits from `kiro-cli chat --no-interactive /usage` ("Credits (597.24 of 1000 covered in plan), 59.7%").
  let usageCache = null;
  function usage() {
    if (demo) return Promise.resolve({ demo: true, used: 123.4, total: 1000, percent: 12.3, plan: 'DEMO', resets: null });
    if (usageCache && Date.now() - usageCache.at < 60_000) return Promise.resolve(usageCache.value);
    return new Promise((resolve) => {
      execFile(command, ['chat', '--no-interactive', '/usage'], { timeout: 30_000 }, (err, stdout, stderr) => {
        const out = stripAnsi(`${stdout}\n${stderr}`);
        const head = out.match(/Estimated Usage\s*\|\s*resets on\s*([\d-]+)\s*\|\s*([^\n]+)/i);
        const credits = out.match(/Credits\s*\(([\d.]+)\s*of\s*([\d.]+)[^)]*\),\s*([\d.]+)%/i);
        const value = credits
          ? { used: Number(credits[1]), total: Number(credits[2]), percent: Number(credits[3]), plan: head?.[2]?.trim().slice(0, 40) ?? null, resets: head?.[1] ?? null }
          : { error: err?.code === 'ENOENT' ? 'kiro-cli is not installed' : 'could not read usage' };
        if (credits) usageCache = { at: Date.now(), value };
        resolve(value);
      });
    });
  }

  const view = (s) => ({ url: s.url, code: s.code, lines: s.lines.slice(-4), done: s.done, error: s.error ?? null });

  return {
    status,
    usage,
    startLogin,
    close() {
      if (login && !login.done) login.proc?.kill();
    },
  };
}
