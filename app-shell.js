(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const saveKey='hok_offline_v1';
  function read(key){try{return localStorage.getItem(key);}catch(_){return null;}}
  function write(key,value){try{localStorage.setItem(key,value);}catch(_){}}
  let sound=read('hok_sound')!=='off';
  let saved=null;
  try{saved=JSON.parse(read(saveKey));}catch(_){}
  function validSaved(value){
    const s=value && value.state;
    return s && ['single','multi'].includes(s.mode) && Array.isArray(s.activeColors) && s.activeColors.length>=2 && s.activeColors.length<=4
      && new Set(s.activeColors).size===s.activeColors.length && s.activeColors.every(c=>COLORS.includes(c))
      && Number.isInteger(s.turnIdx) && s.turnIdx>=0 && s.turnIdx<s.activeColors.length
      && ['rolling','moving'].includes(s.phase) && Array.isArray(s.pendingRolls) && s.pendingRolls.every(d=>Number.isInteger(d)&&d>=1&&d<=6)
      && Array.isArray(s.pieces) && s.pieces.length===s.activeColors.length*4 && s.pieces.every(p=>p && typeof p==='object')
      && new Set(s.pieces.map(p=>p.id)).size===s.pieces.length
      && s.activeColors.every(c=>[0,1,2,3].every(i=>s.pieces.some(p=>p.id===c+i&&p.color===c)))
      && s.pieces.every(p=>Number.isInteger(p.relPos)&&p.relPos>=0&&p.relPos<=57)
      && Array.isArray(s.finishOrder) && Array.isArray(s.rollHistory);
  }
  if(!validSaved(saved)) saved=null;
  document.querySelectorAll('.cornerDice').forEach(dice=>{
    const card=document.createElement('div'); card.className='playerCard'; card.dataset.player=dice.dataset.color;
    dice.parentNode.insertBefore(card,dice); card.appendChild(dice);
    const caption=document.createElement('div'); caption.className='playerCaption';
    caption.innerHTML='<strong></strong><span></span>'; card.appendChild(caption);
  });
  const copy={
    en:{modes:[['Play AI','Your move. Their challenge.'],['Pass & Play','Friends, one phone.'],['Watch AI','Let the rivals play.'],['Play Online','Join friends in a room.']],note:'AI and local games work without internet. No login needed.',learn:'New here? Learn Kiran’s rules →',resume:'Continue last offline game',roll:'Roll dice',move:'Tap a glowing piece',wait:'Waiting for players / connection',thinking:'AI is thinking…',other:'Waiting for the other player',done:'Game complete',home:'Home',soundOn:'Sound on',soundOff:'Sound off'},
    hi:{modes:[['AI के साथ खेलें','आपकी चाल, उनकी चुनौती।'],['साथ में खेलें','दोस्त, एक फ़ोन।'],['AI को देखें','AI की टक्कर देखें।'],['ऑनलाइन खेलें','दोस्तों के कमरे में जुड़ें।']],note:'AI और लोकल गेम बिना इंटरनेट और लॉगिन के खेलें।',learn:'नए हैं? किरण के नियम सीखें →',resume:'पिछला ऑफलाइन गेम जारी रखें',roll:'पासा फेंकें',move:'चमकती गोटी चुनें',wait:'खिलाड़ियों / कनेक्शन का इंतज़ार',thinking:'AI सोच रहा है…',other:'दूसरे खिलाड़ी की बारी',done:'खेल समाप्त',home:'होम',soundOn:'आवाज़ चालू',soundOff:'आवाज़ बंद'},
    te:{modes:[['AIతో ఆడండి','మీ ఎత్తు, వారి సవాలు.'],['కలిసి ఆడండి','స్నేహితులు, ఒక ఫోన్.'],['AI ఆట చూడండి','AI పోటీని చూడండి.'],['ఆన్‌లైన్ ఆడండి','స్నేహితుల గదిలో చేరండి.']],note:'AI, లోకల్ ఆటలకు ఇంటర్నెట్ లేదా లాగిన్ అవసరం లేదు.',learn:'కొత్తవారా? కిరణ్ నియమాలు నేర్చుకోండి →',resume:'మునుపటి ఆఫ్‌లైన్ ఆట కొనసాగించండి',roll:'పాచిక వేయండి',move:'మెరిసే గోటి ఎంచుకోండి',wait:'ఆటగాళ్లు / కనెక్షన్ కోసం వేచి ఉంది',thinking:'AI ఆలోచిస్తోంది…',other:'ఇతర ఆటగాడి వంతు',done:'ఆట ముగిసింది',home:'హోమ్',soundOn:'శబ్దం ఆన్',soundOff:'శబ్దం ఆఫ్'}
  };
  function refresh(){
    const labels=copy[currentLang]||copy.en;
    ['modeSingleBtn','modeMultiBtn','modeAllAiBtn','modeOnlineBtn'].forEach((id,i)=>{
      $(id).querySelector('strong').textContent=labels.modes[i][0]; $(id).querySelector('small').textContent=labels.modes[i][1];
    });
    $('offlineNote').textContent=labels.note; $('learnBtn').textContent=labels.learn;
    $('resumeBtn').textContent=labels.resume; $('resumeBtn').hidden=!saved;
    $('soundBtn').textContent=sound?labels.soundOn:labels.soundOff; $('soundBtn').setAttribute('aria-pressed',String(sound));
    $('homeBtn').textContent=labels.home;
    const playing=$('game').style.display==='block' && !!state;
    $('homeBtn').hidden=!playing;
    const online=window.HOKOnlineBridge.isOnline();
    const own=playing && (online ? window.HOKOnlineController.isMyTurn(state) : !isBotColor(currentColor()));
    const connected=!online || window.HOKOnlineController.canPlay();
    const canRoll=playing && own && connected && state.canRoll && state.phase==='rolling' && !state.animating && !state.gameOver;
    $('rollAction').disabled=!canRoll;
    $('rollAction').textContent=!playing?labels.roll:state.gameOver?labels.done:!connected?labels.wait:!own?(online?labels.other:labels.thinking):state.phase==='moving'?labels.move:labels.roll;
    $('revertBtn').hidden=online || !!tutorialState.active;
    if(playing) document.querySelectorAll('.cornerDice').forEach(el=>{
      const enabled=el.dataset.color===currentColor() && canRoll;
      el.setAttribute('aria-disabled',String(!enabled));
      el.classList.toggle('myTurn',enabled);
      const card=el.closest('.playerCard'), color=el.dataset.color;
      card.classList.toggle('turnActive',color===currentColor() && !state.gameOver);
      card.classList.toggle('seatInactive',!state.activeColors.includes(color));
      card.style.setProperty('--player-color',COLOR_HEX[color]);
      const role=state.humanColor===color?' · You':isBotColor(color)?' · AI':'';
      card.querySelector('strong').textContent=dispName(color)+role;
      const home=state.pieces.filter(p=>p.color===color && p.relPos===57).length;
      card.querySelector('.playerCaption span').textContent='⌂ '+home+'/4   ·   ⚑ '+((state.captureCounts||{})[color]||0);
    });
  }
  function remember(){
    if(!state || window.HOKOnlineBridge.isOnline() || tutorialState.active || state.animating || (state.phase==='rolling' && !state.canRoll)) return;
    if(!validSaved({state})) return;
    const snapshot=JSON.parse(JSON.stringify(state));
    snapshot.log=(snapshot.log||[]).slice(-80); snapshot.devForceRoll=null; delete snapshot.lastAIDecision;
    saved={state:snapshot,language:currentLang}; write(saveKey,JSON.stringify(saved));
  }
  function resume(){
    if(!validSaved(saved)) return;
    window.HOKOnlineController.leave();
    state=Object.assign(freshState(saved.state.teamMode,saved.state.activeColors),JSON.parse(JSON.stringify(saved.state)),{animating:false,devForceRoll:null});
    if(state.phase==='rolling') state.canRoll=true;
    turnSnapshot=null;
    if(autoPlayTimer){clearTimeout(autoPlayTimer);autoPlayTimer=null;}
    if(copy[saved.language]) setLanguage(saved.language);
    $('setup').style.display='none'; $('game').style.display='block'; $('menuBtn').style.display='inline-block';
    buildBoardDom(); state.finishOrder.forEach((c,i)=>markYardRank(c,i+1)); renderLog();
    if(state.gameOver){renderAll();showFinalRankings();}
    else if(state.phase==='moving') presentRollChoice();
    else {renderAll();updateStatus(t('turn',dispName(currentColor())),t('tapDice'));}
    refresh();
  }
  const leaveDialog=document.createElement('div'); leaveDialog.id='homeDialog'; leaveDialog.className='appModal'; leaveDialog.hidden=true;
  leaveDialog.setAttribute('role','dialog'); leaveDialog.setAttribute('aria-modal','true'); leaveDialog.setAttribute('aria-labelledby','homeTitle');
  leaveDialog.innerHTML='<div class="modalCard"><span class="eyebrow">TAKE A BREATHER</span><h2 id="homeTitle">Back to home?</h2><p id="homeHint"></p><div class="onlineActions"><button id="stayBtn">Keep playing</button><button id="leaveBtn" class="primaryButton">Go home</button></div></div>';
  document.body.appendChild(leaveDialog);
  function goHome(){
    if(tutorialState.active){skipTutorial();refresh();return;}
    if(!state){backToSetup();return;}
    $('homeHint').textContent=window.HOKOnlineBridge.isOnline()?'Your room code is saved so you can rejoin. Other players will wait for your turn.':'Your last completed action is saved. Continue this game from the home screen.';
    leaveDialog.hidden=false; $('stayBtn').focus();
  }
  function handleBack(){
    if(!leaveDialog.hidden){leaveDialog.hidden=true;return true;}
    if(window.HOKOnlineController.isLobbyOpen()){window.HOKOnlineController.closeLobby();return true;}
    const choice=$('onlineMoveChoice'); if(choice){choice.remove();return true;}
    for(const id of ['advRulesOverlay','restartOverlay','diceChoiceOverlay','actionOverlay','devOverlay']){
      if($(id).style.display==='flex'){
        // A dice selection is required to continue the local turn.
        if(id==='diceChoiceOverlay') goHome(); else $(id).style.display='none';
        return true;
      }
    }
    if($('game').style.display==='block'){goHome();return true;}
    return false;
  }
  function effect(kind,color){
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if(kind==='six'){
      const board=$('boardWrap'); board.classList.remove('sixShake'); void board.offsetWidth; board.classList.add('sixShake');
      setTimeout(()=>board.classList.remove('sixShake'),280);
    }
    if(kind==='capture' || kind==='home'){
      const board=$('board');
      const burst=document.createElement('div'); burst.className='celebration '+kind; burst.style.setProperty('--effect-color',COLOR_HEX[color]);
      for(let i=0;i<12;i++){const dot=document.createElement('i');dot.style.setProperty('--angle',(i*30)+'deg');burst.appendChild(dot);}
      board.appendChild(burst); setTimeout(()=>burst.remove(),750);
    }
  }
  $('stayBtn').onclick=()=>{leaveDialog.hidden=true;};
  $('leaveBtn').onclick=()=>{leaveDialog.hidden=true;backToSetup();refresh();};
  $('homeBtn').onclick=goHome; $('resumeBtn').onclick=resume;
  $('soundBtn').onclick=()=>{sound=!sound;write('hok_sound',sound?'on':'off'); if(!sound && actx) actx.suspend(); refresh();};
  $('rollAction').onclick=()=>{if(!state || $('rollAction').disabled)return;onDiceClick(currentColor());refresh();};
  document.querySelectorAll('.cornerDice,.langSeg,.pickCorner,.switch').forEach(el=>{
    el.tabIndex=0; el.setAttribute('role','button');
    if(el.classList.contains('cornerDice')) el.setAttribute('aria-label','Roll '+el.dataset.color+' dice');
    if(el.classList.contains('switch')) el.setAttribute('aria-label','Toggle team mode');
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && handleBack())event.preventDefault();});
  window.addEventListener('pagehide',remember);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)remember();});
  window.HOKApp={refresh,remember,resume,goHome,handleBack,effect,soundEnabled:()=>sound,onStateChange:()=>{remember();refresh();}};
  refresh();
})();
