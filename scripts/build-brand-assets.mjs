// Renders every raster the Patcher mark appears in from assets/patcher-icon.svg
// and assets/patcher-logo.svg, so the artwork can be revised in one place.
//
// Not wired into CI and deliberately without a --check gate: these outputs are
// committed binaries that change only when the mark does. Run it by hand after
// editing either source SVG:
//
//   node scripts/build-brand-assets.mjs
//   bun run --filter @patcher/app generate:pwa-icons   # tinted variants after
//
// The second command is not optional. apps/app/public holds five hand-authored
// bases and forty generated tints derived from them, behind a --check gate that
// fails the app's tests when they drift.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// sharp belongs to @patcher/app, which is where the other icon generator lives.
// Resolving it from there rather than adding a root dependency keeps this
// script out of the lockfile — see bb-migration.md invariant 4 on why a
// dependency change is never incidental here.
const sharp = createRequire(join(repoRoot, "apps", "app", "package.json"))(
  "sharp",
);
const assetsDir = join(repoRoot, "assets");
const desktopAssetsDir = join(repoRoot, "apps", "desktop", "assets");
const appPublicDir = join(repoRoot, "apps", "app", "public");

// The mark, as geometry rather than a file read, so a channel can restate the
// plate colour without a second source SVG. Kept identical to
// assets/patcher-icon.svg — change both together.
const PLATE_CREAM = "#F5F1E8";
const INK = "#111111";
const PATCH = "#EF2B1F";
const P_PATH =
  "M13 11h24c10 0 17 6.6 17 16s-7 16-17 16H25v10H13V11Zm12 11v10h11.5c3.4 0 5.5-1.9 5.5-5s-2.1-5-5.5-5H25Z";
const PATCH_RECT = { x: 44.5, y: 43.5, size: 11 };
// Glyph bounding box inside the 64-unit grid, used to render the mark on its
// own with predictable padding.
const GLYPH_BOX = { x: 13, y: 11, width: 42.5, height: 43.5 };

