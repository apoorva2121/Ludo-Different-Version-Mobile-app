'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const files=['online-ui.js','app-shell.js'];
for(const directory of ['game','server','client','scripts']){
  for(const name of fs.readdirSync(path.join(root,directory))) if(name.endsWith('.js')) files.push(directory+'/'+name);
}
for(const file of files) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
const html=fs.readFileSync(path.join(root,'House_of_Kiran_AI_Stage3_6_PRODUCTION.html'),'utf8');
for(const [index,match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()){
  new vm.Script(match[1],{filename:'game-page-inline-'+index});
}
console.log('JavaScript syntax verified, including the inline game and app scripts.');
