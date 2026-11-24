// The command line, end to end, with typed input piped in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRooms } from "../src/rooms.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "escapeshell.js");
const play = (args, lines) => spawnSync(process.execPath, [BIN, ...args], { input: lines.join("\n") + "\n", encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

test("a whole game from the terminal ends with a share card", () => {
  const codes = buildRooms(11).map((r) => r.code);
  const r = play(["--seed", "11"], ["ls", "cat note.txt", ...codes.map((c) => `unlock ${c}`), "exit"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Room 1 of 10: Wake up/);
  assert.match(r.stdout, /Room 10 of 10: The way out/);
  assert.match(r.stdout, /You're out/);
  assert.match(r.stdout, /I escaped the terminal in \d+:\d\d · 0 hints · 12 commands/);
  assert.ok(!r.stdout.includes("\x1b["), "no colour codes when piped");
});

test("--room starts a practice room without a score card", () => {
  const code = buildRooms(4)[5].code;
  const r = play(["--room", "6", "--seed", "4"], ["cat door.txt", "exit"]);
  assert.match(r.stdout, /Practice mode/);
  assert.match(r.stdout, /Room 6 of 10: The guest book/);
  assert.match(r.stdout, /--seed 4 to come back/);
  assert.ok(code);
});

test("options are checked", () => {
  assert.equal(play(["--room", "11"], []).status, 2);
  assert.equal(play(["--nope"], []).status, 2);
  assert.match(play(["--help"], []).stdout, /Usage:/);
  assert.match(play(["--version"], []).stdout, /^escapeshell \d/);
});
