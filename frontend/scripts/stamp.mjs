// After a build: write the SHA-256 of everything the build is made from next to the built files, so a test can tell when the committed bundle no longer matches the source (someone edited
// src/ and forgot to rebuild). tests/test_frontend_foundation.py computes the same hash in Python; the two must agree, so the rule is simple and written once here:
//   files: index.html, package.json, package-lock.json, vite.config.ts, tsconfig.json and every file under src/ EXCEPT tests (*.test.ts, *.test.tsx) and src/test/
//   order: by path (posix, byte order); each file contributes  path + "\0" + content with CRLF turned into LF + "\0"
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "..", "app", "static", "app", "source.sha256");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const posix = (p) => relative(root, p).split(sep).join("/");
const files = [
  ...["index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json"].map((f) => join(root, f)),
  ...walk(join(root, "src")).filter((p) => !/\.test\.tsx?$/.test(p) && !posix(p).startsWith("src/test/")),
]
  .map((p) => ({ p, rel: posix(p) }))
  .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

const h = createHash("sha256");
for (const { p, rel } of files) {
  h.update(Buffer.from(rel + "\0", "utf8"));
  h.update(Buffer.from(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8"));
  h.update(Buffer.from("\0", "utf8"));
}
writeFileSync(out, h.digest("hex") + "\n");
console.log(`source stamp written for ${files.length} files`);
