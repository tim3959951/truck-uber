// Publishes admin/index.html at <site>/admin/ so the back office is reachable without a separate deploy.
const fs = require('fs');
const path = require('path');
const dist = process.argv[2] || 'dist';
const src = path.join(__dirname, '..', 'admin', 'index.html');
const out = path.join(dist, 'admin');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(src, path.join(out, 'index.html'));
console.log('✓ admin page copied to ' + path.join(out, 'index.html'));
