const fs=require('fs');
const x=fs.readFileSync('D:/Estra7ah/yacine_tv_web/ui.xml','utf8');
const texts=[...x.matchAll(/text="([^"]*)"/g)].map(m=>m[1]).filter(t=>t.trim());
console.log(texts.join(' | ').slice(0,3000));
