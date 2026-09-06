'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/page');

const SAVE_KEY = 'hok_offline_v1';

function checkedPage(t, options) {
  const page = loadPage(options);
  t.after(() => {
    try {
      assert.deepEqual(page.errors.map(error => error.message), [], 'No shipped script errors');
    } finally {
      page.close();
    }
  });
  return page;
}

function startLocal(page, mode = 'multi') {
  page.document.getElementById(mode === 'multi' ? 'modeMultiBtn' : 'modeSingleBtn').click();
  if (mode === 'single') page.document.querySelector('#spYourColorBoard [data-color="green"]').click();
  assert.equal(page.document.getElementById('startBtn').disabled, false);
  page.document.getElementById('startBtn').click();
  assert.ok(page.state());
}

function roll(page, value) {
  const button = page.document.getElementById('rollAction');
  assert.equal(button.disabled, false, 'The player must be able to roll');
  page.state().devForceRoll = value;
  button.click();
  page.advance(500);
}

function goHome(page) {
  page.document.getElementById('homeBtn').click();
  assert.equal(page.document.getElementById('homeDialog').hidden, false);
  page.document.getElementById('leaveBtn').click();
  assert.equal(page.document.getElementById('homeDialog').hidden, true);
  assert.equal(page.document.getElementById('setup').style.display, 'block');
  assert.equal(page.state(), null);
}

function startDiceLesson(page) {
  page.document.getElementById('learnBtn').click();
  page.document.getElementById('tutorialNextBtn').click();
  page.document.getElementById('tutorialNextBtn').click();
  assert.equal(page.window.eval('currentTutorialStep().id'), 'yourTurn');
  assert.equal(page.window.eval('tutorialState.waitingForAction'), true);
}

test('Play offline from the online lobby preserves dice and piece controls', t => {
  const page = loadPage({ query: '?online=1' });
  t.after(() => page.close());
  page.document.getElementById('onlineOffline').click();
  page.document.getElementById('modeMultiBtn').click();
  page.document.getElementById('startBtn').click();
  page.state().devForceRoll = 6;
  page.document.querySelector('.cornerDice[data-color="red"]').click();
  page.advance(500);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6]);
  page.state().devForceRoll = 1;
  page.document.querySelector('.cornerDice[data-color="red"]').click();
  page.advance(500);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(300);
  assert.equal(page.state().pieces.find(p => p.id === 'red0').relPos, 1);
  assert.equal(page.state().pendingRolls[0], 1);
  assert.equal(page.errors.length, 0, page.errors.map(e => e.message).join('\n'));
});

test('AI can take its turn after dismissing the online lobby', t => {
  const page = loadPage({ query: '?online=1' });
  t.after(() => page.close());
  page.document.getElementById('onlineOffline').click();
  page.document.getElementById('modeSingleBtn').click();
  page.document.querySelector('#spYourColorBoard [data-color="green"]').click();
  page.document.getElementById('startBtn').click();
  page.state().devForceRoll = 6;
  page.advance(1200);
  assert.ok(page.state().rollHistory.length > 0, 'Red AI should have rolled');
  assert.equal(page.errors.length, 0, page.errors.map(e => e.message).join('\n'));
});

for (const players of [2,3,4]) test('local setup starts a '+players+'-player game with working controls', t => {
  const page=loadPage(); t.after(()=>page.close());
  assert.equal(page.document.getElementById('onlineLobby').hidden,true);
  page.document.getElementById('modeMultiBtn').click();
  page.window.choosePlayerCount(players);
  if(players<4) ['red','green','yellow'].slice(0,players).forEach(color=>page.window.toggleColorPick(color));
  page.document.getElementById('startBtn').click();
  assert.equal(page.state().pieces.length,players*4);
  page.state().devForceRoll=6;
  page.document.getElementById('rollAction').click(); page.advance(500);
  assert.equal(page.state().dice,6);
  assert.equal(page.errors.length,0,page.errors.map(e=>e.message).join('\n'));
});

