const fs = require('fs');
const token = process.env.GH_TOKEN;
const repo = 'qysalsha/D-Estra7ah-yacine_tv_web';
const files = ['index.html', 'app.js', 'package.json', 'render.yaml', 'README.md', 'start.bat'];
(async () => {
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log('skip', f); continue; }
    const content = fs.readFileSync(f).toString('base64');
    const body = JSON.stringify({ message: 'Add ' + f, content });
    const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + encodeURIComponent(f), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
      body
    });
    const j = await r.json();
    console.log(f, r.status, j.content ? j.content.path : (j.message || JSON.stringify(j).slice(0, 200)));
  }
})();
