'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../game/engine');
const ai=require('../game/ai');
const {GameService}=require('../server/game-service');
const {loadPage}=require('./helpers/page');

function offlineMatch(t) {
  const page = loadPage();
  t.after(() => {
    try {
      assert.deepEqual(page.errors.map(error => error.message), [], 'No shipped script errors');
    } finally {
      page.close();
    }
  });
  page.document.getElementById('modeMultiBtn').click();
  page.document.getElementById('startBtn').click();
  return page;
}

function clickRoll(page, value, selector = '#rollAction') {
  page.state().devForceRoll = value;
  page.document.querySelector(selector).click();
  page.advance(500);
}

test('rolling six then one spends the six first, then the remaining one',()=>{
  let state=engine.freshState();
  state=engine.roll(state,()=>.99).state;
  assert.equal(engine.applyMove(state,{pieceIds:['red0'],kind:'single'}).error,'MOVE_NOT_ALLOWED');
  state=engine.roll(state,()=>0).state;
  assert.equal(state.dice,6);
  state=engine.applyMove(state,{pieceIds:['red0'],kind:'single'}).state;
  assert.equal(state.pieces[0].relativePosition,1);
  assert.equal(state.dice,1);
  state=engine.applyMove(state,{pieceIds:['red0'],kind:'single'}).state;
  assert.equal(state.pieces[0].relativePosition,2);
  assert.equal(state.pendingRolls.length,0);
});

test('capture bonus waits until usable pending dice are spent',()=>{
  const service=new GameService();
  const created=service.createGame({userId:'alice',activeColors:['red','green']});
  service.joinGame({gameId:created.id,userId:'bob',color:'green'});
  const game=service.requireGame(created.id);
  Object.assign(game.state,{phase:'moving',canRoll:false,pendingRolls:[2,1],dice:2});
  game.state.pieces[0].relativePosition=10;
  game.state.pieces[1].relativePosition=20;
  game.state.pieces[4].relativePosition=51; // Green 51 and red 12 share T11.
  let result=service.command({gameId:created.id,userId:'alice',command:'MOVE_PIECE',commandId:'capture-die1',expectedVersion:0,pieceIds:['red0'],kind:'single'});
  assert.equal(result.events.killed,true);
  assert.equal(result.game.state.phase,'moving');
  assert.equal(result.game.state.captureCounts.red,1);
  result=service.command({gameId:created.id,userId:'alice',command:'MOVE_PIECE',commandId:'capture-die2',expectedVersion:result.game.state.version,pieceIds:['red1'],kind:'single'});
  assert.equal(result.game.state.phase,'rolling');
  assert.equal(result.game.state.canRoll,true);
});

test('shipped offline controls spend six then one and enable the next player to roll', t => {
  const page = offlineMatch(t);
  const redDice = page.document.querySelector('.cornerDice[data-color="red"]');
  const greenDice = page.document.querySelector('.cornerDice[data-color="green"]');
  greenDice.click();
  page.advance(500);
  assert.deepEqual(Array.from(page.state().rollHistory), [], 'Another color cannot roll out of turn');
  clickRoll(page, 6, '.cornerDice[data-color="red"]');
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(300);
  assert.equal(page.state().pieces[0].relPos, 0, 'A six must be followed by another roll before moving');
  assert.equal(page.state().canRoll, true);
  clickRoll(page, 1);
  assert.equal(page.state().dice, 6);
  assert.equal(page.document.getElementById('rollAction').disabled, true);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(180);
  assert.equal(page.state().pieces[0].relPos, 1);
  assert.deepEqual(Array.from(page.state().pendingRolls), [1]);
  assert.equal(page.state().dice, 1);
  const piece = page.document.querySelector('.piece[data-pid="red0"]');
  assert.ok(piece.classList.contains('movable'));
  piece.click();
  piece.click(); // A repeated tap must not spend the same die twice.
  page.advance(500);
  assert.equal(page.state().pieces[0].relPos, 2);
  assert.equal(page.state().turnIdx, 1);
  assert.deepEqual(Array.from(page.state().pendingRolls), []);
  assert.equal(redDice.getAttribute('aria-disabled'), 'true');
  assert.equal(greenDice.getAttribute('aria-disabled'), 'false');
  assert.equal(page.document.getElementById('rollAction').disabled, false);
  clickRoll(page, 6, '.cornerDice[data-color="green"]');
  assert.deepEqual(Array.from(page.state().pendingRolls), [6]);
  assert.equal(page.state().turnIdx, 1);
});

test('shipped offline dice choice spends the chosen one before the six without losing either move', t => {
  const page = offlineMatch(t);
  // Put one piece on the track so both dice will be usable independently.
  page.state().pieces[0].relPos = 10;
  page.window.renderAll();
  clickRoll(page, 6);
  clickRoll(page, 1);
  assert.equal(page.document.getElementById('diceChoiceOverlay').style.display, 'flex');
  assert.equal(page.document.querySelectorAll('#diceChoiceList .diceChoiceBtn').length, 2);
  page.document.querySelectorAll('#diceChoiceList .diceChoiceBtn')[1].click();
  assert.equal(page.document.getElementById('diceChoiceOverlay').style.display, 'none');
  assert.equal(page.state().dice, 1);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(300);
  assert.equal(page.state().pieces[0].relPos, 11);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6]);
  assert.equal(page.state().dice, 6);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(1100);
  assert.equal(page.state().pieces[0].relPos, 17);
  assert.deepEqual(Array.from(page.state().pendingRolls), []);
  assert.equal(page.state().turnIdx, 1);
  assert.equal(page.document.getElementById('rollAction').disabled, false);
});

