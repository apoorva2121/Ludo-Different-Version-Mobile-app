'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const WebSocket=require('ws');
const {setTimeout:delay}=require('node:timers/promises');
const {loadPage}=require('./helpers/page');
process.env.AUTH_SIGNING_SECRET='page-integration-test-secret-at-least-32-characters';
delete process.env.GAME_DATABASE_PATH;
const {server,service}=require('../server/http');
const {attachRealtime}=require('../server/realtime');

async function until(predicate,message){
  const deadline=Date.now()+7000;
  while(!predicate()){
    if(Date.now()>deadline) throw new Error('Timed out: '+message);
    await delay(10);
  }
}

function controlledPage(t,{token='saved-token'}={}){
  const requests=[], sockets=[];
  const page=loadPage({beforeParse(window){
    window.HOK_ONLINE_CONFIG={baseUrl:'https://game.example',token};
    // Deliberately allow late replies after abort to exercise cancellation guards.
    window.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,
      reply(data,status=200){resolve({ok:status<400,status,json:async()=>structuredClone(data)});}
    }));
    window.WebSocket=class extends window.EventTarget{
      static OPEN=1;
      constructor(url){super();this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}
      send(text){assert.equal(this.readyState,1);this.sent.push(JSON.parse(text));}
      open(){this.readyState=1;this.dispatchEvent(new window.Event('open'));}
      receive(message){this.dispatchEvent(new window.MessageEvent('message',{data:JSON.stringify(message)}));}
      close(code=1000){this.readyState=3;this.dispatchEvent(new window.CloseEvent('close',{code}));}
      fail(){this.dispatchEvent(new window.Event('error'));}
    };
  }});
  t.after(()=>{
    page.window.HOKOnlineController.leave();page.close();
    assert.equal(page.errors.length,0,page.errors.map(e=>e.message).join('\n'));
  });
  return Object.assign(page,{requests,sockets,el:id=>page.document.getElementById(id)});
}

function room({full=true,moving=false}={}){
  const state=require('../game/engine').freshState({activeColors:['red','yellow']});
  if(moving){
    Object.assign(state,{phase:'moving',canRoll:false,dice:2,pendingRolls:[2,6],rollHistory:[6,2]});
    state.pieces[0].relativePosition=1;
  }
  return {id:'test-room',state,players:[{userId:'alice',color:'red'},...(full?[{userId:'bob',color:'yellow'}]:[])]};
}

async function enterRoom(page,game=room(),{subscribe=true}={}){
  const offset=page.requests.length;
  page.el('modeOnlineBtn').click();page.el('onlineCreate').click();
  page.requests[offset].reply({user:{id:'alice'}});
  await until(()=>page.requests.length===offset+2,'room request');
  page.requests[offset+1].reply({game});
  await until(()=>page.window.HOKOnlineBridge.isOnline(),'room response');
  const socket=page.sockets.at(-1);
  if(subscribe){socket.open();socket.receive({type:'AUTHENTICATED'});socket.receive({type:'GAME_STATE',game});}
  return socket;
}

test('navigation cancels pending authentication without creating a room or restoring a session',async t=>{
  for(const action of ['close','back','offline','mode','logout']) await t.test(action,async t=>{
    const page=controlledPage(t,{token:''});
    page.el('modeOnlineBtn').click();page.el('onlineUser').value='alice';page.el('onlinePassword').value='test-password';
    page.el('onlineCreate').click();
    const request=page.requests[0];
    if(action==='close') page.el('onlineClose').click();
    if(action==='back') page.window.HOKApp.handleBack();
    if(action==='offline') page.el('onlineOffline').click();
    if(action==='mode') page.el('modeMultiBtn').click();
    if(action==='logout') page.el('onlineLogout').click();
    assert.equal(page.el('onlineCreate').disabled,false,'Cancellation releases the lobby immediately');
    const status=page.el('connectionStatus').textContent;
    request.reply({token:'late-token',user:{id:'alice'}});
    await delay(0);
    assert.equal(page.requests.length,1,'Cancelled login must not create a room');
    assert.equal(page.el('onlineToken').value,'','Cancelled login must not restore credentials');
    assert.equal(page.el('connectionStatus').textContent,status);
    assert.equal(page.window.HOKOnlineBridge.isOnline(),false);
    assert.equal(request.options.signal.aborted,true);
  });
});

