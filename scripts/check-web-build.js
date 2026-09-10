// Fails the build if the Supabase config was not inlined (would silently run the mock backend).
const fs = require('fs');
const path = require('path');
const dist = process.argv[2] || 'dist';
const dir = path.join(dist, '_expo/static/js/web');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const js = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
// read .env the same way Expo does (process.env wins, then .env in the app folder)
const env = { ...process.env };
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const url = (env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
if (!url || !key) { console.error('✗ EXPO_PUBLIC_SUPABASE_URL / ANON_KEY not set in .env'); process.exit(1); }
if (!js.includes(url) || !js.includes(key)) { console.error('✗ Supabase config is NOT in the bundle — the site would run the offline mock. Re-run with --clear.'); process.exit(1); }
console.log('✓ web bundle contains the Supabase config (' + url + ')');
