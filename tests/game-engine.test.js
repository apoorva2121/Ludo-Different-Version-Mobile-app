'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  freshState, globalIndex, squareKey, legalMoves, applyMove, resumeAfterBonus, selectPendingRoll, roll, endTurn, assertValidState
} = require('../game/engine');

function stateWithRedTurn() {
  const state = freshState({ activeColors: ['red', 'green'] });
  state.dice = 6;
  state.phase = 'moving';
  state.canRoll = false;
  state.pendingRolls = [6];
  return state;
}

test('board mapping preserves the four entry points and safe squares', () => {
  assert.equal(globalIndex('red', 1), 0);
  assert.equal(globalIndex('green', 1), 13);
  assert.equal(globalIndex('yellow', 1), 26);
  assert.equal(globalIndex('blue', 1), 39);
  assert.equal(squareKey('red', 1), 'T0');
  assert.equal(squareKey('red', 52), 'Hred0');
});

test('a six can exit one piece from the yard', () => {
  const state = stateWithRedTurn();
  const moves = legalMoves(state, 6);
  assert.equal(moves.length, 4);
  assert.equal(moves[0].isExit, true);
});

test('a non-six cannot exit a piece from the yard', () => {
  const state = stateWithRedTurn();
  assert.deepEqual(legalMoves(state, 5), []);
});

test('applyMove rejects a forged destination and accepts a legal intent', () => {
  const state = stateWithRedTurn();
  const forged = applyMove(state, { pieceIds: ['red0'], kind: 'single', steps: 99, newPosition: 25 });
  assert.equal(forged.error, 'INVALID_MOVE');

  const accepted = applyMove(state, { pieceIds: ['red0'], kind: 'single' });
  assert.equal(accepted.events.accepted, true);
  assert.equal(accepted.state.pieces.find((piece) => piece.id === 'red0').relativePosition, 1);
});

test('a stack only moves on an even die and moves half the rolled distance', () => {
  const state = stateWithRedTurn();
  state.pieces[0].relativePosition = 10;
  state.pieces[1].relativePosition = 10;
  assert.equal(legalMoves(state, 3).some((move) => move.kind === 'stack'), false);
  const stackMove = legalMoves(state, 4).find((move) => move.kind === 'stack');
  assert.deepEqual(stackMove.pieceIds, ['red0', 'red1']);
  assert.equal(stackMove.steps, 2);
});

test('a blocking stack prevents crossing', () => {
  const state = stateWithRedTurn();
  state.pieces[0].relativePosition = 10;
  state.pieces[1].relativePosition = 10;
  state.pieces[2].relativePosition = 8;
  assert.equal(legalMoves(state, 4).some((move) => move.pieceIds.includes('red2')), false);
});

test('a roll of six grants another roll and three sixes cancel the run', () => {
  let state = freshState({ activeColors: ['red', 'green'] });
  let result = roll(state, () => 0.99);
  state = result.state;
  assert.equal(result.value, 6);
  assert.equal(result.events.extraRoll, true);
  result = roll(state, () => 0.99);
  state = result.state;
  result = roll(state, () => 0.99);
  assert.equal(result.events.tripleSixCancelled, true);
  assert.deepEqual(result.state.pendingRolls, []);
});

test('turn end clears pending dice and advances to the next active color', () => {
  const state = freshState({ activeColors: ['red', 'green'] });
  state.pendingRolls = [4];
  state.rollHistory = [4];
  const next = endTurn(state);
  assert.equal(next.turnIndex, 1);
  assert.deepEqual(next.pendingRolls, []);
  assert.equal(next.phase, 'rolling');
});

test('capture and finish bonuses return the same turn to rolling phase', () => {
  const state = stateWithRedTurn();
  state.pieces[0].relativePosition = 10;
  const destinationGlobal = globalIndex('red', 12);
  state.pieces[4].relativePosition = ((destinationGlobal - 13 + 52) % 52) + 1;
  state.dice = 2;
  state.pendingRolls = [2];
  const result = applyMove(state, { pieceIds: ['red0'], kind: 'single' });
  assert.equal(result.events.killed, true);
  const resumed = resumeAfterBonus(result.state);
  assert.equal(resumed.phase, 'rolling');
  assert.equal(resumed.canRoll, true);
});

test('pending dice selection changes only the selected server die', () => {
  const state = stateWithRedTurn();
  state.pendingRolls = [6, 4];
  state.dice = 6;
  const result = selectPendingRoll(state, 1);
  assert.equal(result.error, undefined);
  assert.equal(result.state.dice, 4);
  assert.equal(result.state.selectedRollIndex, 1);
  assert.deepEqual(result.state.pendingRolls, [6, 4]);
});

test('finishing a color is detected and eventually ends the game', () => {
  const state = stateWithRedTurn();
  state.pieces.forEach((piece) => { if (piece.color === 'red') piece.relativePosition = 57; });
  state.pieces.find((piece) => piece.id === 'red0').relativePosition = 56;
  state.dice = 1;
  state.pendingRolls = [1];
  const result = applyMove(state, { pieceIds: ['red0'], kind: 'single' });
  assert.deepEqual(result.state.finishOrder, ['red', 'green']);
  assert.equal(result.events.finishedColor, 'red');
  assert.equal(result.state.gameOver, true);
});

test('state validation rejects impossible state shapes', () => {
  assert.throws(() => assertValidState({}), /INVALID_STATE_SCHEMA/);
  assertValidState(freshState());
});
