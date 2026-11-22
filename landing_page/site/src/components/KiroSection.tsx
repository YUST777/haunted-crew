import { Link } from '@tanstack/react-router';

const KIRO_DIR = 'https://github.com/YUST777/haunted-crew/tree/main/.kiro';

const PARTS = [
  {
    count: '6',
    label: 'Specs',
    text: 'Requirements, design and tasks for the hook bridge, reviewed merges and the demo video. Kiro worked through the task lists.',
  },
  {
    count: '18',
    label: 'Hooks',
    text: 'Ten forward every Kiro event to the ghosts. The rest run tests on save, typecheck the site, keep docs true and block risky shell commands.',
  },
  {
    count: '11',
    label: 'Steering files',
    text: 'Product, tech, structure, mod, bridge, site, Blender assets, privacy, writing style and video rules shape every Kiro session.',
  },
  {
    count: 'ACP',
    label: 'Agents + MCP',
    text: 'Every ghost is a real kiro-cli agent over the Agent Client Protocol, with a crew MCP server for messages, memory and a shared database.',
  },
];

export function KiroSection() {
  return (
    <section className="kiro-section" id="kiro" aria-labelledby="kiro-title">
      <div className="kiro-inner">
        <p className="crew-eyebrow">Kiroween 2026 · Frankenstein</p>
        <h2 className="kiro-title" id="kiro-title">Built with <span>Kiro</span>, runs on Kiro</h2>
        <p className="kiro-lede">
          Kiro built this project with specs, hooks and steering, and the ghosts you see in Minecraft are Kiro agents.
        </p>
        <ul className="kiro-grid">
          {PARTS.map((p) => (
            <li key={p.label}>
              <strong>{p.count}</strong>
              <h3>{p.label}</h3>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
        <div className="kiro-links">
          <Link to="/docs/$page" params={{ page: 'kiro-integration' }}>Read how Kiro was used</Link>
          <a href={KIRO_DIR} target="_blank" rel="noreferrer">See the .kiro folder on GitHub</a>
        </div>
      </div>
    </section>
  );
}
