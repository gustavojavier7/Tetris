// bot.worker.js - Worker de IA para Tetris

const COLS = 12;
const ROWS = 22;

const TETROMINOS = {
  I: [[[1,1,1,1]], [[1],[1],[1],[1]]],
  O: [[[1,1],[1,1]]],
  T: [[[0,1,0],[1,1,1]], [[1,0],[1,1],[1,0]], [[1,1,1],[0,1,0]], [[0,1],[1,1],[0,1]]],
  S: [[[0,1,1],[1,1,0]], [[1,0],[1,1],[0,1]]],
  Z: [[[1,1,0],[0,1,1]], [[0,1],[1,1],[1,0]]],
  J: [[[1,0,0],[1,1,1]], [[1,1],[1,0],[1,0]], [[1,1,1],[0,0,1]], [[0,1],[0,1],[1,1]]],
  L: [[[0,0,1],[1,1,1]], [[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]]]
};

const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

class GeometricEvaluator {
  static findHuecos(board) {
    const huecos = [];
    for (let top = 0; top < ROWS; top++) {
      for (let h = 2; h <= 5 && top + h <= ROWS; h++) {
        for (let left = 0; left < COLS; left++) {
          for (let w = 1; w <= 4 && left + w <= COLS; w++) {
            if (this.isValidHueco(board, top, left, h, w)) {
              huecos.push({top, left, h, w, area: h * w});
            }
          }
        }
      }
    }
    return huecos.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  static isValidHueco(board, top, left, h, w) {
    for (let y = top; y < top + h; y++) {
      for (let x = left; x < left + w; x++) {
        if (board[y][x] !== -1) return false;
      }
    }

    for (let x = left; x < left + w; x++) {
      for (let y = 0; y < top; y++) {
        if (board[y][x] !== -1) return false;
      }
    }

    const touchesLeftWall  = (left === 0);
    const touchesRightWall = (left + w === COLS);

    const leftSupport  = touchesLeftWall  || this.hasVerticalSupport(board, left - 1, top, h);
    const rightSupport = touchesRightWall || this.hasVerticalSupport(board, left + w, top, h);
    return leftSupport && rightSupport;
  }

  static hasVerticalSupport(board, col, top, h) {
    if (col < 0 || col >= COLS) return false;
    for (let y = top; y < top + h; y++) {
      if (board[y][col] === -1) return false;
    }
    return true;
  }

  static countAgujerosCanonicos(board) {
    let holes = 0;
    let depthSum = 0;

    for (let x = 0; x < COLS; x++) {
      let y = 0;
      while (y < ROWS) {
        while (y < ROWS && board[y][x] !== -1) y++;
        if (y >= ROWS) break;

        const yStart = y;
        while (y < ROWS && board[y][x] === -1) y++;
        const yEnd = y - 1;

        const baseOk = (yEnd + 1 < ROWS) && (board[yEnd + 1][x] !== -1);
        const roofOk = (yStart > 0) && (board[yStart - 1][x] !== -1);

        if (baseOk && roofOk) {
          holes++;
          depthSum += (yEnd - yStart + 1);
        }
      }
    }

    return { holes, depthSum };
  }

  static calculateCL(matrix, px, py, board) {
    let cl = 0;
    const h = matrix.length;
    const w = matrix[0].length;
    for (let ry = 0; ry < h; ry++) {
      const gy = py + ry;
      if (gy < 0 || gy >= ROWS) continue;

      for (let rx = 0; rx < w; rx++) {
        if (matrix[ry][rx]) {
          if (rx === 0 || matrix[ry][rx - 1] || px + rx - 1 < 0 || board[gy][px + rx - 1] !== -1) cl++;
          if (rx === w - 1 || matrix[ry][rx + 1] || px + rx + 1 >= COLS || board[gy][px + rx + 1] !== -1) cl++;
        }
      }
    }
    return cl;
  }

  static getShapeFit(pieceArea, hueco) {
    return hueco ? pieceArea / hueco.area : 0;
  }

  static buildHuecoMask(huecos) {
    const mask = Array.from({length: ROWS}, () => Array(COLS).fill(false));
    for (const hu of huecos) {
      for (let y = hu.top; y < hu.top + hu.h; y++) {
        for (let x = hu.left; x < hu.left + hu.w; x++) {
          mask[y][x] = true;
        }
      }
    }
    return mask;
  }

  static countPlacedInHuecos(matrix, px, py, huecoMask) {
    let c = 0;
    for (let ry = 0; ry < matrix.length; ry++) {
      for (let rx = 0; rx < matrix[ry].length; rx++) {
        if (!matrix[ry][rx]) continue;
        const y = py + ry, x = px + rx;
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS && huecoMask[y][x]) c++;
      }
    }
    return c;
  }
}

self.onmessage = function(e) {
  const { type, board, currentTypeId, nextTypeId, requestId } = e.data;
  if (type === 'THINK') {
    const ghost = think(board, currentTypeId, nextTypeId);
    self.postMessage({ type: 'DECISION', ghost, requestId });
  }
};

