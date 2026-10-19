const fs = require('fs');
const E = JSON.parse(fs.readFileSync('data/csgo_ref/single_embed_check.json', 'utf8'));
const rows = Array.isArray(E) ? E : E.rows || E.results || [];
console.log('keys:', Object.keys(E).slice(0, 5), 'len', rows.length);
const sample = rows.slice(0, 3);
console.log(JSON.stringify(sample, null, 1));