test('shipped offline capture spends the remaining die before unlocking the bonus roll', t => {
  const page = offlineMatch(t);
  // Red 12 and green 51 share T11, which is not a safe square.
  Object.assign(page.state(), { phase: 'moving', canRoll: false, pendingRolls: [2, 1], dice: null });
  page.state().pieces.find(piece => piece.id === 'red0').relPos = 10;
  page.state().pieces.find(piece => piece.id === 'red1').relPos = 20;
  page.state().pieces.find(piece => piece.id === 'green0').relPos = 51;
  page.window.presentRollChoice();
  assert.equal(page.document.getElementById('diceChoiceOverlay').style.display, 'flex');
  page.document.querySelector('#diceChoiceList .diceChoiceBtn').click();
  assert.equal(page.state().dice, 2);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(500);
  assert.equal(page.state().pieces.find(piece => piece.id === 'green0').relPos, 0);
  assert.equal(page.state().pieces[0].relPos, 12);
  assert.equal(page.state().captureCounts.red, 1);
  assert.equal(page.state().frozenKillerId, 'red0');
  assert.deepEqual(Array.from(page.state().pendingRolls), [1]);
  assert.equal(page.state().phase, 'moving');
  assert.equal(page.document.getElementById('rollAction').disabled, true);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(300);
  assert.equal(page.state().pieces[0].relPos, 12, 'The capturing piece is frozen for the rest of this turn');
  assert.deepEqual(Array.from(page.state().pendingRolls), [1]);
  page.document.querySelector('.piece[data-pid="red1"]').click();
  page.advance(300);
  assert.equal(page.state().pieces[1].relPos, 21);
  assert.deepEqual(Array.from(page.state().pendingRolls), []);
  assert.equal(page.state().turnIdx, 0);
  assert.equal(page.state().phase, 'rolling');
  assert.equal(page.document.getElementById('rollAction').disabled, false);
  clickRoll(page, 1);
  assert.equal(page.state().turnIdx, 0);
  assert.deepEqual(Array.from(page.state().pendingRolls), [1]);
  assert.equal(page.state().frozenKillerId, 'red0');
  page.document.querySelector('.piece[data-pid="red1"]').click();
  page.advance(300);
  assert.equal(page.state().pieces[1].relPos, 22);
  assert.equal(page.state().turnIdx, 1);
  assert.equal(page.state().frozenKillerId, null);
});

test('shipped offline rapid dice taps roll once and three sixes allow another roll', t => {
  const page = offlineMatch(t);
  const dice = page.document.querySelector('.cornerDice[data-color="red"]');
  const rollButton = page.document.getElementById('rollAction');
  page.state().devForceRoll = 6;
  dice.click();
  dice.click();
  rollButton.click();
  page.advance(500);
  assert.deepEqual(Array.from(page.state().rollHistory), [6], 'One animation must produce exactly one roll');
  clickRoll(page, 6);
  assert.deepEqual(Array.from(page.state().pendingRolls), [6, 6]);
  clickRoll(page, 6);
  assert.deepEqual(Array.from(page.state().pendingRolls), []);
  assert.deepEqual(Array.from(page.state().rollHistory), []);
  assert.equal(page.state().sixStreak, 0);
  assert.equal(page.state().turnIdx, 0);
  assert.equal(rollButton.disabled, false);
  assert.equal(dice.getAttribute('aria-disabled'), 'false');
  clickRoll(page, 6);
  clickRoll(page, 1);
  page.document.querySelector('.piece[data-pid="red0"]').click();
  page.advance(180);
  assert.equal(page.state().pieces[0].relPos, 1);
  assert.deepEqual(Array.from(page.state().pendingRolls), [1]);
});

for(const teamMode of [false,true]) test('complete seeded AI matches preserve legal state, teams='+teamMode,()=>{
  let seed=teamMode?156:74;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  let state=engine.freshState({teamMode});
  let actions=0;
  while(!state.gameOver && actions++<20000){
    if(state.phase==='rolling') state=engine.roll(state,random).state;
    else{
      const decision=ai.chooseMove(state,['sprinter','bruiser','blocker','claude'][state.turnIndex]);
      if(decision){
        state=engine.selectPendingRoll(state,decision.rollIndex).state;
        const moved=engine.applyMove(state,decision.move);assert.equal(moved.error,undefined);state=moved.state;
      }
      if((state.killedThisTurn || state.finishedThisTurn) && !state.pendingRolls.some(d=>engine.legalMoves(state,d).length)) state=engine.resumeAfterBonus(state);
      else if(!decision) state=engine.endTurn(state);
    }
    engine.assertValidState(state);
  }
  assert.equal(state.gameOver,true,'Match must complete without getting stuck');
  assert.equal(state.finishOrder.length,4);
});