function think(board, currentTypeId, nextTypeId) {
  if (!Array.isArray(board) || currentTypeId === null || currentTypeId === undefined) {
    console.warn('[AGENT][worker] Fast-Fail: datos inválidos para pensar.');
    return null;
  }

  const shapes = TETROMINOS[PIECE_TYPES[currentTypeId]];
  if (!shapes) return null;

  const pre = GeometricEvaluator.countAgujerosCanonicos(board);
  const huecos = GeometricEvaluator.findHuecos(board);

  let maxHeight = 0;
  for (let cx = 0; cx < COLS; cx++) {
    for (let cy = 0; cy < ROWS; cy++) {
      if (board[cy][cx] !== -1) {
        maxHeight = Math.max(maxHeight, ROWS - cy);
        break;
      }
    }
  }

  let lowestHueco = null;
  for (const h of huecos) {
    const yEnd = h.top + h.h - 1;
    if (!lowestHueco ||
        yEnd > (lowestHueco.top + lowestHueco.h - 1) ||
        (yEnd === (lowestHueco.top + lowestHueco.h - 1) && h.left < lowestHueco.left)) {
      lowestHueco = h;
    }
  }
  const huecoMask = GeometricEvaluator.buildHuecoMask(huecos);

  const better = (a, b) => {
    if (!a) return false;
    if (!b) return true;

    if (a.lines !== b.lines) return a.lines > b.lines;
    if (a.deltaHoles !== b.deltaHoles) return a.deltaHoles < b.deltaHoles;
    if (a.cl !== b.cl) return a.cl > b.cl;

    if (lowestHueco && a.lines === 0 && b.lines === 0) {
      if (a.y !== b.y) return a.y > b.y;
    }

    if (a.huecoFill !== b.huecoFill) return a.huecoFill > b.huecoFill;
    if (a.y !== b.y) return a.y > b.y;
    if (a.depthSum !== b.depthSum) return a.depthSum < b.depthSum;

    return false;
  };

  let bestCandidate = null;

  shapes.forEach((shapeMatrix, rotationIdx) => {
    const width = shapeMatrix[0].length;

    for (let x = -1; x <= COLS - width + 1; x++) {
      let y = 0;
      while (!collides(shapeMatrix, board, x, y + 1)) {
        y++;
      }

      if (collides(shapeMatrix, board, x, y)) continue;

      const simulation = getSimulatedBoardWithLines(shapeMatrix, board, x, y, currentTypeId);
      if (!simulation) {
        console.warn('[AGENT][worker] Fast-Fail: simulación inválida, candidato descartado.');
        continue;
      }
      const {board: simulatedBoard, linesCleared} = simulation;
      if (linesCleared === 0) {
        const placementHeight = ROWS - y;
        if (placementHeight > maxHeight + 4) continue;
      }

      const cl = GeometricEvaluator.calculateCL(shapeMatrix, x, y, board);
      const post = GeometricEvaluator.countAgujerosCanonicos(simulatedBoard);
      const deltaHoles = post.holes - pre.holes;
      const holesReduced = Math.max(0, pre.holes - post.holes);
      const huecoFill = GeometricEvaluator.countPlacedInHuecos(shapeMatrix, x, y, huecoMask);

      const candidate = {
        lines: linesCleared,
        deltaHoles,
        holesReduced,
        huecoFill,
        cl,
        y,
        depthSum: post.depthSum,
        matrix: shapeMatrix,
        rotation: rotationIdx,
        x
      };

      if (better(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  });

  if (!bestCandidate) return null;

  return {
    typeId: currentTypeId,
    matrix: bestCandidate.matrix,
    rotation: bestCandidate.rotation,
    x: bestCandidate.x,
    y: bestCandidate.y
  };
}

function collides(matrix, board, px, py) {
  for (let ry = 0; ry < matrix.length; ry++) {
    for (let rx = 0; rx < matrix[ry].length; rx++) {
      if (matrix[ry][rx]) {
        const nx = px + rx;
        const ny = py + ry;
        if (nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && board[ny][nx] !== -1)) {
          return true;
        }
      }
    }
  }
  return false;
}

function getSimulatedBoardWithLines(matrix, board, px, py, typeId) {
  if (!matrix || !Array.isArray(matrix) || !Array.isArray(board)) {
    console.warn('[AGENT][worker] Fast-Fail: datos inválidos para simular tablero.');
    return null;
  }

  const clone = board.map(row => [...row]);
  let invalidProjection = false;

  for (let dy = 0; dy < matrix.length; dy++) {
    for (let dx = 0; dx < matrix[dy].length; dx++) {
      if (!matrix[dy][dx]) continue;
      const ny = py + dy;
      const nx = px + dx;
      if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) {
        invalidProjection = true;
        break;
      }
      clone[ny][nx] = typeId;
    }
    if (invalidProjection) break;
  }

  if (invalidProjection) {
    console.warn('[AGENT][worker] Fast-Fail: proyección fuera de los límites del tablero.');
    return null;
  }

  let filtered = clone.filter(row => row.some(cell => cell === -1));
  const linesCleared = ROWS - filtered.length;
  while (filtered.length < ROWS) {
    filtered.unshift(Array(COLS).fill(-1));
  }

  return {board: filtered, linesCleared};
}
