import { test } from "node:test";
import assert from "node:assert/strict";
import { strip } from "../src/color.js";
import { clock, Game, shareText, squares } from "../src/game.js";
import { buildRooms, ROOM_COUNT, rng } from "../src/rooms.js";

/** Play a whole game the way a player would: run each room's commands and read the code off the screen. */
function solveRoom(g) {
  let out = "";
  for (const cmd of g.room.solve) out = g.input(cmd.replace("{prev}", out.trim().split("\n")[0])).out;
  return out;
}

test("every room in every game can be solved with its own commands", () => {
  for (let seed = 1; seed <= 150; seed++) {
    const g = new Game({ seed }, { tty: false });
    for (let k = 0; k < ROOM_COUNT; k++) {
      const out = solveRoom(g);
      for (const part of g.room.code.split("-")) assert.ok(out.toUpperCase().includes(part), `seed ${seed} room ${k + 1}: ${part} not in output`);
      g.input(`unlock ${g.room.code}`);
    }
    assert.ok(g.done, `seed ${seed} didn't finish`);
  }
});

test("rooms are the same for a seed and different across seeds", () => {
  const a = buildRooms(42).map((r) => r.code);
  assert.deepEqual(buildRooms(42).map((r) => r.code), a);
  assert.notDeepEqual(buildRooms(43).map((r) => r.code), a);
  assert.equal(new Set(a).size, ROOM_COUNT);
  const r = rng(1);
  const xs = Array.from({ length: 1000 }, () => r.next());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("the knocking room's count survives grep reading dots as wildcards", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const g = new Game({ seed, room: 4 }, { tty: false });
    assert.equal(g.input(g.room.solve[0]).out.trim(), g.room.code, `seed ${seed}`);
  }
});

test("the crowd room has one clear winner", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const g = new Game({ seed, room: 5 }, { tty: false });
    const [a, b] = g.input("sort guestbook.txt | uniq -c | sort -rn | head -2").out.trim().split("\n").map((l) => Number(l.trim().split(" ")[0]));
    assert.ok(a > b, `seed ${seed}: ${a} vs ${b}`);
  }
});

test("unlock is forgiving about case and spaces, and strict about the code", () => {
  const g = new Game({ seed: 5 }, { tty: false });
  assert.match(g.input("unlock WRONG-00").out, /That's not the code/);
  assert.match(g.input("unlock").out, /which code/);
  g.input(`unlock ${g.room.code.toLowerCase()}`);
  assert.equal(g.save().room, 1);
});

test("hints run out, and are counted per room", () => {
  const g = new Game({ seed: 5 }, { tty: false });
  for (let k = 0; k < 5; k++) g.input("hint");
  assert.equal(g.save().hints[0], 3);
  assert.match(g.input("hint").out, /Hint 3\/3/);
  g.input(`unlock ${g.room.code}`);
  g.input("hint");
  assert.deepEqual(g.save().hints.slice(0, 3), [3, 1, 0]);
});

test("the clock, the squares and the share text", () => {
  let t = 0;
  const g = new Game({ seed: 9 }, { tty: false, now: () => t });
  t = 61_000;
  g.input("hint");
  for (let k = 0; k < ROOM_COUNT; k++) g.input(`unlock ${g.room.code}`);
  t = 999_000;
  assert.equal(g.save().elapsed, 61_000, "the clock stops at the last door");
  assert.equal(clock(61_000), "1:01");
  assert.equal(clock(3_725_000), "1:02:05");
  assert.equal(squares([0, 1, 2, 3]), "🟩🟨🟧🟧");
  assert.equal(shareText(g.save(), "https://x.y/"), `🔓 I escaped the terminal in 1:01 · 1 hint · 11 commands\n🟨🟩🟩🟩🟩🟩🟩🟩🟩🟩\nescapeshell — can you get out? https://x.y/`);
  assert.match(g.input("ls").out, /already out/);
});

test("a saved game resumes in the same room, directory and clock", () => {
  let t = 0;
  const g = new Game({ seed: 3 }, { tty: false, now: () => t });
  for (let k = 0; k < 2; k++) g.input(`unlock ${g.room.code}`);
  g.input("cd ..");
  t = 5000;
  const saved = JSON.parse(JSON.stringify(g.save()));
  const h = new Game(saved, { tty: false, now: () => 10_000 });
  assert.equal(h.save().room, 2);
  assert.equal(h.state.cwd, "/home/you");
  assert.equal(h.time(), 5000);
  assert.deepEqual(h.save().history, g.save().history);
});

test("tab completion offers commands and paths", () => {
  const g = new Game({ seed: 1 }, { tty: false });
  assert.deepEqual(g.complete("un").sort(), ["uniq", "unlock"]);
  assert.deepEqual(g.complete("cat no"), ["note.txt"]);
  g.input(`unlock ${g.room.code}`);
  assert.deepEqual(g.complete("cat .d"), [".door"]);
  assert.deepEqual(g.complete("ls /ho"), ["/home/"]);
});

test("colour codes only appear when asked for", () => {
  assert.ok(!new Game({ seed: 1 }, { tty: false }).welcome().includes("\x1b["));
  const c = new Game({ seed: 1 }).welcome();
  assert.ok(c.includes("\x1b["));
  assert.equal(strip("\x1b[1mhi\x1b[0m"), "hi");
});
