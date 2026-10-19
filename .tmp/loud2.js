const fs = require('fs');
const loud = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const want = process.argv.slice(2);
for (const r of loud.rows) {
  if (want.some((w) => r.file.toLowerCase().includes(w.toLowerCase()))) {
    console.log(r.file.padEnd(42), 'rms', String(r.rms_db).padStart(7), 'peak', String(r.peak_db).padStart(7), 'sec', r.seconds);
  }
}
