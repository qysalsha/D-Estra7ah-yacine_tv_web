const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const API_HOST = 'def55.ycnapi.com';
const DEC_PORT = 39999; // adb forward -> phone decrypt daemon

function log(s){ fs.appendFileSync(path.join(ROOT,'app.log'), new Date().toISOString()+" "+s+"\n"); }

const SALT = Buffer.from('6321785a6a2b4e392647404576407677','hex');
function decryptJs(b64, key){
  const data = Buffer.from(b64,'base64');
  const kb = Buffer.from(String(key),'utf8');
  if(!kb.length) return '';
  const P = SALT.length + kb.length;
  const out = Buffer.alloc(data.length);
  for(let i=0;i<data.length;i++){
    const j = i%P;
    out[i] = data[i] ^ (j<SALT.length ? SALT[j] : kb[j-SALT.length]);
  }
  return out.toString('utf8');
}
function decrypt(ct, key){
  return new Promise((resolve,reject)=>{
    const s = net.connect(DEC_PORT,'127.0.0.1',()=>{
      s.write('dec\n'+ct+'\n'+key+'\n');
    });
    let buf='';
    s.on('data',d=>{ buf+=d; if(buf.includes('\n')){ s.end(); resolve(buf.trim()); }});
    s.on('error',reject);
    setTimeout(()=>{try{s.destroy()}catch(e){};reject(new Error('dec timeout'))},15000);
  });
}

function fetchApi(apiPath){
  return new Promise((resolve,reject)=>{
    const req = https.request({
      hostname: API_HOST, path: '/api/'+apiPath, method:'GET',
      headers: {'User-Agent':'okhttp/4.12.0','Accept':'application/json'}
    }, res=>{
      let body='';
      res.on('data',c=>body+=c);
      res.on('end',async()=>{
        try{
          const t = res.headers['t'];
          if(t){
            const plain = decryptJs(body.trim(), String(t));
            resolve({status:res.statusCode, body:plain});
          }else{
            // no T header: brute-force unix-seconds key around now
            const now = Math.floor(Date.now()/1000);
            for(let d=-3; d<=3; d++){
              const plain = decryptJs(body.trim(), String(now+d));
              if(plain.startsWith('{')||plain.startsWith('[')){ resolve({status:res.statusCode, body:plain}); return; }
            }
            resolve({status:res.statusCode, body});
          }
        }catch(e){ resolve({status:502, body:'DECRYPT_FAIL '+e.message+' RAW:'+body.slice(0,200)}); }
      });
    });
    req.on('error',reject);
    req.end();
  });
}

