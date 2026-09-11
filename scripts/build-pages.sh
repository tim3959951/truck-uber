#!/usr/bin/env bash
# Builds both web apps for GitHub Pages under /<repo>/customer and /<repo>/driver and assembles ./site.
# Netlify's free plan ran out of deploy credits (Sept 2026); GitHub Pages has no such limit.
set -euo pipefail
REPO_NAME=${REPO_NAME:-truck-uber}
BASE=/$REPO_NAME
cd "$(dirname "$0")/.."
node scripts/sync-terms.js
rm -rf site && mkdir -p site
for app in customer driver; do
  pushd apps/$app >/dev/null
  cp app.json app.json.orig
  node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync('app.json'));a.expo.experiments={...(a.expo.experiments||{}),baseUrl:'$BASE/$app'};fs.writeFileSync('app.json',JSON.stringify(a,null,2));"
  set +e
  npx expo export --platform web --clear --output-dir dist-pages
  rc=$?
  set -e
  mv app.json.orig app.json
  [ $rc -eq 0 ] || exit $rc
  node ../../scripts/check-web-build.js dist-pages
  # restore the deep link that root 404.html stashed before the app boots
  node -e "const fs=require('fs');let h=fs.readFileSync('dist-pages/index.html','utf8');h=h.replace('<head>','<head><script>try{var r=sessionStorage.getItem(\"gh-redirect\");if(r){sessionStorage.removeItem(\"gh-redirect\");history.replaceState(null,\"\",r);}}catch(e){}</script>');fs.writeFileSync('dist-pages/index.html',h);"
  popd >/dev/null
  mkdir -p site/$app && cp -r apps/$app/dist-pages/. site/$app/
done
mkdir -p site/customer/admin && cp admin/index.html site/customer/admin/index.html
cat > site/index.html <<HTML
<!doctype html><meta charset="utf-8"><title>大車叫車</title>
<body style="font-family:system-ui;padding:32px;line-height:1.8">
<h1>大車叫車</h1>
<p><a href="$BASE/customer/">客戶端（叫車）</a></p>
<p><a href="$BASE/driver/">承運人端（接單）</a></p>
<p><a href="$BASE/customer/admin/">後台</a></p>
HTML
cat > site/404.html <<HTML
<!doctype html><meta charset="utf-8"><script>
(function(){var p=location.pathname,q=location.search;var app=p.indexOf('$BASE/driver')===0?'driver':'customer';
try{sessionStorage.setItem('gh-redirect',p+q);}catch(e){}
location.replace('$BASE/'+app+'/');})();
</script>
HTML
touch site/.nojekyll
echo "✓ site assembled: $(du -sh site | cut -f1)"
