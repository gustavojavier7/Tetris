// bot.worker.js - Worker de IA para Tetris con modos SURVIVAL/ATTACK y Fast-Fail

const COLS = 12;
const ROWS = 22;
const EMPTY = -1;
const CHIMNEY_COL = 11;

const TETROMINOS = {
  I: [[[1, 1, 1, 1]], [[1], [1], [1], [1]]],
  O: [[[1, 1], [1, 1]]],
  T: [
    [[0, 1, 0], [1, 1, 1]],
    [[1, 0], [1, 1], [1, 0]],
    [[1, 1, 1], [0, 1, 0]],
    [[0, 1], [1, 1], [0, 1]]
  ],
  S: [[[0, 1, 1], [1, 1, 0]], [[1, 0], [1, 1], [0, 1]]],
  Z: [[[1, 1, 0], [0, 1, 1]], [[0, 1], [1, 1], [1, 0]]],
  J: [
    [[1, 0, 0], [1, 1, 1]],
    [[1, 1], [1, 0], [1, 0]],
    [[1, 1, 1], [0, 0, 1]],
    [[0, 1], [0, 1], [1, 1]]
  ],
  L: [
    [[0, 0, 1], [1, 1, 1]],
    [[1, 0], [1, 0], [1, 1]],
    [[1, 1, 1], [1, 0, 0]],
    [[1, 1], [0, 1], [0, 1]]
  ]
};

const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

class BoardAnalyzer {
  static validate(board) {
    return Array.isArray(board) && board.length === ROWS && board.every(r => Array.isArray(r) && r.length === COLS);
  }

  static buildMetrics(board) {
    const heights = Array(COLS).fill(0);
    const holesByColumn = Array(COLS).fill(0);

    for (let x = 0; x < COLS; x++) {
      let seenBlock = false;
      for (let y = 0; y < ROWS; y++) {
        const cell = board[y][x];
        if (cell !== EMPTY) {
          if (!seenBlock) {
            heights[x] = ROWS - y;
            seenBlock = true;
          }
        } else if (seenBlock) {
          holesByColumn[x]++;
        }
      }
    }

    const totalHoles = holesByColumn.reduce((a, b) => a + b, 0);
    const maxHeight = heights.reduce((a, b) => Math.max(a, b), 0);
    const bumpiness = heights.slice(0, COLS - 1).reduce((acc, h, idx) => acc + Math.abs(h - heights[idx + 1]), 0);

    return { heights, holesByColumn, totalHoles, maxHeight, bumpiness };
  }

  static hasLeftSideHole(metrics) {
    return metrics.holesByColumn.slice(0, CHIMNEY_COL).some(h => h > 0);
  }

  static isPerfect(metrics) {
    return metrics.totalHoles === 0;
  }
}

self.onmessage = function (e) {
  const { type, board, currentTypeId, nextTypeId, requestId } = e.data;
  if (type === 'THINK') {
    const decision = think(board, currentTypeId, nextTypeId);
    self.postMessage({ type: 'DECISION', ...decision, requestId });
  }
};

function think(board, currentTypeId, nextTypeId) {
  if (!BoardAnalyzer.validate(board) || currentTypeId === null || currentTypeId === undefined) {
    console.warn('[AGENT][worker] Fast-Fail: datos inválidos para pensar.');
    return { ghost: null, mode: 'SURVIVAL' };
  }

  const pieceKey = PIECE_TYPES[currentTypeId];
  const shapes = TETROMINOS[pieceKey];
  if (!shapes) {
    console.warn('[AGENT][worker] Fast-Fail: tipo de pieza desconocido.');
    return { ghost: null, mode: 'SURVIVAL' };
  }

  const preMetrics = BoardAnalyzer.buildMetrics(board);
  const survivalMode = preMetrics.totalHoles > 0 || BoardAnalyzer.hasLeftSideHole(preMetrics);
  const attackMode = BoardAnalyzer.isPerfect(preMetrics);
  const mode = attackMode ? 'ATTACK' : survivalMode ? 'SURVIVAL' : 'SURVIVAL';

  let best = null;

  shapes.forEach((matrix, rotation) => {
    const width = matrix[0].length;
    for (let x = -1; x <= COLS - width + 1; x++) {
      const y = findLandingY(matrix, board, x);
      if (y === null) continue;

      const simulation = simulatePlacement(matrix, board, x, y, currentTypeId);
      if (!simulation) {
        console.warn('[AGENT][worker] Fast-Fail: simulación inválida, candidato descartado.');
        continue;
      }

      const postMetrics = BoardAnalyzer.buildMetrics(simulation.board);
      const holesReduced = preMetrics.totalHoles - postMetrics.totalHoles;
      const placement = {
        linesCleared: simulation.linesCleared,
        holesReduced,
        holesAfter: postMetrics.totalHoles,
        maxHeightAfter: postMetrics.maxHeight,
        bumpinessAfter: postMetrics.bumpiness,
        chimneyCover: simulation.chimneyCover,
        rotation,
        x,
        y,
        matrix
      };

      let score = attackMode
        ? scoreAttack(placement)
        : scoreSurvival(placement, preMetrics, nextTypeId);

      if (pieceKey === 'I' && placement.linesCleared === 4) {
        score += 1_000_000_000;
      }

      if (!best || score > best.score || (score === best.score && placement.linesCleared > best.linesCleared)) {
        best = { ...placement, score };
      }
    }
  });

  if (!best) return { ghost: null, mode };

  const ghost = {
    typeId: currentTypeId,
    matrix: best.matrix,
    rotation: best.rotation,
    x: best.x,
    y: best.y
  };

  return { ghost, mode };
}

