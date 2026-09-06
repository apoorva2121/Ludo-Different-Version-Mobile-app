(function(){
  'use strict';
  const bridge = window.HOKOnlineBridge;
  if(!bridge) return;
  const params = new URLSearchParams(location.search);
  const config = window.HOK_ONLINE_CONFIG || {};
  const release = params.get('release') === '1';
  const $ = id => document.getElementById(id);
  const localDiceClick = window.onDiceClick;
  const localPieceClick = window.onPieceClick;
  const TEAM_OF = {red:'A',yellow:'A',green:'B',blue:'B'};
  const root = document.createElement('div');
  root.id = 'onlineLobby'; root.className = 'appModal'; root.hidden = true;
  root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-labelledby','onlineTitle');
  root.innerHTML = `<div class="modalCard">
    <div class="modalTop"><span class="eyebrow">TOGETHER, FROM ANYWHERE</span><button id="onlineClose" class="closeButton" aria-label="Close online lobby">×</button></div>
    <h2 id="onlineTitle">Play with friends</h2><p>Create a room, share its code, and let the rivalry begin.</p>
    <label>Username<input id="onlineUser" maxlength="40" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    <label>Password<input id="onlinePassword" type="password" maxlength="256" autocomplete="current-password"></label>
    <div class="formHint">New here? Use 3–40 characters for your username and at least 12 for your password, then create an account.</div>
    <div class="onlineActions"><button id="onlineRegister">Create account</button><button id="onlineLogout">Sign out</button></div>
    <label>Players in your new room<select id="onlinePlayers"><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label>
    <label><input id="onlineTeam" type="checkbox" style="display:inline;width:auto;min-height:0"> Teams (4 players)</label>
    <label>Room code <span class="formHint">— only needed to join</span><input id="onlineGameId" maxlength="80" autocomplete="off" placeholder="Paste your friend’s room code"></label>
    <label>Your colour<select id="onlineColor"><option value="">Any available colour</option><option value="red">Red</option><option value="green">Green</option><option value="yellow">Yellow</option><option value="blue">Blue</option></select></label>
    <div class="onlineActions"><button id="onlineCreate" class="primaryButton">Create room</button><button id="onlineJoin">Join room</button></div>
    <button id="onlineResume" class="textButton" hidden>Rejoin last room</button>
    <div id="onlineStatus" role="status" aria-live="polite"></div>
    <details id="connectionSettings"><summary>Connection settings</summary><label>Server address<input id="onlineBaseUrl" type="url" autocomplete="url" placeholder="https://your-game-server.com"></label><p class="formHint">Online play needs a running game server. AI and Pass &amp; Play are always available offline.</p></details>
    <input id="onlineToken" type="hidden"><button id="onlineOffline" class="textButton">Play offline instead →</button>
  </div>`;
  document.body.appendChild(root);
  function readLocal(key){ try { return localStorage.getItem(key); } catch(_) { return null; } }
  function saveLocal(key,value){ try { localStorage.setItem(key,value); } catch(_) {} }
  let savedRoom;
  try { savedRoom = JSON.parse(readLocal('hok_online_room')); } catch(_) {}
  const origin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.origin) ? location.origin : '';
  $('onlineBaseUrl').value = config.baseUrl || params.get('baseUrl') || (savedRoom && savedRoom.baseUrl) || origin;
  if($('onlineBaseUrl').value === 'https://api.example.com') $('onlineBaseUrl').value = '';
  $('onlineGameId').value = config.gameId || ''; $('onlineResume').hidden = !savedRoom;
  let token = config.token || '', tokenBase = $('onlineBaseUrl').value;
  try {
    const stored = window.AndroidSession && window.AndroidSession.getToken();
    if(stored){ const session=JSON.parse(stored); if(session.baseUrl===tokenBase) token=session.token; }
  } catch(_) { /* Older or invalid sessions can sign in again. */ }
  $('onlineToken').value = token;
  let userId = null, gameId = '', roomBase = '', playerColor = '', game = null;
  let socket = null, ready = false, intentionalClose = true, busy = false;
  let activeAttempt = null;
  let reconnectTimer = null, reconnectDelay = 500;
  const pending = new Map();
  const errors = {
    INVALID_CREDENTIALS:'Check your username and password. Passwords must have at least 12 characters.',
    USERNAME_UNAVAILABLE:'That username is already taken. Sign in or choose another.',
    UNAUTHORIZED:'Your session has expired. Please sign in again.',
    GAME_NOT_FOUND:'That room was not found. Check the room code.',
    GAME_FULL:'This room is full.', COLOR_UNAVAILABLE:'That colour is taken. Choose another colour or Any available colour.',
    FORBIDDEN:'You have not joined that room.', STATE_VERSION_CONFLICT:'The board has changed. It has been refreshed; try your move again.',
    RATE_LIMITED:'Too many requests. Please wait a minute and try again.',
    GAME_WAITING_FOR_PLAYERS:'Waiting for the other players to join.', NOT_YOUR_TURN:'Wait for your turn.',
    COMMAND_PENDING:'Your move is being confirmed…', CONNECTION_LOST:'Connection lost. Reconnecting to your room…'
  };
  function status(message,good){
    const text = errors[message] || message || '';
    $('onlineStatus').textContent=text; $('onlineStatus').style.color=good?'#6ee7b7':'#fca5a5';
    $('connectionStatus').textContent=text;
  }
  function setBusy(value){ busy=value; ['onlineCreate','onlineJoin','onlineRegister','onlineResume'].forEach(id=>$(id).disabled=value); }
  function beginAttempt(){
    const attempt={base:serverBase(),controller:new AbortController()};
    activeAttempt=attempt; setBusy(true); return attempt;
  }
  function cancelAttempt(){
    const attempt=activeAttempt; activeAttempt=null;
    if(attempt) attempt.controller.abort();
    setBusy(false);
  }
  function serverBase(){
    const text = $('onlineBaseUrl').value.trim().replace(/\/$/,'');
    if(!text) throw new Error('Online play is not configured yet. Enter your game server address, or choose Play offline.');
    let url; try { url=new URL(text); } catch(_) { throw new Error('Enter a valid server address.'); }
    const host=url.hostname, local=/^(localhost|127\.0\.0\.1)$/.test(host);
    const privateIP=/^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
    if(url.username || url.password || url.search || url.hash || url.pathname!=='/' || (url.protocol!=='https:' && !(url.protocol==='http:' && !release && (local || privateIP)))) {
      throw new Error('Use an HTTPS server address. Private-network HTTP is available in the testing app.');
    }
    $('onlineBaseUrl').value=text; return text;
  }
  function clearSession(){ token=''; userId=null; $('onlineToken').value=''; if(window.AndroidSession) window.AndroidSession.clearToken(); }
  function rememberSession(base){
    tokenBase=base; $('onlineToken').value=token;
    if(window.AndroidSession) window.AndroidSession.putToken(JSON.stringify({baseUrl:base,token}));
  }
  async function json(attempt,path,body,authenticated=false){
    const {base,controller}=attempt, timer=setTimeout(()=>controller.abort(),12000);
    try{
      if(attempt!==activeAttempt) throw new Error('CANCELLED');
      const response=await fetch(base+path,{method:body===undefined?'GET':'POST',signal:controller.signal,
        headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(authenticated?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)});
      const data=await response.json();
      if(attempt!==activeAttempt) throw new Error('CANCELLED');
      if(!response.ok){ if(response.status===401 && authenticated) clearSession(); throw new Error(data.error||'Request failed'); }
      return data;
    }catch(error){
      if(error.name==='AbortError') throw new Error('The server took too long to reply. Check the address and connection.');
      if(error instanceof TypeError) throw new Error('Cannot reach the server. Check the address and your connection.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  async function login(attempt){
    const base=attempt.base; if(tokenBase!==base) clearSession();
    if(token){
      try { const me=await json(attempt,'/v1/auth/me',undefined,true); if(attempt===activeAttempt) userId=me.user.id; return; }
      catch(error){ if(error.message!=='UNAUTHORIZED') throw error; }
    }
    const username=$('onlineUser').value.trim(), password=$('onlinePassword').value;
    if(!username || !password) throw new Error('Enter your username and password to sign in.');
    const session=await json(attempt,'/v1/auth/login',{username,password});
    if(attempt!==activeAttempt) return;
    token=session.token; userId=session.user.id; rememberSession(base); $('onlinePassword').value='';
  }
  function isMyTurn(state){ return !!state && (state.activeColors[state.turnIdx]===playerColor || (state.teamMode && TEAM_OF[state.activeColors[state.turnIdx]]===TEAM_OF[playerColor])); }
  function canPlay(){ return ready && game && game.players.length===game.state.activeColors.length && pending.size===0; }
  function applyGame(next){
    if(!next || next.id!==gameId || (game && next.state.version<game.state.version)) return;
    if(game && next.state.version!==game.state.version) clearMoveChoice();
    game=next;
    const seat=game.players.find(p=>p.userId===userId); if(seat) playerColor=seat.color;
    bridge.applyServerGame(next,playerColor); $('onlineGameBar').hidden=false; $('roomCode').value=gameId;
    $('roomRoster').textContent=game.players.map(p=>p.color+(p.userId===userId?' (you)':'')).join(' · ');
    if(game.players.length<game.state.activeColors.length) status('Waiting for players · '+game.players.length+'/'+game.state.activeColors.length+' joined. Share the room code.',true);
    else status(ready?'Connected · You are '+playerColor:'Connecting…',true);
    if(window.HOKApp) window.HOKApp.refresh();
  }
  function rejectPending(reason){
    for(const item of pending.values()){ clearTimeout(item.timer); item.reject(new Error(reason)); }
    pending.clear();
  }
  function settle(message){
    const item=pending.get(message.commandId); if(!item) return;
    pending.delete(message.commandId); clearTimeout(item.timer);
    if(message.type==='ERROR') item.reject(new Error(message.error)); else item.resolve(message);
  }
  function connect(){
    if(!token || !gameId || intentionalClose) return;
    const url=new URL(roomBase); url.protocol=url.protocol==='https:'?'wss:':'ws:'; url.pathname='/v1/realtime';
    const current=new WebSocket(url.toString()); socket=current; ready=false;
    current.addEventListener('open',()=>{if(current===socket && !intentionalClose) current.send(JSON.stringify({type:'AUTH',token}));});
    current.addEventListener('message',event=>{
      if(current!==socket) return;
      let message; try { message=JSON.parse(event.data); } catch(_) { return; }
      if(message.type==='AUTHENTICATED') current.send(JSON.stringify({type:'SUBSCRIBE',gameId}));
      else if(['GAME_STATE','GAME_STATE_UPDATED','COMMAND_RESULT'].includes(message.type)){
        ready=true; reconnectDelay=500; if(message.game) applyGame(message.game); settle(message); maybeAdvanceTurn();
        if(message.events && window.HOKApp){
          if(message.events.killed || message.events.reachedHome) window.HOKApp.effect(message.events.killed?'capture':'home',playerColor);
          else if(message.dice===6) window.HOKApp.effect('six',playerColor);
        }
      }else if(message.type==='ERROR'){
        settle(message); status(message.error);
        if(message.error==='UNAUTHORIZED'){ intentionalClose=true; clearSession(); openLobby(); }
        else if(message.error==='STATE_VERSION_CONFLICT') current.send(JSON.stringify({type:'REQUEST_STATE'}));
      }
      if(window.HOKApp) window.HOKApp.refresh();
    });
    current.addEventListener('close',event=>{
      if(current!==socket) return;
      socket=null; ready=false; clearMoveChoice(); rejectPending('CONNECTION_LOST');
      if(event.code===4001){ intentionalClose=true; clearSession(); openLobby(); status('UNAUTHORIZED'); }
      if(!intentionalClose){ status('CONNECTION_LOST'); clearTimeout(reconnectTimer); reconnectTimer=setTimeout(connect,reconnectDelay); reconnectDelay=Math.min(8000,reconnectDelay*2); }
      if(window.HOKApp) window.HOKApp.refresh();
    });
    current.addEventListener('error',()=>{if(current===socket) status('Cannot reach the game server. Retrying…');});
  }
  function send(command,input={}){
    if(!ready || !socket || socket.readyState!==WebSocket.OPEN) return Promise.reject(new Error('CONNECTION_LOST'));
    if(pending.size) return Promise.reject(new Error('COMMAND_PENDING'));
    const commandId=crypto.randomUUID();
    const message={type:'COMMAND',gameId,command,commandId,expectedVersion:bridge.getState().version,...input};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ pending.delete(commandId); reject(new Error('Connection timed out. Reconnecting to check your move.')); socket.close(); },12000);
      pending.set(commandId,{resolve,reject,timer}); socket.send(JSON.stringify(message));
      if(window.HOKApp) window.HOKApp.refresh();
    });
  }
  function maybeAdvanceTurn(){
    const state=bridge.getState(), current=socket;
    if(!canPlay() || !state || state.gameOver || !isMyTurn(state) || state.phase!=='moving') return;
    if(state.pendingRolls.length && state.pendingRolls.every(die=>computeMovable(die).length===0)) send('PASS_TURN').catch(error=>reportCommandError(error,current));
    else if(!state.pendingRolls.length) send('END_TURN').catch(error=>reportCommandError(error,current));
  }
  async function start(create,rejoin=false){
    if(busy) return; let attempt;
    try{
      attempt=beginAttempt(); await login(attempt); if(attempt!==activeAttempt) return; let result;
      if(create){
        const count=Number($('onlinePlayers').value);
        const colors=count===2?['red','yellow']:count===3?['red','green','yellow']:['red','green','yellow','blue'];
        result=await json(attempt,'/v1/games',{activeColors:colors,mode:'multi',teamMode:count===4 && $('onlineTeam').checked},true);
      }else{
        const code=$('onlineGameId').value.trim(); if(!code) throw new Error('Paste a room code to join.');
        result=await json(attempt,'/v1/games/'+encodeURIComponent(code)+(rejoin?'/state':'/join'),rejoin?undefined:($('onlineColor').value?{color:$('onlineColor').value}:{}),true);
      }
      if(attempt!==activeAttempt) return;
      disconnect(); bridge.leave(); game=null; gameId=result.game.id; playerColor=result.game.players.find(p=>p.userId===userId).color;
      roomBase=attempt.base;
      $('onlineGameId').value=gameId; savedRoom={gameId,baseUrl:roomBase}; saveLocal('hok_online_room',JSON.stringify(savedRoom)); $('onlineResume').hidden=false;
      root.hidden=true; applyGame(result.game); intentionalClose=false; connect();
    }catch(error){if(!attempt || attempt===activeAttempt) status(error.message);}
    finally{if(attempt===activeAttempt){activeAttempt=null;setBusy(false);}}
  }
  async function register(){
    if(busy) return; let attempt;
    try{
      attempt=beginAttempt();
      const result=await json(attempt,'/v1/auth/register',{username:$('onlineUser').value.trim(),password:$('onlinePassword').value});
      if(attempt!==activeAttempt) return;
      token=result.token; userId=result.user.id; rememberSession(attempt.base); $('onlinePassword').value=''; status('Account created. Create a room or join your friends.',true);
    }catch(error){if(!attempt || attempt===activeAttempt) status(error.message);}
    finally{if(attempt===activeAttempt){activeAttempt=null;setBusy(false);}}
  }
  function disconnect(){
    intentionalClose=true; ready=false; clearTimeout(reconnectTimer); clearMoveChoice(); rejectPending('CONNECTION_LOST');
    const old=socket; socket=null; if(old) old.close();
  }
  function leave(){
    disconnect(); game=null; gameId=''; bridge.leave(); closeLobby(); $('onlineGameBar').hidden=true;
  }
  function openLobby(){ root.hidden=false; if(!$('onlineBaseUrl').value){ $('connectionSettings').open=true; status('Choose AI or local play now. Online rooms need a game server address.'); } $('onlineUser').focus(); }
  function closeLobby(){ cancelAttempt(); root.hidden=true; }
  function reportCommandError(error,current){ if(!intentionalClose && current===socket) status(error.message); }
  async function move(option){
    if(!canPlay()) return;
    const current=socket;
    try{
      const state=bridge.getState();
      if(option.rollIdx!==state.selectedRollIdx || state.dice!==state.pendingRolls[option.rollIdx]) await send('SELECT_DIE',{rollIndex:option.rollIdx});
      if(current!==socket || !canPlay() || !isMyTurn(bridge.getState())) return;
      await send('MOVE_PIECE',{pieceIds:option.pieceIds,kind:option.kind});
    }catch(error){reportCommandError(error,current);}
  }
  function clearMoveChoice(){ const choice=$('onlineMoveChoice'); if(choice) choice.remove(); }
  function choose(options){
    clearMoveChoice();
    const current=socket, version=game && game.state.version;
    const overlay=document.createElement('div'); overlay.id='onlineMoveChoice'; overlay.className='appModal';
    const card=document.createElement('div'); card.className='modalCard';
    const title=document.createElement('h2'); title.textContent='Choose your move'; card.appendChild(title);
    options.forEach(option=>{
      const button=document.createElement('button'); button.className='moveChoice';
      button.textContent=(option.kind==='stack'?'Judwa pair':'Single piece')+' · '+option.steps+' steps · die '+bridge.getState().pendingRolls[option.rollIdx];
      button.onclick=()=>{const active=overlay.isConnected;overlay.remove();if(active && current===socket && game && game.state.version===version) move(option);}; card.appendChild(button);
    });
    const cancel=document.createElement('button'); cancel.className='textButton'; cancel.textContent='Cancel'; cancel.onclick=()=>overlay.remove(); card.appendChild(cancel);
    overlay.appendChild(card); document.body.appendChild(overlay);
  }
  window.onDiceClick=function(color){
    if(!bridge.isOnline()) return localDiceClick.apply(this,arguments);
    const state=bridge.getState(), current=socket;
    if(!canPlay() || !isMyTurn(state) || color!==state.activeColors[state.turnIdx] || state.phase!=='rolling' || !state.canRoll || state.gameOver) return;
    send('ROLL_DICE').catch(error=>reportCommandError(error,current));
  };
  window.onPieceClick=function(pid){
    if(!bridge.isOnline()) return localPieceClick.apply(this,arguments);
    if(!canPlay() || !isMyTurn(bridge.getState())) return;
    const options=bridge.getMoveOptions(pid); if(options.length===1) move(options[0]); else if(options.length>1) choose(options);
  };
  window.HOKOnlineController={send,move,choose,leave,openLobby,closeLobby,canPlay,isMyTurn,isLobbyOpen:()=>!root.hidden};
  $('onlineCreate').onclick=()=>start(true); $('onlineJoin').onclick=()=>start(false); $('onlineRegister').onclick=register;
  $('onlineClose').onclick=closeLobby; $('onlineOffline').onclick=()=>{leave();backToSetup();}; $('modeOnlineBtn').onclick=openLobby;
  $('onlineLogout').onclick=()=>{cancelAttempt();disconnect();clearSession();status('Signed out.');};
  $('onlineResume').onclick=()=>{if(savedRoom){$('onlineBaseUrl').value=savedRoom.baseUrl;$('onlineGameId').value=savedRoom.gameId;start(false,true);}};
  $('onlinePlayers').onchange=()=>{if($('onlinePlayers').value!=='4') $('onlineTeam').checked=false;};
  $('copyRoomBtn').onclick=async()=>{try{await navigator.clipboard.writeText(gameId);status('Room code copied.',true);}catch(_){$('roomCode').select();status('Select and copy the room code above.',true);}};
  if(params.get('online')==='1') openLobby();
})();
