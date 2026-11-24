import { test } from "node:test";
import assert from "node:assert/strict";
import { FS, globToRegex, normalize } from "../src/fs.js";
import { flags, parse, run, tokenize } from "../src/shell.js";

const L = (...rows) => `${rows.join("\n")}\n`;
const tree = {
  home: {
    you: {
      "a.txt": L("apple", "Banana", "cherry", "apple"),
      "nums.txt": L("10", "9", "100", "9"),
      ".secret": L("hidden"),
      "data.csv": L("id,name,team", "1,Ana,red", "2,Bo,blue", "3,Cy,red"),
      "my file.txt": L("spaced out"),
      deep: { er: { "key": L("found me") }, "notes.md": L("apple pie") },
    },
  },
  etc: { motd: L("hello") },
};

function sh() {
  const fs = new FS(tree);
  const state = { cwd: "/home/you", prev: null, history: [] };
  return (line) => run(line, fs, state, { tty: false }).out;
}

test("paths normalise like a shell's", () => {
  assert.equal(normalize("/a/./b/../c//"), "/a/c");
  assert.equal(normalize("/.."), "/");
  const fs = new FS(tree);
  assert.equal(fs.resolve("/home/you", "~/deep/.."), "/home/you");
  assert.equal(fs.resolve("/etc", "../home"), "/home");
});

test("quotes, escapes and operators tokenize correctly", () => {
  assert.deepEqual(tokenize(`grep "two words" 'it''s' a\\ b|wc`).map((t) => t.word ?? t.op), ["grep", "two words", "its", "a b", "|", "wc"]);
  assert.throws(() => tokenize(`echo "open`), /unclosed double quote/);
  assert.throws(() => parse("ls > out.txt"), /read-only/);
  assert.throws(() => parse("| wc"), /command is missing/);
  assert.deepEqual(parse("a && b || c ; d").map((x) => x.op), [null, "&&", "||", ";"]);
});

test("flags parse in their usual shapes", () => {
  assert.deepEqual(flags(["-rn", "x"], "rn", "t"), { f: { r: true, n: true }, rest: ["x"] });
  assert.deepEqual(flags(["-n5", "f"], "n:", "head").f, { n: "5" });
  assert.deepEqual(flags(["-5"], "n:", "head").f, { n: "5" });
  assert.deepEqual(flags(["-d", ",", "-f2"], "d:f:", "cut").f, { d: ",", f: "2" });
  assert.throws(() => flags(["-z"], "n", "ls"), /unknown option -z/);
});

test("wildcards match like a shell's", () => {
  assert.ok(globToRegex("*.txt").test("a.txt"));
  assert.ok(!globToRegex("*.txt").test("a/b.txt"));
  assert.ok(globToRegex("[ab]?.md").test("b1.md"));
  const $ = sh();
  assert.equal($("echo *.txt"), "a.txt my file.txt nums.txt\n");
  assert.equal($("echo '*.txt'"), "*.txt\n");
  assert.equal($("echo *.zip"), "*.zip\n");
  assert.equal($("ls deep/*"), "deep/notes.md\n\ndeep/er:\nkey\n");
});

test("ls, cd, pwd and cat", () => {
  const $ = sh();
  assert.equal($("ls"), "a.txt\ndata.csv\ndeep\nmy file.txt\nnums.txt\n");
  assert.match($("ls -a"), /^\.\n\.\.\n/);
  assert.match($("ls -a"), /\.secret/);
  assert.equal($("cat 'my file.txt'"), "spaced out\n");
  assert.equal($("cat my\\ file.txt"), "spaced out\n");
  assert.equal($("cd deep/er && pwd && cat key"), "/home/you/deep/er\nfound me\n");
  assert.equal($("cd - ; pwd"), "/home/you\n/home/you\n");
  assert.equal($("cd /etc; cat motd; cd"), "hello\n");
  assert.equal($("pwd"), "/home/you\n");
  assert.match($("cat deep"), /Is a directory/);
  assert.match($("cd a.txt"), /Not a directory/);
  assert.match($("cat nope || echo fallback"), /No such file[\s\S]*fallback/);
});

test("grep, with its common options", () => {
  const $ = sh();
  assert.equal($("grep apple a.txt"), "apple\napple\n");
  assert.equal($("grep -i banana a.txt"), "Banana\n");
  assert.equal($("grep -c apple a.txt"), "2\n");
  assert.equal($("grep -v apple a.txt"), "Banana\ncherry\n");
  assert.equal($("grep -n cherry a.txt"), "3:cherry\n");
  assert.equal($("grep -r apple deep"), "deep/notes.md:apple pie\n");
  assert.equal($("grep -rl apple ."), "./a.txt\n./deep/notes.md\n");
  assert.equal($("grep -o 'p+' a.txt").split("\n")[0], "pp");
  assert.equal($("grep -io an a.txt"), "an\nan\n", "every match on a line, not just the ones after the first");
  assert.equal($("grep -r 'found' /"), "/home/you/deep/er/key:found me\n");
  assert.match($("grep apple deep"), /Is a directory \(add -r/);
  assert.equal($("grep '(' a.txt"), "", "a bad regex is searched for literally");
});

test("find, by name and type", () => {
  const $ = sh();
  assert.equal($("find . -name key"), "./deep/er/key\n");
  assert.equal($("find deep -type d"), "deep\ndeep/er\n");
  assert.equal($("find / -name '*.md'"), "/home/you/deep/notes.md\n");
  assert.equal($("find . -maxdepth 1 -name '.*'"), "./.secret\n");
  assert.match($("find . -size 3"), /unknown option -size/);
});

test("pipes through sort, uniq, wc, head, tail and cut", () => {
  const $ = sh();
  assert.equal($("sort a.txt | uniq -c | sort -rn | head -1"), "      2 apple\n");
  assert.equal($("sort -n nums.txt | tail -n 1"), "100\n");
  assert.equal($("sort -u nums.txt"), "10\n100\n9\n");
  assert.equal($("cat a.txt | wc -l"), "4\n");
  assert.equal($("wc -l a.txt"), "4 a.txt\n");
  assert.equal($("wc -l < a.txt"), "4\n");
  assert.equal($("grep red data.csv | cut -d , -f 2"), "Ana\nCy\n");
  assert.equal($("cut -d, -f1,3 data.csv | head -2"), "id,team\n1,red\n");
  assert.equal($("cut -c 1-3 a.txt | head -n2"), "app\nBan\n");
  assert.equal($("sort -t , -k 3 data.csv | head -1"), "2,Bo,blue\n");
});

test("base64 round-trips, rev reverses", () => {
  const $ = sh();
  assert.equal($("echo héllo | base64"), "aMOpbGxvCg==\n");
  assert.equal($("echo aMOpbGxvCg== | base64 -d"), "héllo\n");
  assert.match($("echo '!!!' | base64 -d"), /invalid input/);
  assert.equal($("echo abc | rev"), "cba\n");
});

test("unknown and refused commands explain themselves", () => {
  const $ = sh();
  assert.match($("frobnicate"), /command not found/);
  assert.match($("sudo cat /etc/motd"), /never gave you root/);
  assert.match($("rm a.txt"), /read-only/);
  assert.match($("man grep"), /^grep \[-i\]/);
  assert.match($("help"), /Pipes work/);
  assert.equal($("echo -n hi"), "hi");
});
