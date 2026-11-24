// escapeshell in the browser: the same game, drawn in a page.
import { Game, shareText } from "./game.js";

const $ = (id) => document.getElementById(id);
const STORE = "escapeshell:v1";
const screen = $("screen");
const input = $("cmd");

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Turn the game's ANSI colours into spans. */
function ansi(text) {
  let open = 0;
  const html = esc(text).replace(/\x1b\[(\d+)m/g, (_, code) => {
    if (code === "0") {
      const close = "</span>".repeat(open);
      open = 0;
      return close;
    }
    open++;
    return `<span class="a${code}">`;
  });
  return html + "</span>".repeat(open);
}

function scrollDown() {
  requestAnimationFrame(() => ($("term").scrollTop = $("term").scrollHeight));
}

function print(text, cls = "") {
  if (!text) return;
  const pre = document.createElement("pre");
  if (cls) pre.className = cls;
  pre.innerHTML = ansi(text.replace(/\n$/, ""));
  screen.appendChild(pre);
  scrollDown();
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE));
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(game.save()));
  } catch {
    // private mode: the game still works, it just won't resume
  }
}

let game;
let historyAt = 0;

function start(saved) {
  game = new Game(saved || {});
  screen.innerHTML = "";
  $("share").hidden = true;
  $("line").hidden = false;
  if (saved && !saved.done && (saved.room || saved.commands)) {
    print(game.welcome().replace(/\n+$/, "\n"));
    print(`Welcome back. You're in room ${game.save().room + 1}, and the clock is still running.\n`, "dim");
  } else if (saved?.done) {
    print(game.ending());
    finished();
  } else {
    print(game.welcome());
    print("Type ls and press Enter to look around.\n", "dim");
  }
  historyAt = game.save().history.length;
  refreshPrompt();
  save();
}

function refreshPrompt() {
  $("prompt").innerHTML = ansi(game.prompt());
}

function finished() {
  $("line").hidden = true;
  $("share").hidden = false;
  const text = shareText(game.save(), `${location.origin}${location.pathname}`);
  $("post").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  if (game.save().practice) $("copy").hidden = true;
}

$("line").addEventListener("submit", (e) => {
  e.preventDefault();
  const line = input.value;
  input.value = "";
  print(`${game.prompt()}${line}`, "echo");
  const r = game.input(line);
  if (r.clear) screen.innerHTML = "";
  print(r.out);
  historyAt = game.save().history.length;
  refreshPrompt();
  save();
  if (r.finished) finished();
  scrollDown();
  if (r.exit) print("There's no closing this window from inside. The only way out is through the doors.\n", "dim");
});

function complete() {
  const v = input.value;
  const hits = game.complete(v);
  if (hits.length === 1) {
    const words = v.split(/(\s+)/);
    words[words.length - 1] = hits[0];
    input.value = words.join("") + (hits[0].endsWith("/") ? "" : " ");
  } else if (hits.length > 1) {
    let common = hits[0];
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
    const words = v.split(/(\s+)/);
    const last = words[words.length - 1];
    if (common.length > last.length) {
      words[words.length - 1] = common;
      input.value = words.join("");
    } else {
      print(`${game.prompt()}${v}\n${hits.join("  ")}\n`, "echo");
    }
  }
}

function recall(step) {
  const h = game.save().history;
  historyAt = Math.max(0, Math.min(h.length, historyAt + step));
  input.value = h[historyAt] ?? "";
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    complete();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    recall(-1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    recall(1);
  } else if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    screen.innerHTML = "";
  }
});

for (const b of $("keys").querySelectorAll("button")) {
  b.addEventListener("pointerdown", (e) => e.preventDefault());
  b.addEventListener("click", () => {
    const k = b.dataset.k;
    if (k === "tab") complete();
    else if (k === "up") recall(-1);
    else if (k === "hint") {
      input.value = "hint";
      $("line").requestSubmit();
    } else input.value += k === "|" ? " | " : k;
    input.focus();
  });
}

$("term").addEventListener("click", () => {
  if (!getSelection().toString() && !$("line").hidden) input.focus();
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareText(game.save(), `${location.origin}${location.pathname}`));
    $("copy").textContent = "Copied";
  } catch {
    $("copy").textContent = "Couldn't copy";
  }
});

const fresh = () => {
  if (!game.done && game.save().commands > 0 && !confirmNew()) return;
  start(null);
  input.focus();
};
let armed = false;
function confirmNew() {
  // no browser dialogs: a second press within 3 seconds confirms
  if (armed) return true;
  armed = true;
  $("new").textContent = "Sure? Tap again";
  setTimeout(() => {
    armed = false;
    $("new").textContent = "New game";
  }, 3000);
  return false;
}
$("new").addEventListener("click", fresh);
$("again").addEventListener("click", () => {
  start(null);
  input.focus();
});

start(load());
input.focus();
