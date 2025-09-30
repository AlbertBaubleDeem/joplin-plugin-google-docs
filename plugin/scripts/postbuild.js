const fs = require('fs');
const path = require('path');

function ensureDistManifest() {
  const root = path.resolve(__dirname, '..');
  const dist = path.resolve(root, 'dist');
  const srcManifest = path.resolve(root, 'manifest.json');
  const distManifest = path.resolve(dist, 'manifest.json');
  if (!fs.existsSync(dist)) fs.mkdirSync(dist);
  fs.copyFileSync(srcManifest, distManifest);
}

function ensureRootIndexStub() {
  const root = path.resolve(__dirname, '..');
  const stub = path.resolve(root, 'index.js');
  if (!fs.existsSync(stub)) {
    fs.writeFileSync(stub, "module.exports = require('./dist/index.js');\n");
  }
}

ensureDistManifest();
ensureRootIndexStub();
console.log('[postbuild] Wrote dist/manifest.json and root index.js stub');


