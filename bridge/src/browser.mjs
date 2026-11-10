import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { homeDir } from './config.mjs';

// A shared headless Chrome page whose pixels stream to the big screen in Minecraft.
// Uses the Chrome already installed on this PC (puppeteer-core downloads nothing) with its own
// profile in ~/.haunted-crew/browser (one reused folder, so a killed bridge leaves nothing behind
// in /tmp), so it never touches the user's own browser data.
//
// Events: 'frame' ({ data: base64 JPEG, width, height, url }), 'error' (Error).

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

export const VIEWPORT = { width: 1280, height: 598 }; // the office screen is 15 x 7 blocks
// 1x pixel density: Chrome's screencast delivers CSS-pixel frames, and the screenshot fallback must match their size
// (mixed sizes made the game's texture flip between two resolutions).
const SCALE = 1;
const FRAME_INTERVAL_MS = 50; // at most ~20 frames a second to Minecraft
const CAPTURE_EVERY_MS = 100;

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export function createBrowser({ executablePath = findChrome(), log = console } = {}) {
  const events = new EventEmitter();
  let browser = null;
  let page = null;
  let cdp = null;
  let starting = null;
  let lastSent = 0;
  let pending = null;
  let timer = null;
  let last = null;
  let lastData = null;
  let lastError = null;
  let captureLoop = null;
  let poll = null;
  let session = null;
  let lastCast = 0;

  function emitFrame(frame) {
    const wait = FRAME_INTERVAL_MS - (Date.now() - lastSent);
    pending = frame;
    if (wait <= 0) flush();
    else if (!timer) timer = setTimeout(flush, wait);
  }

  function flush() {
    timer = null;
    if (!pending) return;
    lastSent = Date.now();
    last = pending;
    pending = null;
    events.emit('frame', last);
  }

  async function start() {
    if (page) return page;
    if (starting) return starting;
    if (!executablePath) throw new Error('Chrome not found. Install Google Chrome or set CHROME_PATH.');
    starting = (async () => {
      const { default: puppeteer } = await import('puppeteer-core');
      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        defaultViewport: { ...VIEWPORT, deviceScaleFactor: SCALE },
        userDataDir: join(homeDir(), 'browser'),
        args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--disk-cache-size=52428800',
          '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
          '--enable-gpu-rasterization', '--enable-zero-copy', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      browser.on('disconnected', () => {
        clearTimeout(poll);
        browser = page = cdp = session = null;
      });
      page = await browser.newPage();
      // Search sites serve bot challenges to "HeadlessChrome"; look like the normal Chrome this is.
      await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
      cdp = true; // capture loop runs while set
      // Fast path: Chrome pushes a JPEG only when the picture changes (no polling, no full screenshots).
      const startCast = async () => {
        try {
          session ??= await page.createCDPSession();
          session.removeAllListeners('Page.screencastFrame');
          session.on('Page.screencastFrame', (f) => {
            lastCast = Date.now();
            session?.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
            if (f.data !== lastData) {
              lastData = f.data;
              emitFrame({ data: f.data, width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE, url: page?.url() ?? '' });
            }
          });
          await session.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: VIEWPORT.width * SCALE, maxHeight: VIEWPORT.height * SCALE, everyNthFrame: 1 });
        } catch (err) {
          session = null; // screenshot polling below still works
        }
      };
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) startCast(); });
      await startCast();
      // Full-density screenshots back to back, sending only the ones that changed. page.screenshot
      // follows the page across cross-site navigations (a raw CDP session would get detached).
      const capture = async () => {
        if (!cdp || !page) return;
        const started = Date.now();
        // While the screencast is delivering, no screenshots: the screenshot loop only takes over if it goes quiet for 1.5 s (a static page sends nothing, so it checks then too).
        if (session && started - lastCast < 1500) {
          poll = setTimeout(capture, 100);
          return;
        }
        try {
          // A screenshot taken while a navigation commits can hang forever; never let one stall the loop.
          const data = await Promise.race([
            page.screenshot({ type: 'jpeg', quality: 82, encoding: 'base64', optimizeForSpeed: true, captureBeyondViewport: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot timed out')), 3000)),
          ]);
          if (data !== lastData) {
            lastData = data;
            emitFrame({ data, width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE, url: page?.url() ?? '' });
          }
        } catch (err) {
          // Usually a navigation in progress; log each distinct error once so real failures are visible.
          if (err.message !== lastError) {
            lastError = err.message;
            log.warn?.('[browser] capture:', err.message);
          }
        }
        if (cdp) poll = setTimeout(capture, Math.max(0, CAPTURE_EVERY_MS - (Date.now() - started)));
      };
      captureLoop = capture; // started after the first navigation (see open)
      return page;
    })();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log.warn?.('[browser]', err.message);
      throw err;
    }
  };

  return {
    events,
    available: () => Boolean(executablePath),
    lastFrame: () => last,
    open: guard(async (url) => {
      const p = await start();
      // Frames stream while the page loads, so don't make the player wait for slow pages: return after 1.5 s.
      const nav = p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      nav.catch(() => {});
      await Promise.race([nav, new Promise((r) => setTimeout(r, 1500))]);
      if (captureLoop) {
        const run = captureLoop;
        captureLoop = null;
        run();
      }
      return { url: p.url() };
    }),
    // x, y in 0..1 of the screen.
    click: guard(async (x, y) => {
      const p = await start();
      await p.mouse.click(Math.round(x * VIEWPORT.width), Math.round(y * VIEWPORT.height));
      return { ok: true };
    }),
    scroll: guard(async (dy) => {
      const p = await start();
      await p.mouse.wheel({ deltaY: dy });
      return { ok: true };
    }),
    type: guard(async (text, submit = true) => {
      const p = await start();
      await p.keyboard.type(text, { delay: 10 });
      if (submit) await p.keyboard.press('Enter');
      return { ok: true };
    }),
    key: guard(async (name) => {
      const p = await start();
      // "Control+a" style combos: hold the modifiers, press the key, release.
      const parts = name.split('+');
      const key = parts.pop();
      for (const m of parts) await p.keyboard.down(m);
      await p.keyboard.press(key);
      for (const m of parts.reverse()) await p.keyboard.up(m);
      return { ok: true };
    }),
    forward: guard(async () => {
      const p = await start();
      await p.goForward({ timeout: 10_000 }).catch(() => null);
      return { url: p.url() };
    }),
    reload: guard(async () => {
      const p = await start();
      await p.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
      return { url: p.url() };
    }),
    back: guard(async () => {
      const p = await start();
      await p.goBack({ timeout: 10_000 }).catch(() => null);
      return { url: p.url() };
    }),
    async stop() {
      const b = browser;
      clearTimeout(poll);
      browser = page = cdp = session = null;
      captureLoop = null;
      last = lastData = null;
      await b?.close().catch(() => {});
    },
  };
}