function findLandingY(matrix, board, x) {
  let y = -matrix.length;
  while (!collides(matrix, board, x, y + 1)) {
    y++;
    if (y > ROWS) return null;
  }
  if (collides(matrix, board, x, y)) return null;
  return y;
}

function collides(matrix, board, px, py) {
  for (let ry = 0; ry < matrix.length; ry++) {
    for (let rx = 0; rx < matrix[ry].length; rx++) {
      if (!matrix[ry][rx]) continue;
      const nx = px + rx;
      const ny = py + ry;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx] !== EMPTY) return true;
    }
  }
  return false;
}

function simulatePlacement(matrix, board, px, py, typeId) {
  if (!matrix || !Array.isArray(matrix) || !Array.isArray(board)) {
    console.warn('[AGENT][worker] Fast-Fail: datos inválidos para simular tablero.');
    return null;
  }

  const clone = board.map(row => [...row]);
  let chimneyCover = 0;

  for (let dy = 0; dy < matrix.length; dy++) {
    for (let dx = 0; dx < matrix[dy].length; dx++) {
      if (!matrix[dy][dx]) continue;
      const ny = py + dy;
      const nx = px + dx;
      if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) {
        console.warn('[AGENT][worker] Fast-Fail: proyección fuera de los límites del tablero.');
        return null;
      }
      if (clone[ny][nx] !== EMPTY) {
        console.warn('[AGENT][worker] Fast-Fail: colisión inesperada durante simulación.');
        return null;
      }
      clone[ny][nx] = typeId;
      if (nx === CHIMNEY_COL) chimneyCover++;
    }
  }

  let linesCleared = 0;
  const remaining = [];
  for (let y = 0; y < ROWS; y++) {
    if (clone[y].every(cell => cell !== EMPTY)) {
      linesCleared++;
    } else {
      remaining.push(clone[y]);
    }
  }

  while (remaining.length < ROWS) {
    remaining.unshift(Array(COLS).fill(EMPTY));
  }

  return { board: remaining, linesCleared, chimneyCover };
}

function scoreAttack(placement) {
  // En modo ataque, el tablero debe mantenerse inmaculado (sin huecos)
  if (placement.holesAfter > 0) return -Infinity;

  // REGLA DE CHIMENEA:
  // Si tapamos la chimenea (cover > 0) Y NO hacemos Tetris (lines < 4), es ilegal.
  // Pero si lines == 4, permitimos la cobertura (es un Tetris válido).
  if (placement.chimneyCover > 0 && placement.linesCleared < 4) {
    return -1_000_000;
  }

  const heightPenalty = placement.maxHeightAfter * 20;
  const bumpinessPenalty = placement.bumpinessAfter * 5;
  // Incentivo alto para preparar o ejecutar Tetris
  const lineReward = placement.linesCleared * 10000;

  return lineReward - heightPenalty - bumpinessPenalty;
}

function scoreSurvival(placement, preMetrics, nextTypeId) {
  const heightPenalty = placement.maxHeightAfter * 8;
  const bumpinessPenalty = placement.bumpinessAfter * 2;
  const holePenalty = placement.holesAfter * 1200;
  const holeReward = Math.max(0, placement.holesReduced) * 2000;
  const lineReward = placement.linesCleared * 2500;

  let chimneySupport = 0;
  if (placement.chimneyCover > 0) {
    // Sin protección de chimenea en SURVIVAL, pero premiamos si reduce altura global
    const preMaxHeight = preMetrics.maxHeight;
    if (placement.maxHeightAfter < preMaxHeight) chimneySupport = 300;
  }

  return lineReward + holeReward + chimneySupport - holePenalty - heightPenalty - bumpinessPenalty;
}
