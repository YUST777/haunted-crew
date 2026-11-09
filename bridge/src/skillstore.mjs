// Skill store modelled on OpenBot's create_skill / revise_skill / install_local_skill.
// Skills live in <root>/.kiro/skills/<slug>/SKILL.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_LIST = 50;
const MAX_INSTALL = 64 * 1024;

function checkLine(label, value, min, max) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const v = value.trim();
  if (v.length < min || v.length > max) throw new RangeError(`${label} must be ${min}-${max} chars`);
  if (/[\r\n]/.test(v)) throw new RangeError(`${label} must be one line`);
  return v;
}

function checkFields(name, description, instructions) {
  if (typeof instructions !== 'string') throw new TypeError('instructions must be a string');
  if (instructions.trim().length < 1 || instructions.length > 12000) throw new RangeError('instructions must be 1-12000 chars');
  return {
    name: checkLine('name', name, 1, 60),
    description: checkLine('description', description, 0, 200),
    instructions,
  };
}

function slugOf(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!SLUG.test(slug)) throw new RangeError(`name "${name}" does not give a valid slug (1-40 chars)`);
  return slug;
}

function render(name, description, instructions) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${instructions}`;
}

// Returns { name, description, instructions } or null when there is no frontmatter.
function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name: meta.name ?? '', description: meta.description ?? '', instructions: m[2] };
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function createSkillStore({ root }) {
  if (typeof root !== 'string' || !root) throw new TypeError('root must be a path');
  const dir = resolve(root, '.kiro', 'skills');

  function dirOf(slug) {
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw new RangeError(`invalid slug: ${slug}`);
    const p = resolve(dir, slug);
    if (!p.startsWith(dir + sep)) throw new RangeError(`path escapes skills dir: ${slug}`);
    return p;
  }

  function load(slug) {
    const file = join(dirOf(slug), 'SKILL.md');
    if (!existsSync(file)) throw new Error(`no such skill: ${slug}`);
    return { file, text: readFileSync(file, 'utf8') };
  }

  function create({ name, description = '', instructions } = {}) {
    const f = checkFields(name, description, instructions);
    const slug = slugOf(f.name);
    mkdirSync(dir, { recursive: true });
    try {
      mkdirSync(dirOf(slug)); // non-recursive: fails if the skill already exists
    } catch (e) {
      if (e.code === 'EEXIST') throw new Error(`skill already exists: ${slug}`);
      throw e;
    }
    writeAtomic(join(dirOf(slug), 'SKILL.md'), render(f.name, f.description, f.instructions));
    return { slug, name: f.name };
  }

  function revise(slug, { description, instructions } = {}) {
    const { file, text } = load(slug);
    const old = parse(text);
    if (!old || !old.name) throw new Error(`skill ${slug} has no frontmatter name`);
    const f = checkFields(old.name, description, instructions);
    writeAtomic(file, render(old.name, f.description, f.instructions));
    return { slug, name: old.name };
  }

  function list() {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const slug of readdirSync(dir).filter((s) => SLUG.test(s)).sort()) {
      if (out.length >= MAX_LIST) break;
      const file = join(dir, slug, 'SKILL.md');
      if (!existsSync(file)) continue;
      const p = parse(readFileSync(file, 'utf8'));
      if (p && p.name) out.push({ slug, name: p.name, description: p.description });
    }
    return out;
  }

  function remove(slug) {
    const d = dirOf(slug);
    load(slug); // throws if missing
    rmSync(d, { recursive: true, force: true });
  }

  function install(srcPath) {
    if (typeof srcPath !== 'string') throw new TypeError('srcPath must be a string');
    const real = realpathSync(resolve(srcPath));
    const st = statSync(real);
    if (!st.isFile()) throw new Error('source is not a regular file');
    if (st.size > MAX_INSTALL) throw new RangeError('SKILL.md must be 64KB or less');
    const text = readFileSync(real, 'utf8');
    const p = parse(text);
    if (!p || !p.name) throw new Error('SKILL.md needs frontmatter with a name');
    const f = checkFields(p.name, p.description, p.instructions);
    const slug = slugOf(f.name);
    mkdirSync(dir, { recursive: true });
    try {
      mkdirSync(dirOf(slug));
    } catch (e) {
      if (e.code === 'EEXIST') throw new Error(`skill already exists: ${slug}`);
      throw e;
    }
    writeAtomic(join(dirOf(slug), 'SKILL.md'), text);
    return { slug, name: f.name };
  }

  return { create, revise, list, read: (slug) => load(slug).text, remove, install };
}
