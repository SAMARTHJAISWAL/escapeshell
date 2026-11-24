// The ten rooms. Each is built from a seed, so every player gets different
// codes and nobody can just copy someone else's answers.
//
// A room is { title, skill, story, files, cwd, code, hints, solve }.
// `solve` lists the commands that reveal the code; the tests run them.

import { HOME } from "./fs.js";

/** A small seeded random number generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const shuffle = (arr) => {
    const a2 = [...arr];
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return { next, int, pick, shuffle };
}

const WORDS = ["ORBIT", "NEBULA", "COMET", "QUASAR", "PULSAR", "ZENITH", "ECLIPSE", "VORTEX", "AURORA", "METEOR", "NOVA", "SOLSTICE", "HALCYON", "CORONA", "PARSEC", "EQUINOX", "LYNX", "ORION", "VEGA", "ALTAIR", "CYGNUS", "DRACO", "LUMEN", "TALON"];
const FIRST = ["Aiko", "Bruno", "Chiara", "Dmitri", "Elif", "Farah", "Gustavo", "Hana", "Ines", "Jonas", "Kwame", "Leila", "Mateo", "Nadia", "Olu", "Priya", "Quentin", "Rosa", "Sven", "Tariq", "Uma", "Viktor", "Wen", "Ximena", "Yusuf", "Zara", "Amara", "Bao", "Camila", "Dario", "Esme", "Femi", "Greta", "Hugo", "Isla", "Javier", "Kaito", "Lucia", "Milan", "Noor"];
const LAST = ["Abe", "Baptiste", "Costa", "Dubois", "Eze", "Fischer", "Garcia", "Haddad", "Ito", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrov", "Quispe", "Rossi", "Silva", "Tanaka", "Uysal", "Varga", "Wong", "Yilmaz", "Zielinski"];

const codeWord = (r, used) => {
  let w;
  do w = `${r.pick(WORDS)}-${r.int(10, 99)}`;
  while (used.has(w.split("-")[0]));
  used.add(w.split("-")[0]);
  return w;
};

const home = (files) => ({ home: { you: files } });
const L = (...rows) => `${rows.join("\n")}\n`;

function stamp(r, i) {
  const h = String(Math.floor(i / 120) % 24).padStart(2, "0");
  const m = String(Math.floor(i / 2) % 60).padStart(2, "0");
  const s = String(r.int(0, 59)).padStart(2, "0");
  return `2034-03-13T${h}:${m}:${s}Z`;
}

// ---------------------------------------------------------------------------

function wakeUp(r, used) {
  const code = codeWord(r, used);
  return {
    title: "Wake up",
    skill: "ls and cat",
    story: [
      "You wake up in the dark. A single terminal glows in front of you.",
      "This is AURORA-7, an observatory computer that was shut down years ago.",
      "Somehow, you're inside it. Ten locked doors stand between you and the way out.",
    ],
    cwd: HOME,
    files: home({
      "README.txt": L(
        "If you're reading this, the system woke you up. I'm sorry.",
        "",
        "Every room has a door, and every door has a code.",
        "Find the code, then type:  unlock THE-CODE",
        "",
        "Stuck? Type hint. Lost? Type help.",
        "",
        "- Margo, systems engineer, AURORA-7",
      ),
      "note.txt": L("Margo's first lesson: always read what's lying around.", "", `The code for this door is ${code}`),
    }),
    code,
    hints: ["Type ls to list the files in this room.", "Type cat README.txt to read a file. There's another file too.", "cat note.txt"],
    solve: ["cat note.txt"],
  };
}

function hidden(r, used) {
  const code = codeWord(r, used);
  return {
    title: "Nothing here",
    skill: "hidden files (ls -a)",
    story: ["The second room looks empty. Margo never left a room empty."],
    cwd: HOME,
    files: home({
      "empty.txt": L("Nothing to see here."),
      ".door": L("You found it. Files whose names start with a dot are hidden from a plain ls.", "", `Code: ${code}`),
      ".margo": L("Hidden files are where people keep their settings. And their secrets."),
    }),
    code,
    hints: ["Some files don't show up in a plain ls.", "Files whose names start with a dot are hidden. ls -a shows them.", "cat .door"],
    solve: ["cat .door"],
  };
}

function maze(r, used) {
  const code = codeWord(r, used);
  const names = r.shuffle(["telescope", "archive", "cooling", "relay", "sensors", "spare", "mirror", "dome", "backup", "logs", "optics", "power", "comms", "storage", "calib", "array"]);
  const root = {};
  const dirs = [];
  const build = (node, depth, path) => {
    const n = depth === 0 ? 4 : r.int(1, 3);
    for (let i = 0; i < n && names.length; i++) {
      const name = names.pop();
      node[name] = {};
      dirs.push([node[name], `${path}/${name}`, depth]);
      if (depth < 3) build(node[name], depth + 1, `${path}/${name}`);
    }
  };
  build(root, 0, ".");
  for (const [node] of dirs) {
    if (r.next() < 0.5) node[r.pick(["notes.txt", "readme", "old-key", "keys.bak", "todo"])] = L(r.pick(["Not here.", "Wrong place. Keep looking.", "This is a decoy key. Margo loved decoys.", "Nope."]));
  }
  const deepest = dirs.filter(([, , d]) => d === Math.max(...dirs.map((x) => x[2])));
  const [target] = r.pick(deepest);
  target.key = L(`The real key. Code: ${code}`);
  return {
    title: "The maze",
    skill: "find",
    story: ["Margo hid the next key somewhere in the maintenance tunnels: a file named exactly key."],
    cwd: `${HOME}/tunnels`,
    files: home({ tunnels: root }),
    code,
    hints: [
      "You could cd and ls through every tunnel. Or let the computer search for you.",
      "find searches for files by name: find . -name key",
      "Run find . -name key, then cat the path it prints.",
    ],
    solve: ["find . -name key", "cat {prev}"],
  };
}

const LOG_MESSAGES = [
  "[dome] motor temperature nominal",
  "[optics] mirror alignment check passed",
  "[power] battery at 84%",
  "[comms] uplink retry scheduled",
  "[sensors] humidity 41%",
  "[archive] nightly backup started",
  "[archive] nightly backup finished",
  "[cooling] fan speed adjusted",
  "[relay] heartbeat ok",
  "[array] dish 3 parked",
  "[calib] dark frame captured",
  "[auth] session opened for margo",
  "[auth] session closed for margo",
];

function logs(r, used) {
  const code = codeWord(r, used);
  const n = 3000;
  const at = r.int(900, 2400);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const level = r.next() < 0.08 ? "WARN " : "INFO ";
    rows.push(i === at ? `${stamp(r, i)} WARN  [vault] temporary password set to ${code}` : `${stamp(r, i)} ${level} ${r.pick(LOG_MESSAGES)}`);
  }
  return {
    title: "The server log",
    skill: "grep",
    story: ["Margo's note on the door: \"I reset the vault password before I left. It's in the server log.\"", "The log has 3,000 lines. You don't have time to read them all."],
    cwd: HOME,
    files: home({ "server.log": L(...rows), "door.txt": L("The vault password is somewhere in server.log.") }),
    code,
    hints: ["grep prints only the lines that contain a word: grep WORD file", "What word would be on the line you want? Maybe password.", "grep password server.log"],
    solve: ["grep password server.log"],
  };
}

const PATHS = ["/", "/status", "/dome/open", "/telemetry", "/login", "/images/latest.png", "/api/v2/stars"];

function knocks(r) {
  for (;;) {
    const room = knocksOnce(r);
    // grep reads the dots as "any character", so check that grep's count is still the answer
    const re = new RegExp(room.target);
    if (room.files.home.you["access.log"].split("\n").filter((l) => re.test(l)).length === Number(room.code)) {
      delete room.target;
      return room;
    }
  }
}

function knocksOnce(r) {
  const target = `10.${r.int(1, 9)}.${r.int(1, 9)}.${r.int(10, 99)}`;
  const want = r.int(23, 61);
  const others = [];
  while (others.length < 40) {
    const ip = `10.${r.int(10, 99)}.${r.int(10, 99)}.${r.int(100, 250)}`;
    if (!ip.startsWith(target) && !others.includes(ip)) others.push(ip);
  }
  const rows = [];
  const total = 1800;
  const slots = new Set(r.shuffle([...Array(total).keys()]).slice(0, want));
  for (let i = 0; i < total; i++) {
    const ip = slots.has(i) ? target : r.pick(others);
    rows.push(`${ip} - - [13/Mar/2034:${String(Math.floor(i / 75)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00] "GET ${r.pick(PATHS)}" ${r.pick([200, 200, 200, 304, 404])}`);
  }
  const code = String(want);
  return {
    target,
    title: "The knocking",
    skill: "pipes: grep | wc -l",
    story: ["Something kept knocking on the airlock last night.", `The note says: "The airlock code is the number of times ${target} knocked."`],
    cwd: HOME,
    files: home({ "access.log": L(...rows), "airlock.txt": L(`The airlock code is the number of times ${target} knocked.`, "Every line in access.log is one knock.") }),
    code,
    hints: [`First find the lines from ${target}. Then count them.`, "A pipe | sends one command's output into the next. wc -l counts lines.", `grep ${target} access.log | wc -l`],
    solve: [`grep ${target} access.log | wc -l`],
  };
}

function crowd(r) {
  const people = r.shuffle(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`))).slice(0, 40);
  const winner = people[0];
  const rows = [];
  rows.push(...Array(r.int(44, 52)).fill(winner));
  for (const p of people.slice(1)) rows.push(...Array(r.int(8, 38)).fill(p));
  const code = winner.split(" ")[1].toUpperCase();
  return {
    title: "The guest book",
    skill: "sort | uniq -c | sort -rn",
    story: ["The door here only opens for the station's most frequent visitor.", "The note says: \"The code is their surname.\""],
    cwd: HOME,
    files: home({ "guestbook.txt": L(...r.shuffle(rows)), "door.txt": L("The code is the surname of whoever signed guestbook.txt most often.") }),
    code,
    hints: [
      "You need to count how many times each name appears.",
      "uniq -c counts repeated lines, but only when they're next to each other. So sort first.",
      "sort guestbook.txt | uniq -c | sort -rn | head -3",
    ],
    solve: ["sort guestbook.txt | uniq -c | sort -rn | head -1"],
  };
}

function ledger(r) {
  const roles = ["astronomer", "technician", "cook", "medic", "pilot", "engineer"];
  const shifts = ["day", "evening", "night"];
  const lockers = r.shuffle([...Array(900).keys()].map((k) => k + 100));
  const people = r.shuffle(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`)));
  const rows = ["id,name,role,shift,locker"];
  let answer = null;
  for (let i = 0; i < 260; i++) {
    let role = r.pick(roles);
    let shift = r.pick(shifts);
    if (role === "engineer" && shift === "night") shift = r.pick(["day", "evening"]);
    if (i === 137) {
      role = "engineer";
      shift = "night";
      answer = lockers[i];
    }
    rows.push(`${1000 + i},${people[i]},${role},${shift},${lockers[i]}`);
  }
  const code = String(answer);
  return {
    title: "The crew list",
    skill: "grep and cut on a CSV",
    story: ["A locker in the crew quarters holds the next key.", "The note says: \"It's the locker of the only engineer on the night shift.\""],
    cwd: HOME,
    files: home({ "crew.csv": L(...rows), "door.txt": L("The code is the locker number of the only engineer who works the night shift. See crew.csv.") }),
    code,
    hints: [
      "Look at the first line of crew.csv to see its columns: head -3 crew.csv",
      "You can chain greps: grep engineer crew.csv | grep night",
      "cut -d , -f 5 prints the fifth comma-separated column. grep engineer crew.csv | grep night | cut -d , -f 5",
    ],
    solve: ["grep engineer crew.csv | grep night | cut -d , -f 5"],
  };
}

const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).match(/.{1,60}/g).join("\n");
};

function signal(r, used) {
  const code = codeWord(r, used);
  const message = L("AURORA-7 TO ANYONE LISTENING.", "If you can read this, you decoded base64. Well done.", `The radio room code is ${code}.`, "Two more doors after this one.");
  return {
    title: "The radio room",
    skill: "base64 -d",
    story: ["The radio caught one last transmission before the station went dark.", "It looks like gibberish. It isn't."],
    cwd: HOME,
    files: home({ "transmission.txt": `${b64(message)}\n`, "door.txt": L("The code is inside the transmission.") }),
    code,
    hints: ["Letters, digits, + and /, sometimes ending in =. That's base64.", "base64 -d decodes it.", "base64 -d transmission.txt"],
    solve: ["base64 -d transmission.txt"],
  };
}

const rev = (s) => [...s].reverse().join("");

function mirror(r, used) {
  const code = codeWord(r, used);
  const lines = ["Margo wrote this one backwards so a plain grep wouldn't find it.", "Almost out now. One door left after this.", `The mirror code is ${code}.`];
  return {
    title: "The mirror",
    skill: "rev",
    story: ["Everything in this room is written backwards, as if seen in a mirror."],
    cwd: HOME,
    files: home({ "mirror.txt": L(...lines.map(rev)), "door.txt": L(rev("The code is in mirror.txt. Read it the right way round.")) }),
    code,
    hints: ["Try reading the files. Do they look backwards?", "rev reverses every line.", "rev mirror.txt"],
    solve: ["rev mirror.txt"],
  };
}

function scattered(r, used) {
  const parts = [r.pick(WORDS.filter((w) => !used.has(w))), String(r.int(10, 99)), r.pick(["X", "K", "Q", "Z", "V"]) + r.int(1, 9)];
  const code = parts.join("-");
  const fragment = (k) => L("Margo's last trick.", `fragment ${k + 1} of 3: ${parts[k]}`);
  const root = {
    etc: { "hostname": L("aurora-7"), margo: { "motd": L("Welcome to AURORA-7. Stay curious."), ".fragment": fragment(0) }, "fstab": L("/dev/sda1 / ext4 ro 0 1") },
    var: { spool: { mail: { margo: L("Subject: defragmented the archive disk", "Nothing to see here.") }, cron: { "nightly": fragment(1) } }, log: { "boot.log": L("boot ok", "mounting read-only") } },
    home: { you: { ".cache": { "thumb.db": fragment(2) }, "door.txt": L("The last code is split into three fragments, hidden all over the system.", "Join them with dashes, in order: FIRST-SECOND-THIRD.") } },
    opt: { telescope: { bin: { "track.sh": L("echo tracking") } } },
  };
  return {
    title: "The way out",
    skill: "grep -r across the whole system",
    story: ["The final door. Margo split its code into three fragments and hid them all over the system."],
    cwd: HOME,
    files: root,
    code,
    hints: ["Each fragment says the word fragment. grep can search every file under a directory with -r.", "Search the whole system, starting from the very top: /", "grep -r fragment /"],
    solve: ["grep -r 'fragment [0-9]' /"],
  };
}

export const ROOM_COUNT = 10;

/** Build all ten rooms for a seed. */
export function buildRooms(seed) {
  const r = rng(seed);
  const used = new Set();
  return [wakeUp(r, used), hidden(r, used), maze(r, used), logs(r, used), knocks(r), crowd(r), ledger(r), signal(r, used), mirror(r, used), scattered(r, used)];
}
