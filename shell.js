// A small shell: quoting, wildcards, pipes, `<`, `;`, `&&`, `||`, and the
// commands the rooms need. It never touches the real computer.

import { blue, bold, red } from "./color.js";
import { globToRegex, HOME } from "./fs.js";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a command line into words and operators, keeping track of quoting. */
export function tokenize(line) {
  const tokens = [];
  let word = null;
  let quoted = false;
  const push = () => {
    if (word !== null) tokens.push({ word, quoted });
    word = null;
    quoted = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unclosed ${c === "'" ? "single" : "double"} quote`);
      word = (word ?? "") + line.slice(i + 1, end);
      quoted = true;
      i = end;
    } else if (c === "\\" && i + 1 < line.length) {
      word = (word ?? "") + line[++i];
      quoted = true;
    } else if (/\s/.test(c)) {
      push();
    } else if ("|&;<>".includes(c)) {
      push();
      const two = line.slice(i, i + 2);
      if (two === "&&" || two === "||" || two === ">>") {
        tokens.push({ op: two });
        i++;
      } else if (c === "&") {
        throw new Error("running things in the background isn't possible in here");
      } else tokens.push({ op: c });
    } else {
      word = (word ?? "") + c;
    }
  }
  push();
  return tokens;
}

/** Group tokens into a list of { op, pipeline: [{ args, input }] }. */
export function parse(line) {
  const tokens = tokenize(line);
  const list = [];
  let pipeline = [];
  let cmd = { words: [], input: null };
  let op = null;
  const endCommand = () => {
    if (!cmd.words.length) throw new Error("syntax error: a command is missing");
    pipeline.push(cmd);
    cmd = { words: [], input: null };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.op) {
      cmd.words.push(t);
    } else if (t.op === "|") {
      endCommand();
    } else if (t.op === "<") {
      const next = tokens[++i];
      if (!next || next.op) throw new Error("syntax error: < needs a file name");
      cmd.input = next.word;
    } else if (t.op === ">" || t.op === ">>") {
      throw new Error("this filesystem is read-only, so > can't write files. Just let the output print.");
    } else {
      endCommand();
      list.push({ op, pipeline });
      pipeline = [];
      op = t.op;
    }
  }
  if (cmd.words.length || pipeline.length || list.length) endCommand();
  list.push({ op, pipeline });
  return list.filter((x) => x.pipeline.length);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const lines = (text) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
const text = (arr) => (arr.length ? `${arr.join("\n")}\n` : "");
const ok = (out = "") => ({ out, err: "", code: 0 });
const fail = (err, out = "") => ({ out, err, code: 1 });

/**
 * Pull flags out of args. `spec` lists single-letter flags; a letter followed
 * by ":" takes a value ("n:" for -n 5, -n5). Returns { flags, rest } or throws.
 */
export function flags(args, spec, cmd) {
  const takes = new Set();
  const known = new Set();
  for (const m of spec.matchAll(/([a-zA-Z0-9])(:?)/g)) {
    known.add(m[1]);
    if (m[2]) takes.add(m[1]);
  }
  const f = {};
  const rest = [];
  let done = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (done || a === "-" || !a.startsWith("-") || a.length === 1) {
      rest.push(a);
      continue;
    }
    if (a === "--") {
      done = true;
      continue;
    }
    if (a.startsWith("--")) {
      const long = { "--decode": "d", "--count": "c", "--recursive": "r", "--all": "a", "--lines": "l", "--reverse": "r", "--numeric-sort": "n", "--ignore-case": "i", "--invert-match": "v" }[a];
      if (!long || !known.has(long)) throw new Error(`${cmd}: unknown option ${a}`);
      f[long] = true;
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      if (/\d/.test(c) && known.has("n") && takes.has("n") && j === 1) {
        f.n = a.slice(1); // head -5
        break;
      }
      if (!known.has(c)) throw new Error(`${cmd}: unknown option -${c}. Try: man ${cmd}`);
      if (takes.has(c)) {
        const v = a.slice(j + 1) || args[++i];
        if (v === undefined) throw new Error(`${cmd}: -${c} needs a value`);
        f[c] = v;
        break;
      }
      f[c] = true;
    }
  }
  return { f, rest };
}

function count(n, cmd) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0) throw new Error(`${cmd}: ${n} isn't a number of lines`);
  return v;
}

/** Read files named in args, or stdin when there are none. */
function inputs(ctx, files, stdin, cmd) {
  if (!files.length) return { items: [{ name: null, body: stdin ?? "" }], errs: [] };
  const items = [];
  const errs = [];
  for (const name of files) {
    if (name === "-") {
      items.push({ name, body: stdin ?? "" });
      continue;
    }
    const abs = ctx.fs.resolve(ctx.cwd, name);
    const node = ctx.fs.get(abs);
    if (node === null) errs.push(`${cmd}: ${name}: No such file or directory`);
    else if (typeof node === "object") errs.push(`${cmd}: ${name}: Is a directory`);
    else items.push({ name, body: node });
  }
  return { items, errs };
}

function result(out, errs) {
  return { out, err: errs.join("\n"), code: errs.length ? 1 : 0 };
}

function utf8ToBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(s) {
  const clean = s.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("base64: invalid input");
  const bin = atob(clean);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function fieldList(spec, cmd) {
  const parts = spec.split(",").map((p) => {
    const m = /^(\d*)(-?)(\d*)$/.exec(p);
    if (!m || (!m[1] && !m[3])) throw new Error(`${cmd}: invalid list "${spec}"`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : Infinity) : from;
    if (from < 1) throw new Error(`${cmd}: fields are numbered from 1`);
    return [from, to];
  });
  return (i) => parts.some(([a, b]) => i >= a && i <= b);
}

const leadingNumber = (s) => {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : 0;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export const MANUAL = {
  ls: ["ls [-a] [-l] [path...]", "List what's in a directory. -a shows hidden files (names starting with a dot). -l shows sizes."],
  cd: ["cd [dir]", "Change directory. `cd ..` goes up, `cd ~` goes home, `cd -` goes back."],
  pwd: ["pwd", "Print the directory you're in."],
  cat: ["cat [file...]", "Print files."],
  head: ["head [-n N] [file]", "Print the first N lines (10 if you don't say)."],
  tail: ["tail [-n N] [file]", "Print the last N lines (10 if you don't say)."],
  grep: ["grep [-i] [-v] [-c] [-n] [-r] PATTERN [file...]", "Print lines that contain PATTERN. -i ignores case, -v prints lines that don't match, -c counts them, -n numbers them, -r searches every file under a directory. Patterns are extended regular expressions, as with grep -E."],
  find: ["find [dir] [-name PATTERN] [-type f|d]", "Search for files by name. Quote patterns with wildcards: find . -name '*.txt'"],
  wc: ["wc [-l] [-w] [-c] [file]", "Count lines, words and characters. -l counts only lines."],
  sort: ["sort [-r] [-n] [-u] [-k N] [-t SEP] [file]", "Sort lines. -r reverses, -n sorts numbers by value, -u drops repeats, -k N sorts by the Nth field."],
  uniq: ["uniq [-c] [file]", "Collapse repeated neighbouring lines into one. -c counts them. Usually used after sort."],
  cut: ["cut -d SEP -f LIST [file]", "Print chosen fields of each line. cut -d , -f 2 prints the second comma-separated column."],
  base64: ["base64 [-d] [file]", "Encode to base64, or decode with -d."],
  rev: ["rev [file]", "Reverse each line, character by character."],
  echo: ["echo [text...]", "Print text."],
  tree: ["tree [dir]", "Draw the directories and files under a directory."],
  history: ["history", "Show the commands you've typed."],
  clear: ["clear", "Clear the screen."],
  man: ["man COMMAND", "Explain a command."],
  help: ["help", "List the commands."],
};

const REFUSALS = {
  sudo: "Nice try. Margo never gave you root.",
  su: "Nice try. Margo never gave you root.",
  rm: "Everything here is read-only. Margo made sure of that.",
  mv: "Everything here is read-only. Margo made sure of that.",
  cp: "Everything here is read-only. Margo made sure of that.",
  touch: "Everything here is read-only. Margo made sure of that.",
  mkdir: "Everything here is read-only. Margo made sure of that.",
  chmod: "Everything here is read-only. Margo made sure of that.",
  vim: "You'd never get out. Try cat.",
  vi: "You'd never get out. Try cat.",
  nano: "Everything here is read-only. Try cat, less isn't needed.",
  emacs: "No room for that in here. Try cat.",
  less: "No pager in here. cat, head and tail will do.",
  more: "No pager in here. cat, head and tail will do.",
  ssh: "The network cable was cut long ago.",
  curl: "The network cable was cut long ago.",
  wget: "The network cable was cut long ago.",
  ping: "The network cable was cut long ago.",
  awk: "awk isn't installed here. grep, cut, sort and uniq can do everything you need.",
  sed: "sed isn't installed here. grep, cut, sort and uniq can do everything you need.",
  python: "No Python on this machine. Everything here can be solved with shell tools.",
  python3: "No Python on this machine. Everything here can be solved with shell tools.",
  node: "No Node on this machine. Everything here can be solved with shell tools.",
};

function ls(args, stdin, ctx) {
  const { f, rest } = flags(args, "al1Ah", "ls");
  const paths = rest.length ? rest : ["."];
  const out = [];
  const errs = [];
  const show = (name, abs) => {
    const dir = ctx.fs.isDir(abs);
    if (f.l) {
      const node = ctx.fs.get(abs);
      const size = dir ? 4096 : new TextEncoder().encode(node).length;
      return `${dir ? "drwxr-xr-x" : "-r--r--r--"}  you  ${String(size).padStart(7)}  ${dir && ctx.tty ? bold(blue(name)) : name}`;
    }
    return dir && ctx.tty ? bold(blue(`${name}/`)) : name;
  };
  const files = paths.filter((p) => ctx.fs.isFile(ctx.fs.resolve(ctx.cwd, p)));
  const dirs = paths.filter((p) => ctx.fs.isDir(ctx.fs.resolve(ctx.cwd, p)));
  for (const p of paths) if (!files.includes(p) && !dirs.includes(p)) errs.push(`ls: ${p}: No such file or directory`);
  const block = (names) => {
    if (!names.length) return;
    if (f.l || f[1] || !ctx.tty) out.push(...names);
    else out.push(names.join("  "));
  };
  block(files.map((p) => show(p, ctx.fs.resolve(ctx.cwd, p))));
  for (const p of dirs) {
    const abs = ctx.fs.resolve(ctx.cwd, p);
    if (paths.length > 1) out.push(`${out.length ? "\n" : ""}${p}:`);
    const names = ctx.fs.list(abs, f.a || f.A);
    const all = f.a ? [".", "..", ...names] : names;
    block(all.map((n) => show(n, n === "." || n === ".." ? ctx.fs.resolve(abs, n) : `${abs === "/" ? "" : abs}/${n}`)));
  }
  return result(text(out), errs);
}

function cd(args, stdin, ctx) {
  const target = args[0] ?? "~";
  if (args.length > 1) return fail("cd: too many arguments");
  if (target === "-") {
    const back = ctx.state.prev || ctx.cwd;
    ctx.state.prev = ctx.cwd;
    ctx.state.cwd = back;
    return ok(`${back}\n`);
  }
  const abs = ctx.fs.resolve(ctx.cwd, target);
  if (ctx.fs.isFile(abs)) return fail(`cd: ${target}: Not a directory`);
  if (!ctx.fs.isDir(abs)) return fail(`cd: ${target}: No such file or directory`);
  ctx.state.prev = ctx.cwd;
  ctx.state.cwd = abs;
  return ok();
}

function cat(args, stdin, ctx) {
  const { rest } = flags(args, "n", "cat");
  const { items, errs } = inputs(ctx, rest, stdin, "cat");
  return result(items.map((i) => i.body).join(""), errs);
}

function headTail(which) {
  return (args, stdin, ctx) => {
    const { f, rest } = flags(args, "n:", which);
    const n = f.n === undefined ? 10 : count(f.n, which);
    const { items, errs } = inputs(ctx, rest, stdin, which);
    const out = [];
    for (const it of items) {
      if (items.length > 1) out.push(`${out.length ? "\n" : ""}==> ${it.name} <==`);
      const ls2 = lines(it.body);
      out.push(...(which === "head" ? ls2.slice(0, n) : n ? ls2.slice(-n) : []));
    }
    return result(text(out), errs);
  };
}

function grep(args, stdin, ctx) {
  const { f, rest } = flags(args, "ivcnrRlowEFHhe:", "grep");
  const pattern = f.e ?? rest.shift();
  if (pattern === undefined) return fail("grep: what should I search for? Usage: grep PATTERN [file...]");
  let re;
  const flagsRe = f.i ? "gi" : "g";
  const literal = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let source = f.F ? literal : pattern;
  if (f.w) source = `\\b(?:${source})\\b`;
  try {
    re = new RegExp(source, flagsRe);
  } catch {
    re = new RegExp(f.w ? `\\b${literal}\\b` : literal, flagsRe);
  }
  const recursive = f.r || f.R;
  const targets = rest.length ? rest : recursive ? ["."] : [];
  const items = [];
  const errs = [];
  if (!targets.length) items.push({ name: null, body: stdin ?? "" });
  for (const t of targets) {
    const abs = ctx.fs.resolve(ctx.cwd, t);
    const node = ctx.fs.get(abs);
    if (node === null) errs.push(`grep: ${t}: No such file or directory`);
    else if (typeof node === "string") items.push({ name: t, body: node });
    else if (!recursive) errs.push(`grep: ${t}: Is a directory (add -r to search inside it)`);
    else {
      for (const p of ctx.fs.walk(abs)) {
        if (!ctx.fs.isFile(p)) continue;
        const shown = t === "/" ? p : t.replace(/\/+$/, "") + p.slice(abs === "/" ? 0 : abs.length);
        items.push({ name: shown, body: ctx.fs.get(p) });
      }
    }
  }
  const prefix = f.H || ((items.length > 1 || recursive) && !f.h);
  const out = [];
  let matched = 0;
  for (const it of items) {
    let c = 0;
    lines(it.body).forEach((line, idx) => {
      re.lastIndex = 0;
      const hit = re.test(line) !== Boolean(f.v);
      if (!hit) return;
      c++;
      if (f.c || f.l) return;
      const pre = `${prefix && it.name ? `${it.name}:` : ""}${f.n ? `${idx + 1}:` : ""}`;
      re.lastIndex = 0; // test() moved it; matchAll and replace must start from the beginning
      if (f.o && !f.v) {
        for (const m of line.matchAll(re)) if (m[0]) out.push(pre + (ctx.tty ? bold(red(m[0])) : m[0]));
      } else {
        out.push(pre + (ctx.tty && !f.v ? line.replace(re, (m) => (m ? bold(red(m)) : m)) : line));
      }
    });
    matched += c;
    if (f.c) out.push(`${prefix && it.name ? `${it.name}:` : ""}${c}`);
    if (f.l && c) out.push(it.name ?? "(standard input)");
  }
  return { out: text(out), err: errs.join("\n"), code: errs.length ? 2 : matched ? 0 : 1 };
}

function find(args, stdin, ctx) {
  const starts = [];
  let i = 0;
  while (i < args.length && !args[i].startsWith("-")) starts.push(args[i++]);
  if (!starts.length) starts.push(".");
  const tests = [];
  let maxDepth = Infinity;
  while (i < args.length) {
    const a = args[i++];
    const v = args[i++];
    if (v === undefined) return fail(`find: ${a} needs a value`);
    if (a === "-name" || a === "-iname") {
      const re = globToRegex(v);
      const ci = new RegExp(re.source, "i");
      tests.push((p) => (a === "-name" ? re : ci).test(p.slice(p.lastIndexOf("/") + 1)));
    } else if (a === "-type") {
      if (v !== "f" && v !== "d") return fail("find: -type takes f (files) or d (directories)");
      tests.push((p) => (v === "d" ? ctx.fs.isDir(p) : ctx.fs.isFile(p)));
    } else if (a === "-maxdepth") {
      maxDepth = count(v, "find");
    } else {
      return fail(`find: unknown option ${a}. Try -name, -type or -maxdepth`);
    }
  }
  const out = [];
  const errs = [];
  for (const s of starts) {
    const abs = ctx.fs.resolve(ctx.cwd, s);
    if (ctx.fs.get(abs) === null) {
      errs.push(`find: ${s}: No such file or directory`);
      continue;
    }
    const base = s.replace(/(.)\/+$/, "$1");
    const depthOf = (p) => (p === abs ? 0 : p.slice(abs === "/" ? 0 : abs.length).split("/").length - 1);
    for (const p of ctx.fs.walk(abs)) {
      if (depthOf(p) > maxDepth) continue;
      if (!tests.every((t) => t(p))) continue;
      const rel = p === abs ? base : (base === "/" ? "" : base) + p.slice(abs === "/" ? 0 : abs.length);
      out.push(rel);
    }
  }
  return result(text(out), errs);
}

function wc(args, stdin, ctx) {
  const { f, rest } = flags(args, "lwcm", "wc");
  const pick = f.l || f.w || f.c || f.m ? [f.l, f.w, f.c || f.m] : [true, true, true];
  const { items, errs } = inputs(ctx, rest, stdin, "wc");
  const out = items.map((it) => {
    const nums = [lines(it.body).length, it.body.split(/\s+/).filter(Boolean).length, [...it.body].length];
    const shown = nums.filter((_, k) => pick[k]);
    const cols = shown.length === 1 ? String(shown[0]) : shown.map((x) => String(x).padStart(7)).join(" ");
    return it.name ? `${cols} ${it.name}` : cols;
  });
  return result(text(out), errs);
}

function sort(args, stdin, ctx) {
  const { f, rest } = flags(args, "rnufk:t:", "sort");
  const { items, errs } = inputs(ctx, rest, stdin, "sort");
  let all = items.flatMap((it) => lines(it.body));
  const key = f.k ? count(f.k, "sort") : 0;
  const keyOf = (line) => {
    if (!key) return line;
    const parts = f.t ? line.split(f.t) : line.trim().split(/\s+/);
    return parts.slice(key - 1).join(f.t || " ");
  };
  const cmp = f.n
    ? (a, b) => leadingNumber(keyOf(a)) - leadingNumber(keyOf(b)) || a.localeCompare(b)
    : (a, b) => {
        const x = f.f ? keyOf(a).toLowerCase() : keyOf(a);
        const y = f.f ? keyOf(b).toLowerCase() : keyOf(b);
        return x < y ? -1 : x > y ? 1 : 0;
      };
  all = all.map((l, i) => [l, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map(([l]) => l);
  if (f.r) all.reverse();
  if (f.u) all = all.filter((l, i) => i === 0 || l !== all[i - 1]);
  return result(text(all), errs);
}

function uniq(args, stdin, ctx) {
  const { f, rest } = flags(args, "cdui", "uniq");
  const { items, errs } = inputs(ctx, rest.slice(0, 1), stdin, "uniq");
  const runs = [];
  for (const line of lines(items[0]?.body ?? "")) {
    const last = runs.at(-1);
    if (last && (f.i ? last.line.toLowerCase() === line.toLowerCase() : last.line === line)) last.n++;
    else runs.push({ line, n: 1 });
  }
  const kept = runs.filter((r) => (f.d ? r.n > 1 : f.u ? r.n === 1 : true));
  return result(text(kept.map((r) => (f.c ? `${String(r.n).padStart(7)} ${r.line}` : r.line))), errs);
}

function cut(args, stdin, ctx) {
  const { f, rest } = flags(args, "d:f:c:s", "cut");
  if (!f.f && !f.c) return fail("cut: say which fields with -f (for example: cut -d , -f 2)");
  const { items, errs } = inputs(ctx, rest, stdin, "cut");
  const out = [];
  for (const it of items) {
    for (const line of lines(it.body)) {
      if (f.c) {
        const want = fieldList(f.c, "cut");
        out.push([...line].filter((_, k) => want(k + 1)).join(""));
        continue;
      }
      const sep = f.d ?? "\t";
      if (sep.length !== 1) return fail("cut: the delimiter must be a single character");
      const want = fieldList(f.f, "cut");
      if (!line.includes(sep)) {
        if (!f.s) out.push(line);
        continue;
      }
      out.push(line.split(sep).filter((_, k) => want(k + 1)).join(sep));
    }
  }
  return result(text(out), errs);
}

function base64(args, stdin, ctx) {
  const { f, rest } = flags(args, "dD", "base64");
  const { items, errs } = inputs(ctx, rest, stdin, "base64");
  const body = items.map((i) => i.body).join("");
  if (f.d || f.D) return result(base64ToUtf8(body), errs);
  const enc = utf8ToBase64(body);
  return result(text(enc.match(/.{1,76}/g) ?? []), errs);
}

function rev(args, stdin, ctx) {
  const { items, errs } = inputs(ctx, args, stdin, "rev");
  return result(text(items.flatMap((it) => lines(it.body)).map((l) => [...l].reverse().join(""))), errs);
}

function echo(args) {
  if (args[0] === "-n") return ok(args.slice(1).join(" "));
  return ok(`${args.join(" ")}\n`);
}

function tree(args, stdin, ctx) {
  const { f, rest } = flags(args, "a", "tree");
  const start = rest[0] ?? ".";
  const abs = ctx.fs.resolve(ctx.cwd, start);
  if (!ctx.fs.isDir(abs)) return fail(`tree: ${start}: not a directory`);
  const out = [ctx.tty ? bold(blue(start)) : start];
  let dirs = 0;
  let files = 0;
  const walk = (dir, pad) => {
    const names = ctx.fs.list(dir, f.a);
    names.forEach((name, k) => {
      const p = `${dir === "/" ? "" : dir}/${name}`;
      const last = k === names.length - 1;
      const isDir = ctx.fs.isDir(p);
      out.push(`${pad}${last ? "└── " : "├── "}${isDir && ctx.tty ? bold(blue(name)) : name}`);
      if (isDir) {
        dirs++;
        walk(p, pad + (last ? "    " : "│   "));
      } else files++;
    });
  };
  walk(abs, "");
  out.push("", `${dirs} director${dirs === 1 ? "y" : "ies"}, ${files} file${files === 1 ? "" : "s"}`);
  return ok(text(out));
}

function man(args) {
  const m = MANUAL[args[0]];
  if (!args[0]) return fail("man: which command? For example: man grep");
  if (!m) return fail(`man: no manual entry for ${args[0]}. Type help to see the commands.`);
  return ok(`${m[0]}\n  ${m[1]}\n`);
}

function help(args, stdin, ctx) {
  const names = Object.keys(MANUAL);
  const width = Math.max(...names.map((n) => n.length));
  const rows = names.map((n) => `  ${(ctx.tty ? bold(n) : n) + " ".repeat(width - n.length)}  ${MANUAL[n][1].split(". ")[0].replace(/\.$/, "")}`);
  return ok(text([...(ctx.extraHelp ?? []), "Commands:", ...rows, "", "Pipes work: cat file | grep word | wc -l"]));
}

export const COMMANDS = {
  ls, cd, cat, grep, find, wc, sort, uniq, cut, base64, rev, echo, tree, man, help,
  head: headTail("head"),
  tail: headTail("tail"),
  pwd: (args, stdin, ctx) => ok(`${ctx.cwd}\n`),
  whoami: () => ok("you\n"),
  hostname: () => ok("aurora-7\n"),
  date: () => ok("The clock stopped at Tue Mar 14 03:12:44 UTC 2034.\n"),
  history: (args, stdin, ctx) => ok(text(ctx.state.history.map((h, k) => `${String(k + 1).padStart(5)}  ${h}`))),
};

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Expand ~ and wildcards in unquoted words. */
function expand(words, ctx) {
  const out = [];
  for (const { word, quoted } of words) {
    let w = word;
    if (!quoted && (w === "~" || w.startsWith("~/"))) w = HOME + w.slice(1);
    if (quoted || !/[*?[]/.test(w)) {
      out.push(w);
      continue;
    }
    const absolute = w.startsWith("/");
    const parts = w.split("/").filter((p, k) => p || k === 0);
    let found = [absolute ? "/" : ""];
    for (const part of parts.filter(Boolean)) {
      const next = [];
      for (const base of found) {
        if (!/[*?[]/.test(part)) {
          next.push(base === "" ? part : base === "/" ? `/${part}` : `${base}/${part}`);
          continue;
        }
        const re = globToRegex(part);
        const dir = ctx.fs.resolve(ctx.cwd, base || ".");
        for (const name of ctx.fs.list(dir, part.startsWith("."))) {
          if (re.test(name)) next.push(base === "" ? name : base === "/" ? `/${name}` : `${base}/${name}`);
        }
      }
      found = next;
    }
    found = found.filter((p) => ctx.fs.get(ctx.fs.resolve(ctx.cwd, p)) !== null);
    out.push(...(found.length ? found : [w]));
  }
  return out;
}

/**
 * Run one command line. `state` holds { cwd, prev, history }. `extra` adds
 * commands (the game's hint and unlock). Returns { out, clear, exit }.
 */
export function run(line, fs, state, { tty = true, extra = {}, extraHelp } = {}) {
  let list;
  try {
    list = parse(line);
  } catch (e) {
    return { out: `${tty ? red(e.message) : e.message}\n`, code: 2 };
  }
  let shown = "";
  let code = 0;
  const effects = {};
  for (const { op, pipeline } of list) {
    if ((op === "&&" && code !== 0) || (op === "||" && code === 0)) continue;
    let stdin = null;
    for (let k = 0; k < pipeline.length; k++) {
      const ctx = { fs, cwd: state.cwd, state, tty: tty && k === pipeline.length - 1, extraHelp };
      const cmd = pipeline[k];
      let r;
      try {
        const [name, ...args] = expand(cmd.words, ctx);
        if (cmd.input !== null) {
          const abs = fs.resolve(state.cwd, cmd.input);
          if (!fs.isFile(abs)) throw new Error(`${cmd.input}: No such file`);
          stdin = fs.get(abs);
        }
        if (Object.hasOwn(extra, name)) r = extra[name](args, stdin, ctx);
        else if (Object.hasOwn(COMMANDS, name)) r = COMMANDS[name](args, stdin, ctx);
        else if (name === "clear") {
          effects.clear = true;
          shown = "";
          r = ok();
        } else if (name === "exit" || name === "quit" || name === "logout") {
          effects.exit = true;
          r = ok();
        } else if (Object.hasOwn(REFUSALS, name)) r = fail(`${name}: ${REFUSALS[name]}`);
        else r = { out: "", err: `${name}: command not found. Type help to see what's available.`, code: 127 };
      } catch (e) {
        r = fail(e.message);
      }
      if (r.err) shown += `${tty ? red(r.err) : r.err}\n`;
      stdin = r.out;
      code = r.code;
      if (r.effect) Object.assign(effects, r.effect);
    }
    shown += stdin ?? "";
  }
  return { out: shown, code, ...effects };
}
