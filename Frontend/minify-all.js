
/*
===========================================
HIPPO HOUSE MALINDI
FRONTEND MINIFICATION SCRIPT
===========================================

Minifies:
- styles/*.css
- scripts/*.js
- Frontend root HTML files

Original files are preserved.

Outputs:
- styles/name.min.css
- scripts/name.min.js
- page.min.html

Run:
node minify-all.js

===========================================
*/

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { minify as minifyJS } from "terser";
import CleanCSS from "clean-css";
import { minify as minifyHTML } from "html-minifier-terser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================
   CONFIGURATION
========================================= */

const folders = [
  "styles",
  "scripts"
];

const CSS_OPTIONS = {
  level: 1,
  format: false
};

const JS_OPTIONS = {
  module: true,
  compress: {
    defaults: true,
    drop_console: false
  },
  mangle: true,
  format: {
    comments: false
  }
};

const HTML_OPTIONS = {
  collapseWhitespace: true,
  conservativeCollapse: false,
  removeComments: true,
  removeRedundantAttributes: true,
  removeEmptyAttributes: false,
  removeOptionalTags: false,
  removeAttributeQuotes: false,
  collapseBooleanAttributes: true,
  minifyCSS: true,
  minifyJS: false,
  keepClosingSlash: true,
  caseSensitive: true
};

/* =========================================
   HELPER FUNCTIONS
========================================= */

function isMinified(filename) {
  return /\.min\.(css|js|html)$/i.test(filename);
}

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function logResult(input, output, before, after) {
  const reduction = before > 0
    ? ((1 - after / before) * 100).toFixed(1)
    : "0.0";

  console.log(
    `✅ ${path.basename(input)} → ${path.basename(output)}`
  );

  console.log(
    `   ${formatSize(before)} → ${formatSize(after)} (${reduction}% smaller)`
  );
}

/* =========================================
   MINIFY CSS
========================================= */

async function minifyCSSFile(input) {
  const original = await fs.readFile(input, "utf8");

  const result = new CleanCSS(
    CSS_OPTIONS
  ).minify(original);

  if (result.errors.length) {
    throw new Error(result.errors.join("\n"));
  }

  const output = input.replace(
    /\.css$/i,
    ".min.css"
  );

  await fs.writeFile(
    output,
    result.styles,
    "utf8"
  );

  logResult(
    input,
    output,
    Buffer.byteLength(original),
    Buffer.byteLength(result.styles)
  );
}

/* =========================================
   MINIFY JAVASCRIPT
========================================= */

async function minifyJSFile(input) {
  const original = await fs.readFile(input, "utf8");

  const result = await minifyJS(
    original,
    JS_OPTIONS
  );

  if (!result.code) {
    throw new Error(
      `Terser returned empty output for ${input}`
    );
  }

  const output = input.replace(
    /\.js$/i,
    ".min.js"
  );

  await fs.writeFile(
    output,
    result.code,
    "utf8"
  );

  logResult(
    input,
    output,
    Buffer.byteLength(original),
    Buffer.byteLength(result.code)
  );
}

/* =========================================
   MINIFY HTML
========================================= */

async function minifyHTMLFile(input) {
  const original = await fs.readFile(input, "utf8");

  const result = await minifyHTML(
    original,
    HTML_OPTIONS
  );

  const output = input.replace(
    /\.html$/i,
    ".min.html"
  );

  await fs.writeFile(
    output,
    result,
    "utf8"
  );

  logResult(
    input,
    output,
    Buffer.byteLength(original),
    Buffer.byteLength(result)
  );
}

/* =========================================
   PROCESS CSS AND JS FOLDERS
========================================= */

async function processFolder(folder) {
  const folderPath = path.join(
    __dirname,
    folder
  );

  let files;

  try {
    files = await fs.readdir(
      folderPath,
      { withFileTypes: true }
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(
        `⚠️ Folder not found: ${folder}`
      );
      return;
    }

    throw error;
  }

  for (const file of files) {
    if (!file.isFile()) continue;

    if (isMinified(file.name)) continue;

    const input = path.join(
      folderPath,
      file.name
    );

    const extension = path.extname(
      file.name
    ).toLowerCase();

    try {
      if (extension === ".css") {
        await minifyCSSFile(input);
      }

      if (extension === ".js") {
        await minifyJSFile(input);
      }
    } catch (error) {
      console.error(
        `❌ Failed: ${file.name}`,
        error.message
      );

      process.exitCode = 1;
    }
  }
}

/* =========================================
   PROCESS HTML FILES
========================================= */

async function processHTMLFiles() {
  const files = await fs.readdir(
    __dirname,
    { withFileTypes: true }
  );

  for (const file of files) {
    if (!file.isFile()) continue;

    if (!file.name.endsWith(".html")) {
      continue;
    }

    if (isMinified(file.name)) {
      continue;
    }

    const input = path.join(
      __dirname,
      file.name
    );

    try {
      await minifyHTMLFile(input);
    } catch (error) {
      console.error(
        `❌ HTML failed: ${file.name}`,
        error.message
      );

      process.exitCode = 1;
    }
  }
}

/* =========================================
   RUN MINIFICATION
========================================= */

async function main() {
  console.log("\n==================================");
  console.log(" HIPPO HOUSE MALINDI");
  console.log(" FRONTEND MINIFICATION");
  console.log("==================================\n");

  for (const folder of folders) {
    console.log(`\n📁 Processing ${folder}/\n`);

    await processFolder(folder);
  }

  console.log("\n📄 Processing HTML files\n");

  await processHTMLFiles();

  console.log("\n==================================");

  if (process.exitCode) {
    console.log("⚠️ Completed with some errors.");
  } else {
    console.log("✅ All frontend files minified!");
  }

  console.log("==================================\n");
}

main().catch(error => {
  console.error("❌ Minification failed:", error);
  process.exitCode = 1;
});
