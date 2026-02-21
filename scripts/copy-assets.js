const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const srcAssetsDir = path.join(projectRoot, 'src', 'assets');
const distAssetsDir = path.join(projectRoot, 'dist', 'assets');

function main() {
  if (!fs.existsSync(srcAssetsDir)) {
    console.log('[copy-assets] src/assets not found; skipping asset copy.');
    return;
  }

  fs.cpSync(srcAssetsDir, distAssetsDir, {
    recursive: true,
    force: true,
  });

  console.log('[copy-assets] copied src/assets -> dist/assets');
}

main();
