'use strict';

// Pure, transport-agnostic rules engine extracted from the browser prototype.
// The server should own the only live instance of a game state. The client may
// use this module for hints, but must never be trusted with its results.

const COLORS = Object.freeze(['red', 'green', 'yellow', 'blue']);
const TEAM_OF = Object.freeze({ red: 'A', yellow: 'A', green: 'B', blue: 'B' });
const ENTRY = Object.freeze({ red: 0, green: 13, yellow: 26, blue: 39 });
const SAFE_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

function globalIndex(color, relativePosition) {
  return (ENTRY[color] + relativePosition - 1 + 52) % 52;
}

function squareKey(color, relativePosition) {
  if (relativePosition >= 1 && relativePosition <= 51) return `T${globalIndex(color, relativePosition)}`;
  if (relativePosition >= 52 && relativePosition <= 56) return `H${color}${relativePosition - 52}`;
  return null;
}

function freshState({ teamMode = false, activeColors = COLORS, mode = 'multi', humanColor = null, aiDifficulty = {} } = {}) {
  const pieces = [];
  for (const color of activeColors) {
    for (let index = 0; index < 4; index += 1) {
      pieces.push({ id: `${color}${index}`, color, relativePosition: 0 });
    }
  }
  return {
    schemaVersion: 1,
    teamMode: Boolean(teamMode),
    activeColors: [...activeColors],
    mode,
    humanColor,
    aiDifficulty: { ...aiDifficulty },
    pieces,
    turnIndex: 0,
    phase: 'rolling',
    dice: null,
    pendingRolls: [],
    selectedRollIndex: 0,
    rollHistory: [],
    sixStreak: 0,
    canRoll: true,
    frozenKillerId: null,
    killedThisTurn: false,
    finishedThisTurn: false,
    finishOrder: [],
    captureCounts: {},
    gameOver: false,
    version: 0
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function currentColor(state) {
  return state.activeColors[state.turnIndex];
}

function isTeammate(state, colorA, colorB) {
  return state.teamMode && colorA !== colorB && TEAM_OF[colorA] === TEAM_OF[colorB];
}

function isSafeSquare(key) {
  return Boolean(key && key[0] === 'T' && SAFE_SET.has(Number(key.slice(1))));
}

function isUnstackSquare(key) {
  return isSafeSquare(key);
}

function occupancy(state, key) {
  const counts = {};
  for (const piece of state.pieces) {
    if (piece.relativePosition === 0 || piece.relativePosition === 57) continue;
    if (squareKey(piece.color, piece.relativePosition) === key) {
      counts[piece.color] = (counts[piece.color] || 0) + 1;
    }
  }
  return counts;
}

function stackColorAt(state, key) {
  if (isUnstackSquare(key)) return null;
  const counts = occupancy(state, key);
  return Object.keys(counts).find((color) => counts[color] >= 2) || null;
}

function stacksAt(state, key) {
  if (isUnstackSquare(key)) return [];
  const counts = occupancy(state, key);
  return Object.keys(counts).filter((color) => counts[color] >= 2);
}

function pathBlocked(state, color, fromRelative, toRelative) {
  for (let relative = fromRelative + 1; relative < toRelative; relative += 1) {
    const key = squareKey(color, relative);
    if (key && stackColorAt(state, key)) return true;
  }
  return false;
}

function landingAllowed(state, color, destination, moverKind) {
  const key = squareKey(color, destination);
  if (!key) return true;
  const counts = occupancy(state, key);
  const stackColor = stackColorAt(state, key);
  const noCapture = isUnstackSquare(key);

  if (state.teamMode && !noCapture) {
    const teammate = COLORS.find((candidate) => candidate !== color && TEAM_OF[candidate] === TEAM_OF[color]);
    if (teammate && (counts[teammate] || 0) > 0) return false;
  }

  if (!stackColor) {
    if (moverKind === 'single') return (counts[color] || 0) < 2 || noCapture;
    return (counts[color] || 0) === 0 || noCapture;
  }
  if (stackColor === color) return false;
  if (moverKind === 'stack') return true;
  return (counts[color] || 0) <= 1;
}

function canPieceMove(state, piece, steps, kind) {
  if (piece.relativePosition === 0) {
    return steps === 6 && landingAllowed(state, piece.color, 1, 'single');
  }
  const destination = piece.relativePosition + steps;
  if (destination > 57) return false;
  if (destination === 57) return true;
  return !pathBlocked(state, piece.color, piece.relativePosition, destination)
    && landingAllowed(state, piece.color, destination, kind);
}

function movableColors(state) {
  const color = currentColor(state);
  const colors = [color];
  if (state.teamMode) {
    const teammate = COLORS.find((candidate) => candidate !== color && TEAM_OF[candidate] === TEAM_OF[color]);
    if (teammate && state.activeColors.includes(teammate)) colors.push(teammate);
  }
  return colors;
}

function legalMoves(state, diceValue) {
  const dice = diceValue === undefined ? state.dice : diceValue;
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) return [];
  const result = [];

  for (const color of movableColors(state)) {
    const pieces = state.pieces.filter((piece) => piece.color === color && piece.relativePosition !== 57);
    const bySquare = new Map();
    for (const piece of pieces) {
      if (piece.relativePosition === 0) continue;
      const key = squareKey(piece.color, piece.relativePosition);
      if (!key) continue;
      if (!bySquare.has(key)) bySquare.set(key, []);
      bySquare.get(key).push(piece);
    }

    const stackIds = new Set();
    for (const group of bySquare.values()) {
      if (group.length < 2) continue;
      const unit = group.slice(0, 2);
      const key = squareKey(color, unit[0].relativePosition);
      if (!isUnstackSquare(key)) unit.forEach((piece) => stackIds.add(piece.id));
      if (dice % 2 === 0 && canPieceMove(state, unit[0], dice / 2, 'stack')) {
        result.push({ pieceIds: unit.map((piece) => piece.id), color, kind: 'stack', steps: dice / 2 });
      }
    }

    for (const piece of pieces) {
      if (stackIds.has(piece.id) || piece.id === state.frozenKillerId) continue;
      if (piece.relativePosition !== 0) {
        const key = squareKey(piece.color, piece.relativePosition);
        if (stackColorAt(state, key) && stackColorAt(state, key) !== piece.color && (occupancy(state, key)[piece.color] || 0) === 1) continue;
      }
      if (piece.relativePosition === 0) {
        if (dice === 6 && canPieceMove(state, piece, 6, 'single')) {
          result.push({ pieceIds: [piece.id], color, kind: 'single', steps: 6, isExit: true });
        }
      } else if (canPieceMove(state, piece, dice, 'single')) {
        result.push({ pieceIds: [piece.id], color, kind: 'single', steps: dice });
      }
    }
  }
  return result;
}

function validateMove(state, move) {
  if (!move || !Array.isArray(move.pieceIds) || !move.pieceIds.length) return { ok: false, code: 'INVALID_MOVE' };
  if (Object.prototype.hasOwnProperty.call(move, 'newPosition')) return { ok: false, code: 'INVALID_MOVE' };
  const legal = legalMoves(state, state.dice).find((candidate) => candidate.pieceIds.join(',') === move.pieceIds.join(',') && candidate.kind === move.kind);
  if (legal && move.steps !== undefined && move.steps !== legal.steps) return { ok: false, code: 'ILLEGAL_MOVE' };
  return legal ? { ok: true, move: legal } : { ok: false, code: 'ILLEGAL_MOVE' };
}

function applyMove(state, move) {
  if (state.gameOver || state.phase !== 'moving' || state.dice !== state.pendingRolls[state.selectedRollIndex]) {
    return { state, events: [], error: 'MOVE_NOT_ALLOWED' };
  }
  const validation = validateMove(state, move);
  if (!validation.ok) return { state, events: [], error: validation.code };
  const accepted = validation.move;
  const next = cloneState(state);
  const mover = next.pieces.find((piece) => piece.id === accepted.pieceIds[0]);
  const startRelative = mover.relativePosition;
  const startKey = squareKey(accepted.color, startRelative);
  const wasStacked = Boolean(startKey && (occupancy(next, startKey)[accepted.color] || 0) >= 2);
  const destination = accepted.isExit ? 1 : startRelative + accepted.steps;
  for (const pieceId of accepted.pieceIds) next.pieces.find((piece) => piece.id === pieceId).relativePosition = Math.min(destination, 57);

  const events = { accepted: true, killed: false, formedStack: false, brokeStack: false, reachedHome: destination === 57, bonus: false, finishedColor: null };
  if (accepted.kind === 'single' && !accepted.isExit && wasStacked) events.brokeStack = true;

  if (destination !== 57) {
    const key = squareKey(accepted.color, destination);
    if (key) {
      if (accepted.kind === 'single' && !isUnstackSquare(key) && (occupancy(next, key)[accepted.color] || 0) >= 2) events.formedStack = true;
      const ownCount = occupancy(next, key)[accepted.color] || 0;
      const rivalStacks = stacksAt(next, key).filter((color) => color !== accepted.color && !isTeammate(next, accepted.color, color));
      if (ownCount >= 2 && rivalStacks.length) {
        for (const rival of rivalStacks) {
          for (const piece of next.pieces) if (piece.color === rival && squareKey(piece.color, piece.relativePosition) === key) piece.relativePosition = 0;
          events.killed = true;
        }
      } else if (!stacksAt(next, key).length && accepted.kind === 'single' && !SAFE_SET.has(globalIndex(accepted.color, destination))) {
        for (const piece of next.pieces) {
          if (piece.color !== accepted.color && !isTeammate(next, accepted.color, piece.color) && piece.relativePosition > 0 && piece.relativePosition < 57 && squareKey(piece.color, piece.relativePosition) === key) {
            piece.relativePosition = 0;
            events.killed = true;
          }
        }
      }
    }
  }
  if (events.killed) {
    next.frozenKillerId = accepted.pieceIds[0];
    next.killedThisTurn = true;
    events.bonus = true;
  }
  if (events.reachedHome) {
    next.finishedThisTurn = true;
    events.bonus = true;
  }

  const colorPieces = next.pieces.filter((piece) => piece.color === accepted.color);
  if (colorPieces.length && colorPieces.every((piece) => piece.relativePosition === 57) && !next.finishOrder.includes(accepted.color)) {
    next.finishOrder.push(accepted.color);
    events.finishedColor = accepted.color;
    const remaining = next.activeColors.filter((color) => !next.finishOrder.includes(color));
    if (remaining.length <= 1) {
      if (remaining.length === 1) next.finishOrder.push(remaining[0]);
      next.gameOver = true;
    }
  }
  next.pendingRolls.splice(next.selectedRollIndex, 1);
  events.capturedPieces = next.pieces.filter((piece,index) => state.pieces[index].relativePosition > 0 && piece.relativePosition === 0).length;
  next.captureCounts = next.captureCounts || {};
  next.captureCounts[accepted.color] = (next.captureCounts[accepted.color] || 0) + events.capturedPieces;
  next.selectedRollIndex = 0;
  next.dice = next.pendingRolls[0] || null;
  next.version += 1;
  return { state: next, move: accepted, events };
}

function resumeAfterBonus(state) {
  const next = cloneState(state);
  if (next.gameOver || (!next.killedThisTurn && !next.finishedThisTurn)) return next;
  next.killedThisTurn = false;
  next.finishedThisTurn = false;
  next.sixStreak = 0;
  next.phase = 'rolling';
  next.canRoll = true;
  next.dice = null;
  next.version += 1;
  return next;
}

function selectPendingRoll(state, index) {
  if (state.gameOver || state.phase !== 'moving' || !Number.isInteger(index) || index < 0 || index >= state.pendingRolls.length) return { state, error: 'INVALID_ROLL_SELECTION' };
  const next = cloneState(state);
  next.selectedRollIndex = index;
  next.dice = next.pendingRolls[index];
  next.version += 1;
  return { state: next, value: next.dice };
}

function roll(state, random = Math.random) {
  if (state.gameOver || state.phase !== 'rolling' || !state.canRoll) return { state, error: 'ROLL_NOT_ALLOWED' };
  const next = cloneState(state);
  const value = 1 + Math.floor(random() * 6);
  next.dice = value;
  next.rollHistory.push(value);
  next.sixStreak = value === 6 ? next.sixStreak + 1 : 0;
  if (next.sixStreak === 3) {
    next.sixStreak = 0;
    next.pendingRolls = [];
    next.rollHistory = [];
    next.frozenKillerId = null;
    next.phase = 'rolling';
    next.canRoll = true;
    next.version += 1;
    return { state: next, value, events: { tripleSixCancelled: true } };
  }
  next.pendingRolls.push(value);
  if (value === 6) {
    next.canRoll = true;
    next.version += 1;
    return { state: next, value, events: { extraRoll: true } };
  }
  next.phase = 'moving';
  next.canRoll = false;
  next.selectedRollIndex = 0;
  next.dice = next.pendingRolls[0];
  next.version += 1;
  return { state: next, value, events: { movingPhase: true } };
}

function endTurn(state) {
  const next = cloneState(state);
  if (next.gameOver) return next;
  next.frozenKillerId = null;
  next.killedThisTurn = false;
  next.finishedThisTurn = false;
  next.sixStreak = 0;
  next.pendingRolls = [];
  next.rollHistory = [];
  next.selectedRollIndex = 0;
  next.dice = null;
  next.phase = 'rolling';
  next.canRoll = true;
  for (let offset = 1; offset <= next.activeColors.length; offset += 1) {
    const candidate = (next.turnIndex + offset) % next.activeColors.length;
    const color = next.activeColors[candidate];
    const teammate = COLORS.find((item) => item !== color && TEAM_OF[item] === TEAM_OF[color]);
    const retired = next.finishOrder.includes(color) && (!next.teamMode || !teammate || !next.activeColors.includes(teammate) || next.finishOrder.includes(teammate));
    if (!retired) { next.turnIndex = candidate; break; }
  }
  next.version += 1;
  return next;
}

function assertValidState(state) {
  if (!state || state.schemaVersion !== 1) throw new Error('INVALID_STATE_SCHEMA');
  if (!Array.isArray(state.activeColors) || !state.activeColors.length) throw new Error('INVALID_ACTIVE_COLORS');
  if (new Set(state.activeColors).size !== state.activeColors.length) throw new Error('INVALID_ACTIVE_COLORS');
  if (!state.activeColors.every((color) => COLORS.includes(color))) throw new Error('INVALID_COLOR');
  if (state.turnIndex < 0 || state.turnIndex >= state.activeColors.length) throw new Error('INVALID_TURN');
  const ids = new Set();
  const counts = Object.fromEntries(state.activeColors.map((color) => [color, 0]));
  if (!Array.isArray(state.pieces) || !state.pieces.every((piece) => {
    if (ids.has(piece.id)) return false;
    ids.add(piece.id);
    counts[piece.color] = (counts[piece.color] || 0) + 1;
    return state.activeColors.includes(piece.color) && piece.id === `${piece.color}${counts[piece.color] - 1}` && Number.isInteger(piece.relativePosition) && piece.relativePosition >= 0 && piece.relativePosition <= 57;
  })) throw new Error('INVALID_PIECE');
  if (state.activeColors.some((color) => counts[color] !== 4)) throw new Error('INVALID_PIECE_COUNT');
  return true;
}

module.exports = {
  COLORS, TEAM_OF, ENTRY, SAFE_SET,
  globalIndex, squareKey, freshState, cloneState, currentColor,
  occupancy, stackColorAt, stacksAt, legalMoves, validateMove,
  applyMove, resumeAfterBonus, selectPendingRoll, roll, endTurn, assertValidState
};