test('a cancelled registration cannot overwrite a newer pending attempt',async t=>{
  const page=controlledPage(t,{token:''});
  page.el('modeOnlineBtn').click();page.el('onlineRegister').click();
  page.el('onlineClose').click();page.el('modeOnlineBtn').click();page.el('onlineRegister').click();
  assert.equal(page.requests.length,2,'The lobby can start a fresh attempt immediately');
  page.requests[0].reply({token:'old-token',user:{id:'old-user'}});
  await delay(0);
  assert.equal(page.el('onlineToken').value,'');
  assert.equal(page.el('onlineRegister').disabled,true,'Old finally must not unlock a newer request');
  page.requests[1].reply({token:'new-token',user:{id:'alice'}});
  await until(()=>page.el('onlineToken').value==='new-token','new registration');
  assert.equal(page.el('onlineRegister').disabled,false);
});

test('a late room response cannot replace a newly started offline game',async t=>{
  const page=controlledPage(t);
  page.el('modeOnlineBtn').click();page.el('onlineCreate').click();
  page.requests[0].reply({user:{id:'alice'}});
  await until(()=>page.requests.length===2,'room request');
  page.el('onlineOffline').click();page.el('modeMultiBtn').click();page.el('startBtn').click();
  const offlineState=page.state();
  page.requests[1].reply({game:room()});await delay(0);
  assert.equal(page.window.HOKOnlineBridge.isOnline(),false);
  assert.equal(page.state(),offlineState);
  assert.equal(page.sockets.length,0);
  assert.equal(page.window.localStorage.getItem('hok_online_room'),null);
});

test('an expired response from a cancelled attempt cannot clear a newer session',async t=>{
  const page=controlledPage(t);
  page.el('modeOnlineBtn').click();page.el('onlineCreate').click();
  page.el('onlineClose').click();page.el('modeOnlineBtn').click();page.el('onlineRegister').click();
  assert.equal(page.requests.length,2);
  page.requests[1].reply({token:'new-token',user:{id:'alice'}});
  await until(()=>page.el('onlineToken').value==='new-token','new session');
  page.requests[0].reply({error:'UNAUTHORIZED'},401);await delay(0);
  assert.equal(page.el('onlineToken').value,'new-token');
  assert.match(page.el('onlineStatus').textContent,/Account created/);
});

test('an attempt and its reconnect stay on the server used for authentication',async t=>{
  const page=controlledPage(t);
  page.el('modeOnlineBtn').click();page.el('onlineCreate').click();
  page.el('onlineBaseUrl').value='https://other.example';
  page.requests[0].reply({user:{id:'alice'}});
  await until(()=>page.requests.length===2,'room request');
  assert.equal(page.requests[1].url,'https://game.example/v1/games');
  page.requests[1].reply({game:room()});await until(()=>page.sockets.length===1,'socket');
  assert.equal(page.sockets[0].url,'wss://game.example/v1/realtime');
  assert.equal(JSON.parse(page.window.localStorage.getItem('hok_online_room')).baseUrl,'https://game.example');
  page.sockets[0].close(1006);page.advance(500);
  assert.equal(page.sockets[1].url,'wss://game.example/v1/realtime');
});

test('leaving during socket connection ignores late open, error and state events',async t=>{
  const page=controlledPage(t), game=room();
  const socket=await enterRoom(page,game,{subscribe:false});
  page.window.backToSetup();
  const status=page.el('connectionStatus').textContent;
  socket.open();socket.fail();socket.receive({type:'GAME_STATE',game});page.advance(16000);
  assert.equal(socket.sent.length,0,'A discarded socket must not authenticate');
  assert.equal(page.el('connectionStatus').textContent,status);
  assert.equal(page.window.HOKOnlineBridge.isOnline(),false);
  assert.equal(page.sockets.length,1);
});