function mediaQuery(extra){
  const p=new URLSearchParams();
  if(extra.ua)p.set('ua',extra.ua);
  if(extra.headers&&Object.keys(extra.headers).length)p.set('headers',JSON.stringify(extra.headers));
  return p.toString();
}
function latin1(s){ // encode JS string as UTF-8 bytes mapped to latin1 chars
  return Buffer.from(s,'utf8').toString('latin1');
}
function proxyMedia(target, reqHeaders, res, extra){
  const u = new URL(target);
  const isHttps = u.protocol==='https:';
  const port = +(u.port||(isHttps?443:80));
  const headers = {...reqHeaders};
  delete headers.host; delete headers['proxy-connection']; delete headers.connection;
  headers['Host'] = u.host;
  headers['User-Agent'] = headers['User-Agent']||'Mozilla/5.0';
  headers['Accept'] = headers['Accept']||'*/*';
  headers['Connection'] = 'close';
  let reqTxt = `GET ${u.pathname}${u.search} HTTP/1.1\r\n`;
  for(const [k,v] of Object.entries(headers)) reqTxt += `${k}: ${latin1(String(v))}\r\n`;
  reqTxt += '\r\n';
  const onSock = sock=>{
    sock.write(reqTxt,'latin1');
    let headBuf=Buffer.alloc(0), headDone=false, status=200, resHeaders={}, done=false;
    const headerEnd = ()=>headBuf.indexOf('\r\n\r\n');
    sock.on('data',chunk=>{
      if(!headDone){
        headBuf = Buffer.concat([headBuf,chunk]);
        const idx = headerEnd();
        if(idx<0) return;
        headDone = true;
        const head = headBuf.slice(0,idx).toString('latin1');
        const rest = headBuf.slice(idx+4);
        const lines = head.split('\r\n');
        const m = lines[0].match(/HTTP\/\d\.\d (\d+)/);
        status = m?+m[1]:200;
        for(const l of lines.slice(1)){
          const c=l.indexOf(':'); if(c>0) resHeaders[l.slice(0,c).trim().toLowerCase()]=l.slice(c+1).trim();
        }
        const ct = resHeaders['content-type']||'';
        const isM3u8 = /mpegurl|m3u8/i.test(ct) || /\.m3u8($|\?)/i.test(u.pathname);
        if(isM3u8){
          let body=rest.toString('utf8');
          sock.on('data',c=>body+=c.toString('utf8'));
          sock.on('end',()=>{
            // some "m3u8" URLs return an HTML redirect page — follow it
            const trimmed = body.trimStart();
            if(trimmed.startsWith('<')){
              const m = trimmed.match(/https?:\/\/[^\s"'<>]+/);
              if(m){
                done = true;
                sock.destroy();
                return proxyMedia(m[0].replace(/&amp;/g,'&'), reqHeaders, res, extra);
              }
            }
            const q = mediaQuery(extra||{});
            const suffix = q?'&'+q:'';
            const out = body.split(/\r?\n/).map(line=>{
              if(!line.trim()) return line;
              const prox = rel=>{
                try{ const abs=new URL(rel.trim(),u).href; return '/media?url='+encodeURIComponent(abs)+suffix; }
                catch(e){ return rel; }
              };
              if(line.startsWith('#')) return line.replace(/URI="([^"]+)"/g,(mm,uri)=>'URI="'+prox(uri)+'"');
              return prox(line);
            }).join('\n');
            res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
            res.end(out);
          });
          sock.on('error',()=>{});
        }else{
          const fwd={};
          for(const [k,v] of Object.entries(resHeaders)){
            if(['transfer-encoding','connection','content-encoding','content-length'].includes(k)) continue;
            fwd[k]=v;
          }
          res.writeHead(status,fwd);
          if(rest.length) res.write(rest);
          sock.on('data',c=>res.write(c));
          sock.on('end',()=>res.end());
          sock.on('error',()=>{try{res.end()}catch(e){}});
        }
        return;
      }
    });
    sock.on('error',e=>{ if(!headDone){res.writeHead(502);res.end('proxy err '+e.message);} else {try{res.end()}catch(e){}} });
    sock.on('close',()=>{ if(headDone && !done && !res.writableEnded){try{res.end()}catch(e){}} });
  };
  let sock;
  const fail = e=>{
    try{
      if(res.headersSent){ if(!res.writableEnded) res.end(); }
      else { res.writeHead(502,{'Content-Type':'text/plain'}); res.end('proxy err '+(e&&e.message||e)); }
    }catch(_){}
  };
  if(isHttps){
    sock = tls.connect({host:u.hostname,port,servername:u.hostname});
    sock.on('secureConnect',()=>onSock(sock));
  }else{
    sock = net.connect(port,u.hostname);
    sock.on('connect',()=>onSock(sock));
  }
  sock.on('error',fail);
}

const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.m3u':'application/vnd.apple.mpegurl'};

const server = http.createServer(async(req,res)=>{
  const u = new URL(req.url,'http://x');
  try{
    if(u.pathname.startsWith('/api/')){
      const r = await fetchApi(u.pathname.slice(5)+u.search);
      log('API '+u.pathname+' -> '+r.status+' len='+r.body.length);
      res.writeHead(r.status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
      res.end(r.body); return;
    }
    if(u.pathname==='/media'){
      const target = u.searchParams.get('url');
      if(!target){res.writeHead(400);res.end();return;}
      const ua=u.searchParams.get('ua');
      const hdrs={};
      let hdrObj=null;
      const h=u.searchParams.get('headers');
      if(h){try{hdrObj=JSON.parse(decodeURIComponent(h));Object.assign(hdrs,hdrObj)}catch(e){}}
      if(ua)hdrs['User-Agent']=ua;
      const ref=u.searchParams.get('referer');
      if(ref)hdrs['Referer']=ref;
      proxyMedia(target,hdrs,res,{ua:ua||'',headers:hdrObj}); return;
    }
    // static
    let p = u.pathname==='/'?'/index.html':u.pathname;
    const fp = path.join(ROOT, path.normalize(p).replace(/^([.][.][/\\])+/,''));
    if(fp.startsWith(ROOT) && fs.existsSync(fp) && fs.statSync(fp).isFile()){
      res.writeHead(200,{'Content-Type':mime[path.extname(fp)]||'application/octet-stream','Access-Control-Allow-Origin':'*'});
      fs.createReadStream(fp).pipe(res); return;
    }
    res.writeHead(404); res.end('nf');
  }catch(e){ res.writeHead(500); res.end(String(e)); }
});
const PORT = process.env.PORT || 8891;
server.listen(PORT,'0.0.0.0',()=>console.log('app server on '+PORT));
