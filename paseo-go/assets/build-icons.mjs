// Rasterizes paseo-go/assets/icon.svg into the PNGs referenced by the app.config.js
// seam. Re-run after editing the SVG: node paseo-go/assets/build-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = path.dirname(fileURLToPath(import.meta.url));
const glyph = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");

function place(inner, scale) {
  const offset = (1024 - 512 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <g transform="translate(${offset},${offset}) scale(${scale})">${inner}</g>
  </svg>`;
}

const inner = glyph
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<!--[\s\S]*?-->/g, "");

async function main() {
  // Legacy/iOS icon: dark rounded square (official brand black), white glyph.
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <rect x="24" y="24" width="976" height="976" rx="220" fill="#0B0F0C"/>
    ${place(inner, 1.5).match(/<g[\s\S]*<\/g>/)[0]}
  </svg>`;
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(dir, "icon.png"));

  // Android adaptive foreground: glyph only, transparent, inside the 66% safe zone.
  await sharp(Buffer.from(place(inner, 1.1)))
    .png()
    .toFile(path.join(dir, "android-icon-foreground.png"));

  // Preview sheets (evidence only): glyph on green and on black.
  for (const [name, bg] of [
    ["preview-light.png", "#20744A"],
    ["preview-dark.png", "#000000"],
  ]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="110" fill="${bg}"/>${inner}
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(dir, name));
  }
  console.log("icons built");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