test('reconnect waits for a snapshot and ignores callbacks from the old socket',async t=>{
  const page=controlledPage(t), game=room();
  const old=await enterRoom(page,game);
  old.close(1006);assert.equal(page.window.HOKOnlineController.canPlay(),false);
  page.advance(500);const current=page.sockets[1];current.open();current.receive({type:'AUTHENTICATED'});
  page.window.onDiceClick('red');assert.equal(current.sent.filter(m=>m.type==='COMMAND').length,0);
  current.receive({type:'GAME_STATE',game});
  const status=page.el('connectionStatus').textContent;
  old.fail();old.close(4001);old.receive({type:'ERROR',error:'UNAUTHORIZED'});
  assert.equal(page.el('connectionStatus').textContent,status);
  assert.equal(page.window.HOKOnlineController.canPlay(),true);
  assert.equal(page.el('onlineToken').value,'saved-token');
});

test('waiting roster updates at the same board version unlock play only when full',async t=>{
  const page=controlledPage(t), game=room({full:false});
  const socket=await enterRoom(page,game);
  assert.equal(page.window.HOKOnlineController.canPlay(),false);
  assert.equal(page.el('rollAction').disabled,true);
  assert.match(page.el('connectionStatus').textContent,/1\/2 joined/);
  page.window.onDiceClick('red');assert.equal(socket.sent.filter(m=>m.type==='COMMAND').length,0);
  socket.receive({type:'GAME_STATE_UPDATED',game:room()});
  assert.equal(page.state().version,0);
  assert.match(page.el('roomRoster').textContent,/yellow/);
  assert.equal(page.el('rollAction').disabled,false);
});

test('move choices are replaced and invalidated by a board update or disconnect',async t=>{
  const page=controlledPage(t), game=room({moving:true});
  const socket=await enterRoom(page,game);
  page.window.onPieceClick('red0');page.window.onPieceClick('red0');
  assert.equal(page.document.querySelectorAll('#onlineMoveChoice').length,1);
  const staleButton=page.document.querySelector('#onlineMoveChoice button');
  game.state.version++;game.state.pendingRolls=[3,6];game.state.dice=3;
  socket.receive({type:'GAME_STATE_UPDATED',game});
  assert.equal(page.el('onlineMoveChoice'),null,'Choices from an older board must disappear');
  staleButton.click();assert.equal(socket.sent.filter(m=>m.type==='COMMAND').length,0);
  page.window.onPieceClick('red0');assert.ok(page.el('onlineMoveChoice'));
  socket.close(1006);assert.equal(page.el('onlineMoveChoice'),null);
});

test('leaving after die selection confirmation cancels the remaining move',async t=>{
  const page=controlledPage(t), game=room({moving:true});
  const socket=await enterRoom(page,game);
  const option=page.window.HOKOnlineBridge.getMoveOptions('red0').find(m=>m.rollIdx===1);
  const moving=page.window.HOKOnlineController.move(option);
  const selected=socket.sent.at(-1);assert.equal(selected.command,'SELECT_DIE');
  game.state.version++;game.state.selectedRollIndex=1;game.state.dice=6;
  socket.receive({type:'COMMAND_RESULT',commandId:selected.commandId,game});
  page.window.backToSetup();const status=page.el('connectionStatus').textContent;
  await moving;
  assert.equal(socket.sent.filter(m=>m.command==='MOVE_PIECE').length,0);
  assert.equal(page.el('connectionStatus').textContent,status,'Cancelled move must not report a connection error offline');
});

test('leaving with a pending roll or automatic turn command preserves offline status',async t=>{
  for(const command of ['ROLL_DICE','PASS_TURN','END_TURN']) await t.test(command,async t=>{
    const page=controlledPage(t), game=room();
    if(command!=='ROLL_DICE') Object.assign(game.state,{phase:'moving',canRoll:false,
      dice:command==='PASS_TURN'?2:null,pendingRolls:command==='PASS_TURN'?[2]:[]});
    const socket=await enterRoom(page,game);
    if(command==='ROLL_DICE') page.window.onDiceClick('red');
    assert.equal(socket.sent.at(-1).command,command);
    page.window.backToSetup();const status=page.el('connectionStatus').textContent;
    await delay(0);
    assert.equal(page.el('connectionStatus').textContent,status);
    assert.equal(page.window.HOKOnlineBridge.isOnline(),false);
  });
});

