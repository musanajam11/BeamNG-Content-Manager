const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Use PowerShell to extract DAE from zip since yauzl is async/callback
const gameDir = 'C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive/content/vehicles';
const contentDir = null; // unused

// Try the content directory directly first (unpacked)
let daeText = null;

// Use the zip directly
const zipPath = path.join(gameDir, 'sunburst2.zip');
if (fs.existsSync(zipPath)) {
  console.log('Found zip:', zipPath);
  const tmpDir = path.join(__dirname, '_tmp_dae');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  execSync(`Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${tmpDir}" -Force`, { shell: 'powershell' });
  const findDae = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) {
        const r = findDae(path.join(dir, f.name));
        if (r) return r;
      } else if (f.name.endsWith('.dae')) {
        return path.join(dir, f.name);
      }
    }
    return null;
  };
  const daePath = findDae(tmpDir);
  if (daePath) {
    console.log('DAE found at:', daePath);
    daeText = fs.readFileSync(daePath, 'utf8');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
} else {
  console.log('No zip found at', zipPath);
}

if (!daeText) {
  console.log('No DAE found');
  process.exit(1);
}

console.log('DAE length:', daeText.length);

// Split by <triangles> groups and check UV sets per material
const triSplit = daeText.split(/<triangles /);
console.log('\n=== Paint material UV sets ===');
const allMats = {};
for (let i = 1; i < triSplit.length; i++) {
  const grp = triSplit[i];
  const matMatch = grp.match(/material="([^"]+)"/);
  const mat = matMatch ? matMatch[1] : 'unknown';
  const texInputs = (grp.match(/<input[^>]*semantic="TEXCOORD"[^>]*/g) || []);
  const sets = texInputs.map(inp => {
    const setM = inp.match(/set="(\d+)"/);
    return setM ? setM[1] : '?';
  });
  if (!allMats[mat]) allMats[mat] = [];
  allMats[mat].push(sets);
}

// Print all unique materials and their UV sets
for (const [mat, setsList] of Object.entries(allMats)) {
  const uniqueSets = [...new Set(setsList.flat())].sort();
  console.log('  Material:', mat, '  UV sets:', uniqueSets.join(', '), '  (', setsList.length, 'groups)');
}

// Check UV coordinate ranges for sources with UV/map/texcoord in name
console.log('\n=== UV source coordinate ranges ===');
const sourceRegex = /<source\s+id="([^"]+)"[^>]*>[\s\S]*?<float_array[^>]*>([\s\S]*?)<\/float_array>/g;
let match;
while ((match = sourceRegex.exec(daeText)) !== null) {
  const id = match[1];
  if (!id.toLowerCase().includes('map') && !id.toLowerCase().includes('uv') && !id.toLowerCase().includes('texcoord')) continue;
  const vals = match[2].trim().split(/\s+/).map(Number);
  if (vals.length < 4) continue;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let j = 0; j < vals.length; j += 2) {
    if (!isNaN(vals[j]) && !isNaN(vals[j+1])) {
      minU = Math.min(minU, vals[j]);
      maxU = Math.max(maxU, vals[j]);
      minV = Math.min(minV, vals[j+1]);
      maxV = Math.max(maxV, vals[j+1]);
    }
  }
  console.log('  Source:', id, '  verts:', vals.length/2, '  U:[', minU.toFixed(4), '-', maxU.toFixed(4), ']  V:[', minV.toFixed(4), '-', maxV.toFixed(4), ']');
}
