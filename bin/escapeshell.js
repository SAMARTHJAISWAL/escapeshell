#!/usr/bin/env node
// escapeshell: an escape room in your terminal.

import { createInterface } from "node:readline";
import { Game, shareText, VERSION } from "../src/game.js";
import { ROOM_COUNT } from "../src/rooms.js";
import { strip } from "../src/color.js";

const SITE = "https://escapeshell.vercel.app/";

const USAGE = `escapeshell: an escape room in your terminal

Usage:
  escapeshell              start a new game (new codes every time)
  escapeshell --room N     practise one room (1-${ROOM_COUNT}); no score card
  escapeshell --seed N     replay a particular game

Inside the game, type help for the commands and hint when you're stuck.
Nothing touches your real files: the whole computer you explore is make-believe.
`;

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = (min, max) => {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${a} needs a whole number from ${min} to ${max}`);
      return v;
    };
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "--room") o.room = num(1, ROOM_COUNT);
    else if (a === "--seed") o.seed = num(0, 2 ** 31 - 1);
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

let o;
try {
  o = args(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`escapeshell: ${e.message}\n\n${USAGE}`);
  process.exit(2);
}
if (o.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (o.version) {
  process.stdout.write(`escapeshell ${VERSION}\n`);
  process.exit(0);
}

const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const show = (s) => process.stdout.write(tty ? s : strip(s));
let game = new Game({ seed: o.seed, room: o.room ? o.room - 1 : 0, practice: Boolean(o.room) }, { tty });

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  historySize: 500,
  completer: (line) => {
    const hits = game.complete(line);
    return [hits, line.split(/\s+/).at(-1) ?? ""];
  },
});

show(game.welcome());
if (!o.room) show("  Type ls to look around.\n\n");
rl.setPrompt(game.prompt());
rl.prompt();

rl.on("line", (line) => {
  if (game.done && line.trim() === "new") {
    game = new Game({}, { tty });
    show(game.welcome());
  } else {
    const r = game.input(line);
    if (r.clear) process.stdout.write(tty ? "\x1b[2J\x1b[H" : "");
    show(r.out);
    if (r.finished) {
      if (game.save().practice) {
        show("  That was practice. Run escapeshell with no options for a scored game.\n\n");
      } else {
        show(`  Share it:\n\n${shareText(game.save(), SITE).replace(/^/gm, "  ")}\n\n`);
      }
      show("  Type new for another game with new codes, or exit.\n\n");
    }
    if (r.exit) {
      if (!game.done) show(`\n  You're still inside, room ${game.save().room + 1} of ${ROOM_COUNT}. Run escapeshell --seed ${game.save().seed} to come back to the same codes.\n\n`);
      rl.close();
      return;
    }
  }
  rl.setPrompt(game.prompt());
  rl.prompt();
});

rl.on("close", () => process.exit(0));