test('an unconfirmed roll reconnects and synchronizes without replaying the roll',async t=>{
  const page=controlledPage(t), game=room();
  const socket=await enterRoom(page,game);
  page.window.onDiceClick('red');page.window.onDiceClick('red');
  assert.equal(socket.sent.filter(m=>m.command==='ROLL_DICE').length,1,'Only one roll can be pending');
  page.advance(12000);await delay(0);
  assert.equal(page.window.HOKOnlineController.canPlay(),false);
  page.advance(500);const current=page.sockets[1];current.open();current.receive({type:'AUTHENTICATED'});
  game.state.version=1;game.state.dice=6;game.state.pendingRolls=[6];game.state.rollHistory=[6];
  current.receive({type:'GAME_STATE',game});
  assert.equal(page.state().dice,6);
  assert.equal(current.sent.filter(m=>m.type==='COMMAND').length,0);
  assert.equal(page.window.HOKOnlineController.canPlay(),true);
});

test('two shipped pages create/join a room, select a die, move, reconnect and return offline',{timeout:20000},async t=>{
  const wss=attachRealtime(server,service);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl='http://127.0.0.1:'+server.address().port;
  const pages=[];
  t.after(async()=>{
    pages.forEach(page=>{page.window.HOKOnlineController.leave();page.close();});
    for(const socket of wss.clients) socket.terminate();
    await new Promise(resolve=>wss.close(resolve));
    await new Promise(resolve=>server.close(resolve));
  });
  for(const username of ['page_alice','page_bob']){
    const page=loadPage({beforeParse(window){window.fetch=fetch;window.AbortController=AbortController;window.WebSocket=WebSocket;window.HOK_ONLINE_CONFIG={baseUrl};}});
    pages.push(page);
    page.document.getElementById('modeOnlineBtn').click();
    page.document.getElementById('onlineUser').value=username;
    page.document.getElementById('onlinePassword').value='integration-test-password';
    page.document.getElementById('onlineRegister').click();
    await until(()=>page.document.getElementById('onlineStatus').textContent.includes('Account created'),username+' registration');
  }
  const [alice,bob]=pages;
  alice.document.getElementById('onlineCreate').click();
  await until(()=>alice.window.HOKOnlineBridge.isOnline(),'create room');
  assert.equal(alice.document.getElementById('rollAction').disabled,true,'Host must wait for the second player');
  const gameId=alice.document.getElementById('roomCode').value;
  bob.document.getElementById('onlineGameId').value=gameId;bob.document.getElementById('onlineJoin').click();
  await until(()=>alice.window.HOKOnlineController.canPlay() && bob.window.HOKOnlineController.canPlay(),'both clients subscribed');
  assert.match(alice.document.getElementById('roomRoster').textContent,/yellow/);
  assert.equal(alice.state().humanColor,'red');assert.equal(bob.state().humanColor,'yellow');
  const stored=service.requireGame(gameId);
  Object.assign(stored.state,{phase:'moving',canRoll:false,dice:2,pendingRolls:[2,6],rollHistory:[6,2],selectedRollIndex:0,version:1});
  service.emit('updated',gameId);
  await until(()=>alice.state().version===1,'seeded dice appear');
  alice.document.querySelector('.piece[data-pid="red0"]').click();
  await until(()=>alice.state().pieces[0].relPos===1 && bob.state().pieces[0].relPos===1,'die selection and yard exit confirmation');
  assert.equal(alice.state().pendingRolls[0],2);
  alice.document.querySelector('.piece[data-pid="red0"]').click();
  await until(()=>alice.state().pieces[0].relPos===3 && alice.state().turnIdx===1 && bob.state().turnIdx===1,'remaining die and automatic turn end');
  const aliceId=stored.players.keys().next().value;
  for(const socket of wss.clients) if(socket.userId===aliceId) socket.terminate();
  await until(()=>alice.document.getElementById('connectionStatus').textContent.includes('Connection lost'),'disconnect notice');
  alice.advance(600);
  await until(()=>alice.window.HOKOnlineController.canPlay(),'reconnect synchronization');
  assert.equal(alice.state().pieces[0].relPos,3);
  alice.window.backToSetup();alice.document.getElementById('modeMultiBtn').click();alice.document.getElementById('startBtn').click();
  alice.state().devForceRoll=6;alice.document.getElementById('rollAction').click();alice.advance(500);
  assert.equal(alice.state().dice,6,'Offline controls still work after a real online match');
  for(const page of pages) assert.equal(page.errors.length,0,page.errors.map(e=>e.message).join('\n'));
});
