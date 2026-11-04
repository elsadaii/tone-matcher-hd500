import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "index.html");
const outputDir = resolve(root, "www");
const outputPath = resolve(outputDir, "index.html");

let html;
try {
  html = await readFile(sourcePath, "utf8");
} catch (error) {
  throw new Error(`Tidak dapat membaca index.html: ${error.message}`);
}

if (!/<head[\s>]/i.test(html) || !/<\/head>/i.test(html)) {
  throw new Error("index.html harus memiliki elemen <head> agar Capacitor dapat bekerja.");
}

if (!html.includes('name="viewport"')) {
  throw new Error("Meta viewport tidak ditemukan; hentikan build agar layout Android tidak rusak.");
}

html = html.replace(
  /<meta\s+name=["']viewport["']\s+content=["'][^"']*["']\s*\/?>/i,
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
);

const androidEnhancements = `
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<style id="tone-matcher-android-shell">
  :root { color-scheme: dark; }
  html, body {
    min-height: 100%;
    background: #10151d;
  }
  body {
    min-height: 100dvh;
    padding-bottom: env(safe-area-inset-bottom);
    overscroll-behavior-y: contain;
  }
  button, .tab, .chain-node {
    -webkit-tap-highlight-color: transparent;
  }
  input, select, textarea {
    font-size: 16px;
  }
</style>
`;

if (!html.includes('id="tone-matcher-android-shell"')) {
  html = html.replace(/<\/head>/i, `${androidEnhancements}\n</head>`);
}

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, html, "utf8");

console.log("Android web assets siap:");
console.log(`- Sumber: ${sourcePath}`);
console.log(`- Output: ${outputPath}`);
console.log(`- Ukuran: ${Buffer.byteLength(html, "utf8")} bytes`);
