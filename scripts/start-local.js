'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const data=path.join(root,'data');
fs.mkdirSync(data,{recursive:true});
if(!process.env.AUTH_SIGNING_SECRET){
  const keyFile=path.join(data,'local-signing-secret');
  if(!fs.existsSync(keyFile)) fs.writeFileSync(keyFile,crypto.randomBytes(48).toString('hex'),{mode:0o600,flag:'wx'});
  process.env.AUTH_SIGNING_SECRET=fs.readFileSync(keyFile,'utf8').trim();
}
process.env.GAME_DATABASE_PATH=process.env.GAME_DATABASE_PATH||path.join(data,'house-of-kiran.sqlite');
const port=Number(process.env.PORT||8080);
process.env.ALLOWED_ORIGINS=process.env.ALLOWED_ORIGINS||['https://appassets.androidplatform.net','http://localhost:'+port,'http://127.0.0.1:'+port].join(',');
const {server,service}=require('../server/http');
require('../server/realtime').attachRealtime(server,service);
server.on('error',error=>{
  console.error(error.code==='EADDRINUSE'?'Port '+port+' is already in use. Close the old server window, or set PORT=8081.':error.message);
  process.exitCode=1;
});
server.listen(port,process.env.HOST||'127.0.0.1',()=>{
  console.log('House of Kiran is running. Open http://localhost:'+port+' in your browser.');
  console.log('Keep this window open. Press Ctrl+C to stop.');
});
