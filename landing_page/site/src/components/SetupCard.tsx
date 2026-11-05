import { useEffect, useRef, useState } from 'react';
import installDoc from '../../../../INSTALL_PROMPT.md?raw';

// The prompt users paste into their agent: the fenced block in the repo's INSTALL_PROMPT.md,
// so the site and the docs never drift apart.
const INSTALL_PROMPT = (installDoc.match(/```text\n([\s\S]*?)```/)?.[1] ?? installDoc).trim();

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is blocked on plain http or in some iframes: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CopyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="currentColor" d="M5 1h9v1h1v9h-1v1h-2v-2h1V3H6v1H4V2h1zM2 5h8v1h1v9h-1v1H2v-1H1V6h1zm1 2v7h6V7z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="currentColor" d="M13 3h2v2h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H8v1H7v1H5v-1H4v-1H3v-1H2V9H1V8h2v1h1v1h1v1h2v-1h1V9h1V8h1V7h1V6h1V5h1z" />
    </svg>
  );
}

export function SetupCard() {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async () => {
    const ok = await copyText(INSTALL_PROMPT);
    setCopied(ok ? 'ok' : 'fail');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied('idle'), 2200);
  };

  return (
    <div className="showcase-copy">
      <button type="button" className={`copy-btn ${copied === 'ok' ? 'is-copied' : ''}`} onClick={onCopy}>
        {copied === 'ok' ? <CheckIcon /> : <CopyIcon />}
        <span>{copied === 'ok' ? 'Copied! Now paste it' : copied === 'fail' ? 'Copy failed, try again' : 'Copy prompt'}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied === 'ok' ? 'Install prompt copied to clipboard' : ''}
      </span>
    </div>
  );
}
