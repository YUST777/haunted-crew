---
inclusion: always
---

# Writing style for docs, UI text and commit messages

The docs promise that every statement was checked against the source. Write so that promise stays true.

## Docs (`docs/*.md`, READMEs)

- Plain words, short sentences, one idea per sentence. Active voice.
- Name the real thing: the file, the function, the flag, the number. "Times out after 30 s (`initTimeoutMs`)", not
  "has a reasonable timeout".
- If something depends on Kiro's behaviour and cannot be checked from this repo, mark it as not verified instead of
  guessing. `docs/kiro-integration.md` has a "Verification status" section for this.
- Tables for anything with more than three parallel items (endpoints, limits, fields).
- No marketing words: no "seamless", "robust", "powerful", "revolutionary", "first ever".
- Avoid em-dash chains. Use periods and commas.
- When code changes, update the doc in the same change. The `docs-stay-true` hook reminds you.

## In-game and website text

- Talk to the player directly and keep it short: "Press K to summon ghosts."
- Ghost replies and status lines are friendly and spooky-light ("Boo! Tests are green."). Never scary or gory.
- Button labels are verbs: "Copy install prompt", "Merge", "Request changes".

## Commit messages

- `area: what changed`, lowercase area: `bridge:`, `mod:`, `site:`, `tools:`, `docs:`, `kiro:`.
- Describe the change, not the effort. "bridge: refuse loops in saved workflows", not "fix stuff".
