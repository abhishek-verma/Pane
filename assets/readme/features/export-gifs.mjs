#!/usr/bin/env node
/**
 * Export animated feature SVGs to optimized GIFs for GitHub README + onboarding.
 *
 * Prerequisites: playwright (local), ffmpeg
 * Usage: node assets/readme/features/export-gifs.mjs
 *
 * Pipeline: regenerate SVGs with `_generate.mjs`, then run this script.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDTH = 800;
const HEIGHT = 450;
const FPS = 12;
const DURATION_MS = 7000;
const DURATION_OVERRIDES = { "02-personalised-internet": 9000 };
const MAX_BYTES = 1.5 * 1024 * 1024;

const outGifDir = join(__dirname, "gif");
const appAssetsDir = join(
  __dirname,
  "../../../packages/browseros-agent/apps/app/assets/features",
);
const tmpRoot = join(__dirname, ".gif-tmp");

const svgs = readdirSync(__dirname)
  .filter((f) => /^\d{2}-.+\.svg$/.test(f))
  .sort();

if (svgs.length === 0) {
  console.error("No feature SVGs found. Run _generate.mjs first.");
  process.exit(1);
}

function which(cmd) {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const ffmpeg = which("ffmpeg");
if (!ffmpeg) {
  console.error("ffmpeg is required. Install with: brew install ffmpeg");
  process.exit(1);
}

mkdirSync(outGifDir, { recursive: true });
mkdirSync(appAssetsDir, { recursive: true });
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });

function pageHtml(svgMarkup) {
  // Strip XML declaration; keep SVG inline so CSS animations run.
  const inline = svgMarkup
    .replace(/<\?xml[^>]*>\s*/i, "")
    .replace(
      /<svg\b([^>]*)>/i,
      `<svg$1 width="${WIDTH}" height="${HEIGHT}" style="display:block;width:${WIDTH}px;height:${HEIGHT}px">`,
    );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#FFFFFF;overflow:hidden;width:${WIDTH}px;height:${HEIGHT}px}
  </style></head><body>${inline}</body></html>`;
}

async function captureSvg(browser, svgName) {
  const slug = svgName.replace(/\.svg$/, "");
  const duration = DURATION_OVERRIDES[slug] || DURATION_MS;
  const frameDir = join(tmpRoot, slug);
  mkdirSync(frameDir, { recursive: true });

  const svgMarkup = readFileSync(join(__dirname, svgName), "utf8");
  const htmlPath = join(frameDir, "index.html");
  writeFileSync(htmlPath, pageHtml(svgMarkup), "utf8");

  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  // Restart animations by forcing a reflow after load
  await page.evaluate(() => {
    document.body.getBoundingClientRect();
  });
  await new Promise((r) => setTimeout(r, 200));

  const frameCount = Math.round((duration / 1000) * FPS);
  const interval = 1000 / FPS;

  for (let i = 0; i < frameCount; i++) {
    const path = join(frameDir, `frame-${String(i).padStart(4, "0")}.png`);
    await page.screenshot({ path, type: "png", animations: "allow" });
    if (i < frameCount - 1) {
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  await page.close();
  return frameDir;
}

function encodeGif(frameDir, outPath) {
  const pattern = join(frameDir, "frame-%04d.png");
  const palette = join(frameDir, "palette.png");

  let r = spawnSync(
    ffmpeg,
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      pattern,
      "-vf",
      "palettegen=max_colors=192:stats_mode=diff",
      palette,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error(`palettegen failed for ${outPath}`);
  }

  r = spawnSync(
    ffmpeg,
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      pattern,
      "-i",
      palette,
      "-lavfi",
      "paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
      "-loop",
      "0",
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error(`paletteuse failed for ${outPath}`);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    for (const svg of svgs) {
      const slug = svg.replace(/\.svg$/, "");
      console.log(`capturing ${svg}…`);
      const frameDir = await captureSvg(browser, svg);

      // Sanity: first frame should be reasonably large
      const first = join(frameDir, "frame-0000.png");
      const firstSize = statSync(first).size;
      if (firstSize < 20_000) {
        console.warn(
          `WARN ${slug} first frame only ${firstSize} bytes — may be blank`,
        );
      }

      const outPath = join(outGifDir, `${slug}.gif`);
      console.log(`encoding ${slug}.gif…`);
      encodeGif(frameDir, outPath);

      const size = statSync(outPath).size;
      const mb = (size / (1024 * 1024)).toFixed(2);
      if (size > MAX_BYTES) {
        console.warn(
          `WARN ${slug}.gif is ${mb}MB (>1.5MB). Consider lowering FPS/colors.`,
        );
      } else {
        console.log(`  → ${mb}MB`);
      }

      copyFileSync(outPath, join(appAssetsDir, `${slug}.gif`));
    }
  } finally {
    await browser.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log("done");
  console.log(`README GIFs: ${outGifDir}`);
  console.log(`App assets:  ${appAssetsDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
