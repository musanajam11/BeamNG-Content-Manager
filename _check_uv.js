const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function main() {
  const gameDir = 'C:/Users/Musa/AppData/Local/BeamNG.drive/0.34/mods';
  const files = fs.readdirSync(gameDir);
  const zipFile = files.find(f => f.includes('sunburst'));
  if (!zipFile) { console.log('No sunburst zip'); return; }
  console.log('Found:', zipFile);

  const zip = new AdmZip(path.join(gameDir, zipFile));
  const entries = zip.getEntries();

  const daes = entries.filter(e => e.entryName.endsWith('.dae')).map(e => e.entryName);
  console.log('DAE files:', daes);

  for (const daePath of daes) {
    const entry = entries.find(e => e.entryName === daePath);
    const daeText = entry.getData().toString('utf8');
    console.log('\n=== DAE:', daePath, '===');

    // Split by <triangles> groups
    const triSplit = daeText.split(/<triangles /);
    for (let i = 1; i < triSplit.length; i++) {
      const grp = triSplit[i];
      const matMatch = grp.match(/material="([^"]+)"/);
      const mat = matMatch ? matMatch[1] : 'unknown';

      // Find all TEXCOORD sets in this group
      const texInputs = grp.match(/<input[^>]*semantic="TEXCOORD"[^>]*/g) || [];
      const sets = texInputs.map(inp => {
        const setM = inp.match(/set="(\d+)"/);
        return setM ? setM[1] : '?';
      });

      // Only print paint-related materials
      if (mat.toLowerCase().includes('main') || mat.toLowerCase().includes('paint') || mat.toLowerCase().includes('skin')) {
        console.log('  Material:', mat, '  UV sets:', sets.join(', '));
      }
    }
  }

  // Now also check: does the skin_UVs.png match UV0 or UV1?
  // We can check by loading the DAE with ColladaLoader and comparing UV coords
  console.log('\n=== Checking UV0 vs UV1 ranges ===');
  const firstEntry = entries.find(e => e.entryName === daes[0]);
  const daeText2 = firstEntry.getData().toString('utf8');
  
  // Get all source arrays for TEXCOORD
  const sourceBlocks = daeText2.split(/<source /);
  for (const block of sourceBlocks) {
    const idMatch = block.match(/id="([^"]+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (!id.toLowerCase().includes('uv') && !id.toLowerCase().includes('texcoord') && !id.toLowerCase().includes('map')) continue;
    
    const floatMatch = block.match(/<float_array[^>]*>([^<]+)<\/float_array>/);
    if (!floatMatch) continue;
    const vals = floatMatch[1].trim().split(/\s+/).map(Number);
    
    // Check UV range
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let j = 0; j < vals.length; j += 2) {
      minU = Math.min(minU, vals[j]);
      maxU = Math.max(maxU, vals[j]);
      minV = Math.min(minV, vals[j+1]);
      maxV = Math.max(maxV, vals[j+1]);
    }
    console.log('Source:', id, '  count:', vals.length/2, '  U:[', minU.toFixed(3), maxU.toFixed(3), ']  V:[', minV.toFixed(3), maxV.toFixed(3), ']');
  }
}

main();
