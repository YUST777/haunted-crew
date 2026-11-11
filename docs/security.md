# Security

- **Three tokens** (ingest, command, view) are created on first run and stored owner-only in `~/.haunted-crew/`.
  Compared in constant time. Failed auth and wrong pairing codes are limited to 20 per minute per IP.
- **Pairing codes** (`HC-XXXX-XXXX`) work once for 10 minutes and exchange for a view and command token.
- **Roles.** Watch-only players cannot command ghosts, approve merges or see credits.
- **Privacy.** Hook prompts, file contents and tool output are dropped; paths are made project-relative. Console chats
  are visible to people on your server.
- **Approvals.** Tool calls ask first unless `--trust-all-tools`. Unanswered requests are denied after 10 minutes.
- **Git sandbox.** No push or fetch for agents (see [merges](merges.md)).
- **Reviewed merges.** With `--worktrees`, agent code reaches your branch only after you approve.
- **Webhooks** are verified by HMAC. **Backups** strip secrets. The **shared database** lets an agent change only its own tables.
- **Default bind** is `127.0.0.1`. For multiplayer, put a TLS proxy in front.
