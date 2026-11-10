// The crew's tools, exposed to Kiro agents over MCP (bin/crew-mcp.mjs forwards here).
// Every call comes from a known agent (found by its per-session token), so ownership rules hold.

const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const SCHEMAS = [
  ['send_message', 'Send a message to a teammate and wait for their reply (Status/Result/Evidence).', obj({ to: str, text: str }, ['to', 'text'])],
  ['list_agents', 'List the agents that are working right now.', obj({})],
  ['ask_user', 'Ask the human a question; they pick one of the options.', obj({ question: str, options: { type: 'array', items: str } }, ['question'])],
  ['remember', 'Save a fact for yourself for next time.', obj({ text: str, tags: { type: 'array', items: str } }, ['text'])],
  ['search_memories', 'Search what you remembered.', obj({ query: str })],
  ['forget_memory', 'Forget one memory by id.', obj({ id: str }, ['id'])],
  ['list_tables', 'List tables in the shared crew database and who owns them.', obj({})],
  ['query_data', 'Run one read-only SELECT on the shared crew database.', obj({ sql: str, params: { type: 'array' } }, ['sql'])],
  ['execute_data', 'Run one INSERT/UPDATE/DELETE/CREATE/ALTER/DROP on the shared crew database. You can only drop or alter tables you created.', obj({ sql: str, params: { type: 'array' } }, ['sql'])],
  ['delete_table', 'Drop a table you created.', obj({ name: str }, ['name'])],
  ['history_search', 'Search past crew events by words.', obj({ query: str }, ['query'])],
  ['history_read', 'Read the events around one history hit.', obj({ id: str }, ['id'])],
];

export const TOOL_SCHEMAS = SCHEMAS.map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

const WAIT_MS = 5 * 60_000;
const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 8000);

/** deps: agents (list, run, askUser), mailbox, memory, sharedData, history. Returns { list, call }. */
export function createTools({ agents, mailbox, memory, sharedData, history, waitMs = WAIT_MS }) {
  const waiting = new Map(); // caller name -> target name, to refuse deadlocks

  const byName = (name) => agents.list().find((a) => a.name.toLowerCase() === String(name).trim().toLowerCase());

  async function sendMessage(caller, { to, text: body }) {
    const target = byName(to);
    if (!target) throw new Error(`no working agent named "${to}". Working: ${agents.list().map((a) => a.name).join(', ')}`);
    if (target.name === caller.name) throw new Error('an agent cannot message itself');
    // A waits on B while B waits on A (directly or through others): neither would ever answer.
    for (let n = target.name, hops = 0; n && hops < 20; n = waiting.get(n), hops++) {
      if (n === caller.name) throw new Error(`${target.name} is waiting for you; answer them in your reply instead of messaging back`);
    }
    const sent = mailbox.send({ from: caller.name, to: [target.name], text: String(body ?? '').slice(0, 12_000) || '(empty)' });
    const delivery = sent.deliveries[0].id;
    waiting.set(caller.name, target.name);
    try {
      const wrapped = `${mailbox.wrapper(delivery)}\nDo not message anyone else; just answer.`;
      const reply = await Promise.race([
        agents.run(target.session, wrapped),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${target.name} did not answer in time`)), waitMs).unref?.()),
      ]);
      mailbox.markRead(delivery);
      try { mailbox.send({ from: target.name, to: [caller.name], text: reply.slice(0, 12_000) || '(empty)', replyTo: sent.id, expectsReply: false }); } catch { /* reply recorded best effort */ }
      return `Reply from ${target.name} (to ${sent.id}):\n${reply}`;
    } finally {
      waiting.delete(caller.name);
    }
  }

  // Mid-turn steering (AgentCraft): unread no-reply notes (replies, FYIs) ride along on the next tool result.
  // Messages that expect a reply are delivered as a prompt by sendMessage, so they are left alone here.
  function pendingNotes(caller) {
    const notes = mailbox.inbox(caller.name).filter((m) => !m.expectsReply);
    if (!notes.length) return '';
    for (const n of notes) mailbox.markRead(n.deliveryId);
    return `\n\n[NEW MESSAGES]\n${notes.map((n) => `- from ${n.from}: ${n.text}`).join('\n')}`;
  }

  const handlers = {
    send_message: sendMessage,
    list_agents: async () => agents.list().map((a) => ({ name: a.name, busy: a.busy })),
    ask_user: async (c, a) => {
      if (typeof agents.askUser !== 'function') throw new Error('asking the user is not available');
      return (await agents.askUser(c.session, String(a.question ?? 'Question'), a.options)) ?? '(no answer; decide yourself)';
    },
    remember: async (c, a) => memory.remember(c.name, String(a.text ?? ''), Array.isArray(a.tags) ? a.tags.map(String) : []),
    search_memories: async (c, a) => memory.search(c.name, String(a.query ?? ''), { limit: 5 }),
    forget_memory: async (c, a) => ({ ok: memory.forget(c.name, String(a.id)) }),
    list_tables: async () => sharedData.tables(),
    query_data: async (c, a) => sharedData.query(c.name, String(a.sql ?? ''), Array.isArray(a.params) ? a.params : []),
    execute_data: async (c, a) => sharedData.execute(c.name, String(a.sql ?? ''), Array.isArray(a.params) ? a.params : []),
    delete_table: async (c, a) => sharedData.deleteTable(c.name, String(a.name ?? '')),
    history_search: async (c, a) => history.search(String(a.query ?? ''), { limit: 5 }),
    history_read: async (c, a) => history.read(String(a.id ?? '')),
  };

  return {
    list: () => TOOL_SCHEMAS,
    /** caller = { name, session }. Resolves to text for the agent; throws Error(message) for a tool error. */
    async call(caller, name, args = {}) {
      const h = handlers[name];
      if (!h) throw new Error(`unknown tool "${name}"`);
      const result = text(await h(caller, args && typeof args === 'object' ? args : {}));
      return result + pendingNotes(caller);
    },
  };
}