/** The plate mark: rounded square, ink P, red patch. */
function iconSvg({ plate = PLATE_CREAM, radius = 14 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${radius}" fill="${plate}"/>
  <path fill="${INK}" fill-rule="evenodd" d="${P_PATH}"/>
  <rect x="${PATCH_RECT.x}" y="${PATCH_RECT.y}" width="${PATCH_RECT.size}" height="${PATCH_RECT.size}" fill="${PATCH}"/>
</svg>`;
}

/** The glyph alone, cropped to its own bounds. One fill unless a patch colour is given. */
function glyphSvg(fill, patchFill = fill) {
  const { x, y, width, height } = GLYPH_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}">
  <path fill="${fill}" fill-rule="evenodd" d="${P_PATH}"/>
  <rect x="${PATCH_RECT.x}" y="${PATCH_RECT.y}" width="${PATCH_RECT.size}" height="${PATCH_RECT.size}" fill="${patchFill}"/>
</svg>`;
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function render(svg, size) {
  // density high enough that the rasterizer works well above the target size;
  // sharp resamples down, so curves stay clean at 16px.
  return sharp(Buffer.from(svg), { density: 2400 })
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** The full-colour mark inset on a flat plate that fills the canvas. */
async function insetMark({ size, plate, coverage, opaque }) {
  const markSize = Math.round(size * coverage);
  const mark = await render(glyphSvg(INK, PATCH), markSize);
  const offset = Math.round((size - markSize) / 2);
  const buffer = await sharp({
    create: { width: size, height: size, channels: 4, background: plate },
  })
    .composite([{ input: mark, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return opaque
    ? sharp(buffer).flatten({ background: "#ffffff" }).png().toBuffer()
    : buffer;
}

/**
 * The plate mark at full canvas scale — used where the artwork is the whole
 * tile, as opposed to insetMark above, which shrinks it into a safe zone.
 */
async function plateIcon({ size, plate, radius, opaque }) {
  const buffer = await sharp(Buffer.from(iconSvg({ plate, radius })), {
    density: 2400,
  })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return opaque
    ? sharp(buffer).flatten({ background: "#ffffff" }).png().toBuffer()
    : buffer;
}

/**
 * macOS app icon: a 1024 canvas whose art occupies the inner 824, which is the
 * grid every other Dock icon is drawn on. Without the margin the icon renders
 * visibly larger than its neighbours.
 */
async function macIcon(plate) {
  const canvas = 1024;
  const art = 824;
  const inset = Math.round((canvas - art) / 2);
  const plateBuffer = await sharp(Buffer.from(iconSvg({ plate, radius: 14 })), {
    density: 2400,
  })
    .resize(art, art)
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: plateBuffer, left: inset, top: inset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** iconutil wants a full .iconset directory, not a single PNG. */
async function writeIcns(sourcePng, outputPath) {
  const workDir = await mkdtemp(join(tmpdir(), "patcher-icns-"));
  const iconsetDir = join(workDir, "icon.iconset");
  await mkdir(iconsetDir);
  const entries = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of entries) {
    await writeFile(
      join(iconsetDir, name),
      await sharp(sourcePng).resize(size, size).png().toBuffer(),
    );
  }
  await execFileAsync("iconutil", [
    "--convert",
    "icns",
    "--output",
    outputPath,
    iconsetDir,
  ]);
  await rm(workDir, { recursive: true, force: true });
}

const written = [];
async function emit(path, buffer) {
  await writeFile(path, buffer);
  written.push(path.slice(repoRoot.length + 1));
}

// --- Repository brand assets ------------------------------------------------
// The plate icon as a raster: both READMEs embed it, and GitHub and npm are
// unreliable about rendering an SVG through an <img>, so PNG is the safe one.
await emit(
  join(assetsDir, "patcher-icon.png"),
  await plateIcon({
    size: 1024,
    plate: PLATE_CREAM,
    radius: 14,
    opaque: false,
  }),
);
await emit(
  join(assetsDir, "patcher-logo.png"),
  await render(glyphSvg(INK), 1024),
);
await emit(
  join(assetsDir, "patcher-logo-white.png"),
  await render(glyphSvg(PLATE_CREAM), 1024),
);

// --- Desktop app icons ------------------------------------------------------
// One mark, three plates. The plate colour is the only channel signal, so a
// nightly and a stable build are told apart in the Dock at a glance.
const desktopChannels = [
  { plate: PLATE_CREAM, png: "icon.png", icns: "icon.icns" },
  { plate: "#378055", png: "icon-dev.png", icns: null },
  { plate: "#F9D71C", png: "icon-nightly.png", icns: "icon-nightly.icns" },
];
for (const channel of desktopChannels) {
  const buffer = await macIcon(channel.plate);
  const pngPath = join(desktopAssetsDir, channel.png);
  await emit(pngPath, buffer);
  if (channel.icns !== null) {
    await writeIcns(buffer, join(desktopAssetsDir, channel.icns));
    written.push(join("apps", "desktop", "assets", channel.icns));
  }
}

// --- PWA base icons ---------------------------------------------------------
// Square, full bleed: the platform supplies the corner mask. generate-pwa-icons
// derives forty tinted variants from these five, and its luma mask treats
// anything at or above 245 as backing — which is why the plate here is a lighter
// cream than the desktop plate. At 512px the difference is invisible; at the
// mask it is the difference between tinting the glyph and tinting the tile.
const PWA_PLATE = "#FAF8F4";
for (const size of [192, 512]) {
  await emit(
    join(appPublicDir, `icon-${size}.png`),
    await plateIcon({ size, plate: PWA_PLATE, radius: 0, opaque: false }),
  );
  // Maskable icons are cropped to a circle of 80% diameter on some launchers,
  // so the mark has to sit inside that safe zone rather than fill the tile.
  await emit(
    join(appPublicDir, `icon-${size}-maskable.png`),
    await insetMark({
      size,
      plate: PWA_PLATE,
      coverage: 0.5,
      opaque: false,
    }),
  );
}
// iOS paints transparency in a touch icon black, so this one is flattened.
await emit(
  join(appPublicDir, "apple-touch-icon.png"),
  await plateIcon({ size: 180, plate: PWA_PLATE, radius: 0, opaque: true }),
);

// --- Favicons ---------------------------------------------------------------
// Transparent glyph, three inks: the browser tab supplies the background, and
// index.html swaps the file on prefers-color-scheme and in dev.
const faviconInks = [
  { suffix: "", fill: "#1E1E1E" },
  { suffix: "-dark", fill: "#FFFFF4" },
  { suffix: "-dev", fill: "#A1A0A0" },
];
for (const { suffix, fill } of faviconInks) {
  for (const size of [16, 32]) {
    await emit(
      join(appPublicDir, `favicon-${size}x${size}${suffix}.png`),
      await render(glyphSvg(fill), size),
    );
  }
}

console.log(`brand assets: wrote ${written.length} files`);
for (const path of written) console.log(`  ${path}`);
