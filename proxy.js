const http = require('http');
const net = require('net');
const dns = require('dns');
const fs = require('fs');
const LOG = 'D:\\Estra7ah\\yacine_tv_web\\capture.log';
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8','1.1.1.1']);
function log(s){ fs.appendFileSync(LOG, new Date().toISOString()+" "+s+"\n"); }
function isIP(h){ return /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':'); }
function lookup(host){ return isIP(host) ? Promise.resolve(host) : new Promise((res,rej)=>resolver.resolve4(host,(e,a)=>e?rej(e):res(a[0]))); }

const server = http.createServer((req,res)=>{
  log("HTTP "+req.method+" "+req.url);
  if(req.url.includes('127.0.0.1')||req.url.includes('localhost')||req.url.includes('signalsignal')||req.url.includes('m3u8')||req.url.includes('.ts')) log("HDRS "+req.method+" "+req.url+" "+JSON.stringify(req.headers));
  (async()=>{
    try{
      const u=new URL(req.url);
      const ip=await lookup(u.hostname).catch(()=>u.hostname);
      const opts={hostname:ip,port:u.port||80,path:u.pathname+u.search,method:req.method,headers:{...req.headers,host:u.host}};
      const p=http.request(opts,pr=>{res.writeHead(pr.statusCode,pr.headers);pr.pipe(res);});
      p.on('error',e=>{log("ERR "+req.url+" "+e.message);res.writeHead(502);res.end();});
      req.pipe(p);
    }catch(e){log("PERR "+req.url);res.writeHead(502);res.end();}
  })();
});

server.on('connect',(req,clientSock,head)=>{
  log("CONNECT "+req.url);
  const [host,port]=req.url.split(':');
  lookup(host).then(ip=>{
    const srv=net.connect(+port||443,ip,()=>{
      clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head&&head.length) srv.write(head);
      srv.pipe(clientSock); clientSock.pipe(srv);
    });
    srv.on('error',e=>{log("CERR "+req.url+" "+e.message);clientSock.end();});
    clientSock.on('error',()=>srv.destroy());
  }).catch(e=>{log("DNSERR "+req.url+" "+e.message);clientSock.end();});
});

server.listen(8890,'0.0.0.0',()=>console.log('proxy on 8890'));