test('home navigation cancels an old roll and offline resume restores the completed move', t => {
  const page=loadPage();t.after(()=>page.close());
  page.document.getElementById('modeMultiBtn').click();page.document.getElementById('startBtn').click();
  page.state().devForceRoll=6;page.document.getElementById('rollAction').click();page.advance(500);
  page.state().devForceRoll=1;page.document.getElementById('rollAction').click();page.advance(500);
  page.document.querySelector('.piece[data-pid="red0"]').click();page.advance(300);
  page.document.getElementById('homeBtn').click();page.document.getElementById('leaveBtn').click();
  assert.equal(page.state(),null);
  page.document.getElementById('resumeBtn').click();
  assert.equal(page.state().pieces[0].relPos,1);
  assert.deepEqual(Array.from(page.state().pendingRolls),[1]);
  page.window.backToSetup();page.window.selectMode('multi');page.window.startGame();
  page.state().devForceRoll=6;page.document.getElementById('rollAction').click();
  page.window.backToSetup();page.window.selectMode('multi');page.window.startGame();page.advance(600);
  assert.equal(page.state().rollHistory.length,0,'An old roll must not enter the new match');
  assert.equal(page.errors.length,0,page.errors.map(e=>e.message).join('\n'));
});

test('all AI mode advances, and language and sound controls remain usable', t => {
  const page=loadPage();t.after(()=>page.close());
  page.window.setLanguage('hi');assert.match(page.document.getElementById('modeSingleBtn').textContent,/AI/);
  page.window.setLanguage('te');assert.match(page.document.getElementById('modeMultiBtn').textContent,/కలిసి/);
  page.document.getElementById('soundBtn').click();assert.equal(page.window.HOKApp.soundEnabled(),false);
  page.window.setLanguage('en');page.document.getElementById('modeAllAiBtn').click();page.document.getElementById('startBtn').click();
  let randomSeed=9123;
  page.window.Math.random=()=>{randomSeed=(randomSeed*1664525+1013904223)>>>0;return randomSeed/4294967296;};
  page.advance(15000);
  assert.ok(page.state().pieces.some(p=>p.relPos>0),'AI must move pieces, not just roll');
  assert.equal(page.errors.length,0,page.errors.map(e=>e.message).join('\n'));
});

for (const query of ['', '?online=1']) test('tutorial rolls six and three, then exits a piece through real controls: ' + (query || 'offline home'), t => {
  const page = checkedPage(t, { query });
  if (query) page.document.getElementById('onlineOffline').click();
  startDiceLesson(page);
  const dice = page.document.querySelector('.cornerDice[data-color="yellow"]');
  assert.equal(dice.getAttribute('aria-disabled'), 'false');
  dice.click();
  assert.equal(page.state().canRoll, false);
  page.advance(500);
  assert.deepEqual(Array.from(page.state().rollHistory), [6]);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6]);
  assert.equal(page.window.eval('currentTutorialStep().id'), 'yourTurn');

  // The lesson supplies the second roll; do not bypass it with devForceRoll.
  assert.equal(page.document.getElementById('rollAction').disabled, false);
  page.document.getElementById('rollAction').click();
  page.advance(500);
  assert.deepEqual(Array.from(page.state().rollHistory), [6, 3]);
  assert.equal(page.window.eval('currentTutorialStep().id'), 'entering');
  assert.equal(page.state().dice, 6);
  const piece = page.document.querySelector('.piece[data-pid="yellow0"]');
  assert.ok(piece.classList.contains('movable'));
  piece.click();
  assert.equal(page.state().animating, true);
  page.advance(180);
  assert.equal(page.state().pieces[0].relPos, 1, 'The six exits the yard before the next lesson replaces the board');
  assert.deepEqual(Array.from(page.state().pendingRolls), [3]);
  page.advance(1);
  assert.equal(page.window.eval('currentTutorialStep().id'), 'moving');
  assert.equal(page.window.localStorage.getItem(SAVE_KEY), null, 'Tutorial actions must not create an offline save');
  page.document.getElementById('tutorialSkipBtn').click();
  assert.equal(page.window.eval('tutorialState.active'), false);
  assert.equal(page.document.getElementById('setup').style.display, 'block');
});

