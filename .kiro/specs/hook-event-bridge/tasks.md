# Tasks: Hook event bridge

- [x] 1. Hook installer
  - Write `TRIGGERS` and `hookFile()` in `bridge/bin/install-hooks.mjs`; write the file only when its content differs.
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. Hook sender that never disturbs the agent
  - `bridge/bin/send-event.mjs`: read stdin, POST with the ingest token, 800 ms timeout, exit 0, no stdout.
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Normalizer
  - [x] 3.1 Trigger and alias table, and rejecting unknown triggers with HTTP 400.
    - _Requirements: 3.6_
  - [x] 3.2 Keep only the allowed fields; clean and cap strings.
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 3.3 Project-relative and basename-only paths.
    - _Requirements: 3.3, 3.4_
  - [x] 3.4 Tool `category` from tags, then from the tool name.
    - _Requirements: 3.1_

- [x] 4. Session state and status mapping
  - `bridge/src/state.mjs`: status table, 500-event window, eviction above 80 sessions, 60-minute idle sweep.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Tokens, roles and the failure limiter
  - `bridge/src/auth.mjs`, `bridge/src/config.mjs`; `POST /event` answers 401, 403 and 429 as specified; bind to `127.0.0.1`.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. Wire the launcher
  - `bridge/bin/haunted-crew.mjs` writes the hook file, prints "installed" or "already installed", honours `--no-hooks`.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 7. Tests for what exists
  - `normalize.test.mjs`, `server.test.mjs`, `pairing.test.mjs` (see the design for what each covers);
    `npm --prefix bridge test` is green (159 tests across the whole bridge).
  - _Requirements: 1.1, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2_

- [ ] 8. Capture one real Kiro payload per trigger as fixtures
  - Run the hooks in Kiro IDE and CLI with `HAUNTED_CREW_DEBUG=1`, save redacted payloads under `bridge/test/fixtures/`,
    and add a test that normalizes each one. This confirms the trigger names and payload fields Kiro really sends.
  - _Requirements: 3.1, 3.6_

- [ ] 9. Test the failure limiter
  - In `server.test.mjs`, send 21 requests with a wrong token from one address and expect HTTP 429 on the 21st; a request
    with a correct token from the same address after the window must pass.
  - _Requirements: 5.3_

- [ ] 10. Test session state
  - Add `bridge/test/state.test.mjs` for the status table (requirements 4.1 to 4.5), eviction above 80 sessions (4.6)
    and the idle sweep.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
