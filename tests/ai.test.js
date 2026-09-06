'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../game/engine');
const ai = require('../game/ai');

test('AI returns a legal move from authoritative state', () => {
  const state = engine.freshState({ activeColors: ['red', 'green'] });
  state.phase = 'moving';
  state.canRoll = false;
  state.dice = 6;
  state.pendingRolls = [6];
  const decision = ai.chooseMove(state, 'bruiser');
  assert.ok(decision);
  const result = engine.applyMove(state, decision.move);
  assert.equal(result.error, undefined);
  assert.equal(result.events.accepted, true);
});

test('AI never returns a move when no legal move exists', () => {
  const state = engine.freshState({ activeColors: ['red', 'green'] });
  state.phase = 'moving';
  state.canRoll = false;
  state.dice = 5;
  state.pendingRolls = [5];
  assert.equal(ai.chooseMove(state), null);
});

