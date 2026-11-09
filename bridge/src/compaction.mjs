// Pure helpers for OpenBot-style context compaction. No LLM calls here:
// compact() takes a summarize(prompt) function supplied by the caller.

const CAP = 12000;
const PREVIOUS_CAP = 4000;
const MARK = '…[truncated]';
const INSTRUCTIONS =
  'Write a compact summary of the conversation below for an agent that will continue it. ' +
  'Use bullets for: goals, decisions, files touched, open questions. Be terse and factual.';

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

export function needsCompaction(messages, { budget = 6000 } = {}) {
  const total = (messages ?? []).reduce((sum, m) => sum + estimateTokens(m?.text), 0);
  return total > budget;
}

export function split(messages, { keepLast = 6 } = {}) {
  const list = messages ?? [];
  const keep = Math.max(0, Math.floor(keepLast));
  const cut = Math.max(0, list.length - keep);
  return { old: list.slice(0, cut), recent: list.slice(cut) };
}

// Renders `head` plus one "role: text" line per message, capped at CAP chars.
// Oldest message text is truncated first (with a marker). Hard slice is the last resort.
function fit(head, items) {
  const rows = items.map((m) => {
    const base = String(m?.text ?? '');
    return { role: String(m?.role ?? ''), base, text: base };
  });
  const render = () => head + rows.map((r) => `${r.role}: ${r.text}`).join('\n');
  let out = render();
  for (const r of rows) {
    if (out.length <= CAP) break;
    const cur = r.text.length;
    if (cur === 0) continue;
    const excess = out.length - CAP;
    const keep = cur - excess - MARK.length;
    if (keep > 0) r.text = r.base.slice(0, keep) + MARK;
    else if (MARK.length < cur) r.text = MARK;
    out = render();
  }
  return out.length > CAP ? out.slice(0, CAP) : out;
}

export function summaryPrompt(old, previousSummary) {
  let prev = '';
  if (previousSummary) {
    const text = String(previousSummary);
    const shown = text.length > PREVIOUS_CAP ? text.slice(0, PREVIOUS_CAP) + MARK : text;
    prev = `Previous summary:\n${shown}\n\n`;
  }
  return fit(`${INSTRUCTIONS}\n\n${prev}Conversation:\n`, old ?? []);
}

export function seed(summary, recent) {
  return fit(`Summary of earlier conversation:\n${summary ?? ''}\n\nRecent messages:\n`, recent ?? []);
}

export async function compact(messages, summarize, opts = {}) {
  const list = messages ?? [];
  if (!needsCompaction(list, opts)) return { messages: list, summary: null };

  const { old, recent } = split(list, opts);
  if (old.length === 0) return { messages: list, summary: null };

  let raw;
  try {
    raw = await summarize(summaryPrompt(old));
  } catch (err) {
    return { messages: list, summary: null, error: `summarize failed: ${err?.message ?? err}` };
  }
  const summary = typeof raw === 'string' ? raw.trim() : '';
  if (!summary) return { messages: list, summary: null, error: 'summarize returned empty summary' };

  return { summary, seed: seed(summary, recent), recent };
}
