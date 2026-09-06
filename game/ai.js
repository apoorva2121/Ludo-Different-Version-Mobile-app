'use strict';

const engine = require('./engine');

const WEIGHTS = Object.freeze({
  sprinter: { finish: 140, progress: 3, stack: 12, safe: 22, kill: 95 },
  bruiser: { finish: 85, progress: 2, stack: 18, safe: 8, kill: 190 },
  blocker: { finish: 75, progress: 2, stack: 48, safe: 18, kill: 120 },
  claude: { finish: 105, progress: 3, stack: 24, safe: 18, kill: 145 }
});

function destination(move, state) {
  const piece = state.pieces.find((item) => item.id === move.pieceIds[0]);
  return piece ? (move.isExit ? 1 : piece.relativePosition + move.steps) : 0;
}

function scoreMove(state, move, profile = 'claude') {
  const weights = WEIGHTS[profile] || WEIGHTS.claude;
  const next = engine.applyMove(state, move);
  if (next.error) return Number.NEGATIVE_INFINITY;
  const dest = destination(move, state);
  const events = next.events;
  let score = dest * weights.progress;
  if (dest === 57) score += weights.finish;
  if (move.kind === 'stack') score += weights.stack;
  if (dest >= 1 && dest <= 51 && engine.SAFE_SET.has(engine.globalIndex(move.color, dest))) score += weights.safe;
  if (events.killed) score += weights.kill;
  return score;
}

function chooseMove(state, profile = 'claude') {
  const candidates = [];
  const diceValues = state.pendingRolls.length ? state.pendingRolls : (state.dice ? [state.dice] : []);
  diceValues.forEach((dice, rollIndex) => {
    const candidateState = engine.cloneState(state);
    candidateState.dice = dice;
    candidateState.selectedRollIndex = rollIndex;
    for (const move of engine.legalMoves(candidateState, dice)) {
      candidates.push({ move, rollIndex, score: scoreMove(candidateState, move, profile) });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.rollIndex - b.rollIndex || a.move.pieceIds.join(',').localeCompare(b.move.pieceIds.join(',')));
  return candidates[0] || null;
}

module.exports = { WEIGHTS, scoreMove, chooseMove };

