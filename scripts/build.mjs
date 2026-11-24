// Assemble the static site in _site/: the page and the same game modules the
// command line uses.
import { cp, mkdir, rm } from "node:fs/promises";

const out = new URL("../_site/", import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of ["index.html", "style.css", "app.js", "favicon.svg", "og.png", "vercel.json"]) {
  await cp(new URL(`../web/${f}`, import.meta.url), new URL(f, out)).catch((e) => {
    if (f !== "og.png") throw e;
  });
}
for (const f of ["color.js", "fs.js", "shell.js", "rooms.js", "game.js"]) await cp(new URL(`../src/${f}`, import.meta.url), new URL(f, out));
console.log("built _site/");
