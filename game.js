// The game: rooms, doors, hints, the clock and the score. Both front ends
// (terminal and browser) drive this and print what it returns.

import { bold, cyan, dim, green, yellow } from "./color.js";
import { FS, HOME } from "./fs.js";
import { buildRooms, ROOM_COUNT } from "./rooms.js";
import { run } from "./shell.js";

export const VERSION = "0.1.0";

export function newSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

const normalizeCode = (s) => s.trim().toUpperCase().replace(/\s+/g, "");

export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** One square per room: 🟩 no hints, 🟨 one hint, 🟧 two or more. */
export function squares(hintsPerRoom) {
  return hintsPerRoom.map((h) => (h === 0 ? "🟩" : h === 1 ? "🟨" : "🟧")).join("");
}

export function shareText(stats, url) {
  const hints = stats.hints.reduce((a, b) => a + b, 0);
  return `🔓 I escaped the terminal in ${clock(stats.elapsed)} · ${hints} hint${hints === 1 ? "" : "s"} · ${stats.commands} commands\n${squares(stats.hints)}\nescapeshell — can you get out? ${url}`;
}

export class Game {
  /**
   * state: { seed, room, hints: [per room], commands, elapsed, practice }
   * `now` is injectable so tests can control the clock.
   */
  constructor(state = {}, { now = () => Date.now(), tty = true } = {}) {
    this.now = now;
    this.tty = tty;
    this.s = {
      seed: state.seed ?? newSeed(),
      room: state.room ?? 0,
      hints: state.hints ?? Array(ROOM_COUNT).fill(0),
      commands: state.commands ?? 0,
      elapsed: state.elapsed ?? 0,
      practice: state.practice ?? false,
      done: state.done ?? false,
      history: state.history ?? [],
    };
    this.rooms = buildRooms(this.s.seed);
    this.started = now();
    this.enter(this.s.room, state.cwd);
  }

  get done() {
    return this.s.done;
  }

  /** The total time played, across sessions. */
  time() {
    return this.s.elapsed + (this.s.done ? 0 : this.now() - this.started);
  }

  /** What to save, to resume later. */
  save() {
    return { ...this.s, elapsed: this.time(), cwd: this.state?.cwd };
  }

  enter(index, cwd) {
    const room = this.rooms[Math.min(index, ROOM_COUNT - 1)];
    this.room = room;
    this.fs = new FS(room.files);
    this.state = { cwd: cwd && this.fs.isDir(cwd) ? cwd : room.cwd, prev: null, history: this.s.history };
  }

  c(fn, text) {
    return this.tty ? fn(text) : text;
  }

  prompt() {
    const cwd = this.state.cwd === HOME ? "~" : this.state.cwd.startsWith(`${HOME}/`) ? `~${this.state.cwd.slice(HOME.length)}` : this.state.cwd;
    return `${this.c(green, `room ${this.s.room + 1}`)}:${this.c(cyan, cwd)}$ `;
  }

  /** The banner for the current room. */
  intro() {
    const r = this.room;
    const out = [
      "",
      this.c(bold, `── Room ${this.s.room + 1} of ${ROOM_COUNT}: ${r.title} ──`),
      ...r.story,
      this.c(dim, `You'll learn: ${r.skill}. Type hint if you're stuck.`),
      "",
    ];
    return `${out.join("\n")}\n`;
  }

  welcome() {
    return [
      "",
      this.c(bold, "  escapeshell"),
      this.c(dim, "  An escape room in a terminal. Ten locked doors. Real shell commands."),
      this.s.practice ? this.c(yellow, "  Practice mode: this run won't make a score card.") : "",
      "",
    ]
      .filter((l, k, a) => l !== "" || a[k - 1] !== "")
      .join("\n") + this.intro();
  }

  hint() {
    const used = this.s.hints[this.s.room];
    const h = this.room.hints[Math.min(used, this.room.hints.length - 1)];
    if (used < this.room.hints.length) this.s.hints[this.s.room]++;
    const left = this.room.hints.length - this.s.hints[this.s.room];
    return `${this.c(yellow, `Hint ${Math.min(used + 1, this.room.hints.length)}/${this.room.hints.length}:`)} ${h}${left ? "" : this.c(dim, " (that's the last hint)")}\n`;
  }

  unlock(args) {
    if (!args.length) return { out: "", err: "unlock: which code? Usage: unlock THE-CODE", code: 1 };
    if (normalizeCode(args.join("")) !== normalizeCode(this.room.code)) {
      return { out: "", err: "The door doesn't move. That's not the code.", code: 1 };
    }
    const finished = this.s.room === ROOM_COUNT - 1;
    if (finished) {
      this.s.elapsed = this.time();
      this.s.done = true;
      return { out: this.ending(), err: "", code: 0, effect: { finished: true } };
    }
    this.s.room++;
    this.enter(this.s.room);
    return { out: `${this.c(green, "✓ The door slides open.")}\n${this.intro()}`, err: "", code: 0, effect: { advanced: true } };
  }

  ending() {
    const hints = this.s.hints.reduce((a, b) => a + b, 0);
    return `${[
      "",
      this.c(green, this.c(bold, "  🔓 The last door opens. Cold air. Stars. You're out.")),
      "",
      `  Time      ${clock(this.s.elapsed)}`,
      `  Hints     ${hints}`,
      `  Commands  ${this.s.commands}`,
      `  Rooms     ${squares(this.s.hints)}`,
      "",
      this.c(dim, "  Margo would be proud. You now know ls, cat, find, grep, pipes, sort, uniq, cut, base64 and rev."),
      "",
    ].join("\n")}\n`;
  }

  /** Run what the player typed. Returns { out, clear, exit, finished }. */
  input(line) {
    const trimmed = line.trim();
    if (!trimmed) return { out: "" };
    if (this.s.done) {
      return { out: `${this.c(dim, "You're already out. Type new to play again with new codes.")}\n` };
    }
    this.s.commands++;
    this.s.history.push(trimmed);
    const extra = {
      hint: () => ({ out: this.hint(), err: "", code: 0 }),
      unlock: (args) => this.unlock(args),
      room: () => ({ out: this.intro(), err: "", code: 0 }),
    };
    const extraHelp = ["Game:", "  hint            a nudge for this room (it shows on your score)", "  unlock CODE     open the door", "  room            read this room's story again", ""];
    return run(trimmed, this.fs, this.state, { tty: this.tty, extra, extraHelp });
  }

  /** Words to complete at the cursor, for tab completion. */
  complete(line) {
    const words = line.split(/\s+/);
    const last = words.at(-1) ?? "";
    if (words.length <= 1) {
      const names = ["ls", "cd", "pwd", "cat", "head", "tail", "grep", "find", "wc", "sort", "uniq", "cut", "base64", "rev", "echo", "tree", "history", "clear", "man", "help", "hint", "unlock", "room"];
      return names.filter((n) => n.startsWith(last));
    }
    const slash = last.lastIndexOf("/");
    const dirPart = slash >= 0 ? last.slice(0, slash + 1) : "";
    const base = slash >= 0 ? last.slice(slash + 1) : last;
    const abs = this.fs.resolve(this.state.cwd, dirPart || ".");
    return this.fs
      .list(abs, base.startsWith("."))
      .filter((n) => n.startsWith(base))
      .map((n) => dirPart + n + (this.fs.isDir(`${abs === "/" ? "" : abs}/${n}`) ? "/" : ""));
  }
}