for (const stage of ['thinking', 'rolling', 'moving']) test('Home during AI ' + stage + ' cannot change a new local match', t => {
  const page = checkedPage(t);
  startLocal(page, 'single');
  assert.equal(page.state().humanColor, 'green');
  assert.equal(page.document.getElementById('rollAction').disabled, true);
  page.state().devForceRoll = 6;
  if (stage === 'rolling') {
    page.advance(300);
    assert.equal(page.state().canRoll, false);
    assert.equal(page.document.querySelector('.cornerDice[data-color="red"]').classList.contains('rolling'), true);
  } else if (stage === 'moving') {
    page.advance(730); // AI delay + completed six.
    page.state().devForceRoll = 1;
    page.advance(980); // Second roll and the AI's move delay; yard exit is still pending.
    assert.equal(page.state().animating, true);
    assert.deepEqual(Array.from(page.state().pendingRolls), [6, 1]);
  }
  goHome(page);
  startLocal(page);
  const newMatch = JSON.stringify(page.state());
  page.advance(2500);
  assert.equal(JSON.stringify(page.state()), newMatch, 'Old AI timers must not roll, move, or advance the replacement match');
  assert.equal(page.document.querySelectorAll('.piece.hopping, .cornerDice.rolling').length, 0);
  roll(page, 6);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6], 'The new match still accepts player input');
});

for (const stage of ['yard exit', 'board hop']) test('Home during a ' + stage + ' resumes the last completed action and can finish the move', t => {
  const page = checkedPage(t);
  startLocal(page);
  roll(page, 6);
  roll(page, 3);
  if (stage === 'board hop') {
    page.document.querySelector('.piece[data-pid="red0"]').click();
    page.advance(180);
    assert.equal(page.state().pieces[0].relPos, 1);
  }
  const saved = page.window.localStorage.getItem(SAVE_KEY);
  const beforeMove = JSON.parse(saved).state;
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(60); // Enter the animation, before it commits the move.
  assert.equal(page.state().animating, true);
  if (stage === 'board hop') assert.ok(page.document.querySelector('.piece.hopping'));
  goHome(page);
  page.advance(1500);
  assert.equal(page.state(), null, 'The move callback must be harmless while home has no board state');
  assert.equal(page.window.localStorage.getItem(SAVE_KEY), saved, 'Do not persist an incomplete move');
  assert.equal(page.document.querySelectorAll('.piece.hopping').length, 0);
  page.document.getElementById('resumeBtn').click();
  assert.equal(page.state().animating, false);
  assert.deepEqual(Array.from(page.state().pendingRolls), beforeMove.pendingRolls);
  assert.equal(page.state().pieces[0].relPos, beforeMove.pieces[0].relPos);
  const piece = page.document.querySelector('.piece[data-pid="red0"]');
  assert.ok(piece.classList.contains('movable'), 'Resume must rebuild actionable pieces');
  piece.click();
  page.advance(1000);
  assert.equal(page.state().pieces[0].relPos, stage === 'yard exit' ? 1 : 4);
  assert.deepEqual(Array.from(page.state().pendingRolls), stage === 'yard exit' ? [3] : []);
  assert.equal(page.state().animating, false);
});

for (const stage of ['rolling', 'moving']) test('fresh page resumes a saved ' + stage + ' turn with working controls', t => {
  const original = checkedPage(t);
  startLocal(original);
  original.window.setLanguage('hi');
  roll(original, 6);
  if (stage === 'moving') {
    roll(original, 1);
    original.document.querySelector('.piece[data-pid="red0"]').click();
    original.advance(180);
  } else {
    original.state().devForceRoll = 5;
    original.document.getElementById('rollAction').click();
    original.advance(100);
    assert.equal(original.state().canRoll, false);
  }
  original.window.dispatchEvent(new original.window.Event('pagehide'));
  const saved = original.window.localStorage.getItem(SAVE_KEY);
  assert.equal(JSON.parse(saved).state.devForceRoll, null);
  const page = checkedPage(t, { beforeParse(window) { window.localStorage.setItem(SAVE_KEY, saved); } });
  assert.equal(page.document.getElementById('resumeBtn').hidden, false);
  page.document.getElementById('resumeBtn').click();
  assert.equal(page.document.getElementById('game').style.display, 'block');
  assert.equal(page.window.eval('currentLang'), 'hi');
  assert.equal(page.state().phase, stage);
  assert.equal(page.state().animating, false);
  assert.equal(page.state().turnIdx, 0);
  assert.deepEqual(Array.from(page.state().pendingRolls), stage === 'rolling' ? [6] : [1]);
  if (stage === 'rolling') {
    roll(page, 1);
    page.document.querySelector('.piece[data-pid="red0"]').click();
    page.advance(180);
  }
  assert.equal(page.state().pieces[0].relPos, 1);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(300);
  assert.equal(page.state().pieces[0].relPos, 2);
  assert.equal(page.state().turnIdx, 1);
  assert.equal(page.document.getElementById('rollAction').disabled, false);
  assert.equal(JSON.parse(page.window.localStorage.getItem(SAVE_KEY)).state.pieces[0].relPos, 2);
});

