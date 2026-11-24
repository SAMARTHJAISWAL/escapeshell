// A small read-only filesystem. Directories are plain objects, files are strings.

export const HOME = "/home/you";

export function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

export class FS {
  constructor(root) {
    this.root = root;
  }

  /** An absolute path for `path` typed in directory `cwd`. */
  resolve(cwd, path) {
    if (path === "~" || path.startsWith("~/")) path = HOME + path.slice(1);
    return normalize(path.startsWith("/") ? path : `${cwd}/${path}`);
  }

  get(abs) {
    let node = this.root;
    for (const part of abs.split("/").filter(Boolean)) {
      if (typeof node !== "object" || !Object.hasOwn(node, part)) return null;
      node = node[part];
    }
    return node;
  }

  isDir(abs) {
    const n = this.get(abs);
    return n !== null && typeof n === "object";
  }

  isFile(abs) {
    return typeof this.get(abs) === "string";
  }

  /** Names in a directory, sorted the way ls sorts them. */
  list(abs, all = false) {
    const n = this.get(abs);
    if (typeof n !== "object" || n === null) return [];
    return Object.keys(n)
      .filter((k) => all || !k.startsWith("."))
      .sort((a, b) => a.replace(/^\./, "").localeCompare(b.replace(/^\./, "")) || a.localeCompare(b));
  }

  /** Every path under `abs` (itself first), depth first. */
  *walk(abs) {
    yield abs;
    if (!this.isDir(abs)) return;
    for (const name of this.list(abs, true)) yield* this.walk(abs === "/" ? `/${name}` : `${abs}/${name}`);
  }
}

/** Shell-style wildcard match: * and ? (and [abc]). */
export function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end > i) {
        re += `[${glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      } else re += "\\[";
    } else re += c.replace(/[.+^${}()|\\\]]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
