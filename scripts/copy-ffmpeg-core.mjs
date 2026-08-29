// Copies the ffmpeg.wasm core builds from node_modules into public/ffmpeg so
// the app serves them same-origin — no runtime CDN dependency. Runs via the
// predev/prebuild hooks in package.json; /public/ffmpeg/ is gitignored.
//
//   @ffmpeg/core-mt (multithreaded, needs SharedArrayBuffer) -> public/ffmpeg/mt/
//   @ffmpeg/core    (single-threaded fallback)               -> public/ffmpeg/st/

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const jobs = [
  {
    pkg: "@ffmpeg/core-mt",
    srcDir: join(root, "node_modules", "@ffmpeg", "core-mt", "dist", "umd"),
    destDir: join(root, "public", "ffmpeg", "mt"),
    files: ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"],
  },
  {
    pkg: "@ffmpeg/core",
    srcDir: join(root, "node_modules", "@ffmpeg", "core", "dist", "umd"),
    destDir: join(root, "public", "ffmpeg", "st"),
    files: ["ffmpeg-core.js", "ffmpeg-core.wasm"],
  },
];

let copied = 0;
let upToDate = 0;

for (const { pkg, srcDir, destDir, files } of jobs) {
  for (const file of files) {
    const src = join(srcDir, file);
    if (!existsSync(src)) {
      console.error(
        `copy-ffmpeg-core: missing ${src}\n` +
          `  Expected it from the ${pkg} package. Run \`pnpm install\` (it is a devDependency) and retry.`,
      );
      process.exit(1);
    }
    const dest = join(destDir, file);
    // Fast no-op on every dev/build: skip when the destination already exists
    // with an identical size.
    if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
      upToDate += 1;
      continue;
    }
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    copied += 1;
  }
}

console.log(
  `copy-ffmpeg-core: ffmpeg cores ready in public/ffmpeg (${copied} copied, ${upToDate} already up to date).`,
);
