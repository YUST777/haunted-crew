import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

// Minimal Agent Client Protocol client: JSON-RPC 2.0, one JSON message per line over stdio.
// Spec: https://agentclientprotocol.com. Kiro: `kiro-cli acp` (docs: kiro.dev/docs/cli/acp).
//
// Events: 'update' ({sessionId, update}), 'permission' ({id, sessionId, toolCall, options}),
//         'exit' (code), 'stderr' (line).
export class AcpConnection extends EventEmitter {
  constructor({ command, args = [], cwd, env = process.env }) {
    super();
    this.nextId = 1;
    this.pending = new Map();
    this.proc = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.on('error', (err) => this.#failAll(err));
    this.proc.on('exit', (code) => {
      this.#failAll(new Error(`agent process exited (${code})`));
      this.emit('exit', code);
    });
    createInterface({ input: this.proc.stdout }).on('line', (line) => this.#onLine(line));
    createInterface({ input: this.proc.stderr }).on('line', (line) => this.emit('stderr', line));
  }

  request(method, params, timeoutMs = 0) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timer });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  respond(id, result) {
    this.#write({ jsonrpc: '2.0', id, result });
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }

  #write(msg) {
    if (this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  #failAll(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // agents may print non-protocol noise; ignore it
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? 'agent error'), { code: msg.error.code }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/update' || msg.method === 'session/notification') {
      this.emit('update', msg.params ?? {});
    } else if (msg.method === 'session/request_permission' && msg.id !== undefined) {
      this.emit('permission', { id: msg.id, ...(msg.params ?? {}) });
    } else if (msg.id !== undefined && msg.method) {
      // We advertise no fs/terminal capabilities, so refuse anything else the agent asks for.
      this.#write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unsupported: ${msg.method}` } });
    }
  }
}