test('fresh page resumes an AI move, finishes both dice, and hands control to the human', t => {
  const original = checkedPage(t);
  startLocal(original, 'single');
  original.state().devForceRoll = 6;
  original.advance(730);
  original.state().devForceRoll = 1;
  original.advance(730);
  assert.equal(original.state().phase, 'moving');
  goHome(original);
  const saved = original.window.localStorage.getItem(SAVE_KEY);
  const page = checkedPage(t, { beforeParse(window) { window.localStorage.setItem(SAVE_KEY, saved); } });
  page.document.getElementById('resumeBtn').click();
  assert.equal(page.document.getElementById('rollAction').disabled, true);
  page.advance(1500);
  assert.equal(page.state().pieces.filter(piece => piece.color === 'red' && piece.relPos === 2).length, 1);
  assert.equal(page.state().turnIdx, page.state().activeColors.indexOf('green'));
  assert.deepEqual(Array.from(page.state().pendingRolls), []);
  assert.equal(page.state().animating, false);
  roll(page, 6);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6]);
});

test('skipping the tutorial then backgrounding preserves the saved offline match', t => {
  const page = checkedPage(t);
  startLocal(page);
  roll(page, 6);
  roll(page, 1);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(180);
  goHome(page);
  const saved = page.window.localStorage.getItem(SAVE_KEY);
  startDiceLesson(page);
  page.document.getElementById('tutorialSkipBtn').click();
  page.window.dispatchEvent(new page.window.Event('pagehide'));
  assert.equal(page.window.localStorage.getItem(SAVE_KEY), saved, 'The one-player tutorial must never replace the saved real match');
  page.document.getElementById('resumeBtn').click();
  assert.equal(page.document.getElementById('game').style.display, 'block');
  assert.equal(page.state().pieces[0].relPos, 1);
  assert.deepEqual(Array.from(page.state().pendingRolls), [1]);
});

test('skipping the tutorial welcome card returns home and allows a playable local game', t => {
  const page = checkedPage(t);
  assert.equal(page.state(), null);
  page.document.getElementById('learnBtn').click();
  assert.equal(page.window.eval('currentTutorialStep().id'), 'welcome');
  page.document.getElementById('tutorialSkipBtn').click();
  assert.equal(page.document.getElementById('setup').style.display, 'block');
  assert.equal(page.document.getElementById('game').style.display, 'none');
  assert.equal(page.window.eval('tutorialState.active'), false);
  startLocal(page);
  roll(page, 6);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6]);
});

for (const corruption of ['invalid JSON', 'null piece']) test('a saved game with ' + corruption + ' cannot break the new-game dice button', t => {
  let saved = '{';
  if (corruption === 'null piece') {
    const original = checkedPage(t);
    startLocal(original);
    const snapshot = JSON.parse(original.window.localStorage.getItem(SAVE_KEY));
    snapshot.state.pieces[0] = null;
    saved = JSON.stringify(snapshot);
  }
  const page = checkedPage(t, { beforeParse(window) { window.localStorage.setItem(SAVE_KEY, saved); } });
  assert.equal(page.document.getElementById('resumeBtn').hidden, true, 'Invalid saves must not be offered for resume');
  startLocal(page);
  roll(page, 6);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6], 'Invalid storage must not disable the primary dice control');
  assert.equal(page.document.getElementById('homeBtn').hidden, false);
});
