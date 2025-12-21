// bot.worker.js - Worker de IA para evaluación topológica y planificación de colocaciones

const COLS = 12;
const ROWS = 22;
const EMPTY = -1;
const FULL_MASK = (1 << COLS) - 1;
const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const TETROMINOS = {
  I: [[[1,1,1,1]], [[1],[1],[1],[1]]],
  O: [[[1,1],[1,1]]],
  T: [[[0,1,0],[1,1,1]], [[1,0],[1,1],[1,0]], [[1,1,1],[0,1,0]], [[0,1],[1,1],[0,1]]],
  S: [[[0,1,1],[1,1,0]], [[1,0],[1,1],[0,1]]],
  Z: [[[1,1,0],[0,1,1]], [[0,1],[1,1],[1,0]]],
  J: [[[1,0,0],[1,1,1]], [[1,1],[1,0],[1,0]], [[1,1,1],[0,0,1]], [[0,1],[0,1],[1,1]]],
  L: [[[0,0,1],[1,1,1]], [[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]]]
};

const PIECE_MASKS = buildPieceMasks(TETROMINOS);

class BoardAnalyzer {
  static validate(board) {
    const isIterable = (Array.isArray(board) || ArrayBuffer.isView(board)) && board.length === ROWS;
    if (!isIterable) return false;

    const firstRow = board[0];
    const isMatrix = Array.isArray(firstRow);

    if (isMatrix) {
      return board.every((r) => Array.isArray(r) && r.length === COLS);
    }

    return board.every((cell) => Number.isInteger(cell));
  }
}

self.onmessage = function (e) {
  const { type, board, currentTypeId, nextTypeId, requestId, bagTypeIds } = e.data;
  if (type === 'THINK') {
    const decision = think(board, currentTypeId, nextTypeId, bagTypeIds);
    self.postMessage({ type: 'DECISION', ...decision, requestId });
  }
};

function think(board, currentTypeId, nextTypeId, bagTypeIds) {
  if (!BoardAnalyzer.validate(board)) {
    console.warn('[AGENT][worker] Fast-Fail: datos inválidos para pensar.');
    return { ghost: null, mode: 'UNDEFINED' };
  }

  if (currentTypeId === null || currentTypeId === undefined) {
    console.warn('[AGENT][worker] Fast-Fail: pieza actual no definida.');
    return { ghost: null, mode: 'UNDEFINED' };
  }

  // La física y alcanzabilidad se resuelven fuera del evaluador; aquí solo se observa el tablero consolidado.
  const sequence = Array.isArray(bagTypeIds)
    ? bagTypeIds.filter((id) => id !== null && id !== undefined)
    : [currentTypeId, nextTypeId].filter((id) => id !== null && id !== undefined);

  const planResult = planBestSequence(board, sequence);
  const nextPlacement = planResult?.path?.[0];

  let ghost = null;
  if (nextPlacement && nextPlacement.position) {
    const { x, y, rotation, matrix } = nextPlacement.position;
    const typeId = nextPlacement.typeId;
    if (x !== undefined && y !== undefined && rotation !== undefined && matrix) {
      ghost = { typeId, rotation, x, y, matrix };
    }
  }

  const mode = 'PLANNING';
  return { ghost, mode };
}

// --- API mínima para evaluación topológica ---

function analyzeTopology(board) {
  const visited = new Uint8Array(ROWS * COLS);
  const stackX = new Int16Array(ROWS * COLS);
  const stackY = new Int16Array(ROWS * COLS);

  const bottomProfile = new Int16Array(COLS);
  bottomProfile.fill(-1); // -1 indica que no hay aire detectado aún

  let openArea = 0;
  let openMinY = ROWS;
  let stackSize = 0;

  // --- 1. Flood fill desde el techo: RV abierta ---
  for (let x = 0; x < COLS; x++) {
    if ((board[0] & (1 << x)) === 0 && !visited[x]) {
      visited[x] = 1;
      stackX[stackSize] = x;
      stackY[stackSize] = 0;
      stackSize++;
    }
  }

  while (stackSize) {
    stackSize--;
    const x = stackX[stackSize];
    const y = stackY[stackSize];

    openArea++;
    if (y < openMinY) openMinY = y;
    if (y > bottomProfile[x]) bottomProfile[x] = y; // Guarda la Y más profunda del aire

    // Derecha
    if (x + 1 < COLS) {
      const nx = x + 1;
      const ny = y;
      const idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
    // Izquierda
    if (x - 1 >= 0) {
      const nx = x - 1;
      const ny = y;
      const idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
    // Abajo
    if (y + 1 < ROWS) {
      const nx = x;
      const ny = y + 1;
      const idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
    // Arriba
    if (y - 1 >= 0) {
      const nx = x;
      const ny = y - 1;
      const idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
  }

  const openRV = {
    area: openArea,
    minY: openMinY,
    bottomProfile
  };

  // --- 2. Flood fill de RV cerradas CON CÁLCULO DE SEPULTURA ---
  const closedRVs = [];
  let totalBurial = 0;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const idx = y * COLS + x;
      if ((board[y] & (1 << x)) !== 0 || visited[idx]) continue;

      let area = 0;
      let currentBurial = 0;
      stackSize = 0;
      stackX[stackSize] = x;
      stackY[stackSize] = y;
      visited[idx] = 1;
      stackSize++;

      while (stackSize) {
        stackSize--;
        const cx = stackX[stackSize];
        const cy = stackY[stackSize];
        area++;

        const surfaceY = openRV.bottomProfile[cx];
        const depth = (surfaceY === -1) ? cy : (cy - surfaceY);
        currentBurial += Math.max(0, depth);

        // Derecha
        if (cx + 1 < COLS) {
          const nx = cx + 1;
          const ny = cy;
          const nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
        // Izquierda
        if (cx - 1 >= 0) {
          const nx = cx - 1;
          const ny = cy;
          const nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
        // Abajo
        if (cy + 1 < ROWS) {
          const nx = cx;
          const ny = cy + 1;
          const nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
        // Arriba
        if (cy - 1 >= 0) {
          const nx = cx;
          const ny = cy - 1;
          const nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
      }

      closedRVs.push({ area });
      totalBurial += currentBurial;
    }
  }

  return { openRV, closedRVs, totalBurial };
}

function computeQuadraticHeight(board) {
  if (!board || typeof board.length !== 'number') return 0;

  const isBitBoard = Number.isInteger(board[0]);
  let totalQuadraticHeight = 0;

  for (let x = 0; x < COLS; x++) {
    let colY = ROWS;

    for (let y = 0; y < ROWS; y++) {
      const row = board[y];
      if (row === undefined) break; // Fast-Fail defensivo

      const isSolid = isBitBoard
        ? ((row & (1 << x)) !== 0)
        : (Array.isArray(row) && row[x] !== EMPTY);

      if (isSolid) {
        colY = y;
        break;
      }
    }

    const height = ROWS - colY;
    totalQuadraticHeight += (height * height);
  }

  return totalQuadraticHeight;
}

function computeStateMetrics(topology, board) {
  if (!topology || !topology.openRV) {
    return {
      A_open: 0,
      A_closed_total: 0,
      closed_count: 0,
      geometric: {
        openMinY: ROWS,
        rugosidad: 0
      },
      quadraticHeight: computeQuadraticHeight(board),
      burialScore: 0
    };
  }

  const { openRV, closedRVs, totalBurial } = topology;

  // --- Métricas topológicas básicas ---
  const A_open = openRV.area;

  let A_closed_total = 0;
  for (const rv of closedRVs) {
    A_closed_total += rv.area;
  }

  const closed_count = closedRVs.length;

  // --- Geometría de la RV abierta ---
  const bottomProfile = openRV.bottomProfile;

  let rugosidad = 0;
  for (let x = 0; x < COLS - 1; x++) {
    const h1 = bottomProfile[x];
    const h2 = bottomProfile[x + 1];
    rugosidad += Math.abs(h1 - h2);
  }

  return {
    A_open,
    A_closed_total,
    closed_count,
    geometric: {
      openMinY: openRV.minY,
      rugosidad
    },
    quadraticHeight: computeQuadraticHeight(board),
    burialScore: totalBurial
  };
}

function planBestSequence(board, bagTypeIds) {
  // CONFIGURACIÓN (Reversión a modelo lineal)
  const BEAM_WIDTH = 25;

  // 1. ALTURA DOMINANTE
  const HEIGHT_WEIGHT = 1.0;

  // 2. RUGOSIDAD BALANCEADA
  const RUGOSIDAD_WEIGHT = 0.4;

  // 3. IMPUESTO A HUECOS
  const CLOSED_WEIGHT = 2.0;

  // 4. SEPULTURA LINEAL
  const BURIAL_WEIGHT = 0.5;

  const OPEN_WEIGHT = 0.05;

  if (!BoardAnalyzer.validate(board)) {
    return { deltaAopen: 0, finalRugosidad: 0, path: [] };
  }

  const baseBoard = Array.isArray(board?.[0]) ? toBitBoard(board) : board;

  const sequence = Array.isArray(bagTypeIds)
    ? bagTypeIds.filter((id) => id !== null && id !== undefined)
    : [];

  if (sequence.length === 0) return { path: [] };

  const topology0 = analyzeTopology(baseBoard);
  const metrics0 = computeStateMetrics(topology0, baseBoard);
  const A0 = metrics0?.A_open ?? 0;

  // Estado inicial
  let candidates = [{
    board: baseBoard,
    path: [],
    A_open: A0,
    rugosidad: metrics0?.geometric?.rugosidad ?? 0,
    A_closed: metrics0?.A_closed_total ?? 0,
    quadraticHeight: metrics0?.quadraticHeight ?? 0,
    openMinY: metrics0?.geometric?.openMinY ?? ROWS,
    burialScore: metrics0?.burialScore ?? 0
  }];

  const evaluateScore = (candidate) => {
    const heightCost = candidate.quadraticHeight * HEIGHT_WEIGHT;
    const rugoCost = candidate.rugosidad * RUGOSIDAD_WEIGHT;
    const closedCost = candidate.A_closed * CLOSED_WEIGHT;
    const burialCost = candidate.burialScore * BURIAL_WEIGHT;
    const openRelief = candidate.A_open * OPEN_WEIGHT;
    return heightCost + rugoCost + closedCost + burialCost - openRelief;
  };

  // Bucle de planificación
  for (let i = 0; i < sequence.length; i++) {
    const currentTypeId = sequence[i];
    const nextCandidates = [];
    const visitedHashes = new Set();

    for (const candidate of candidates) {
      const placements = generatePlacements(candidate.board, currentTypeId);

      for (const placement of placements) {
        const nextBoard = simulatePlacementAndClearLines(candidate.board, placement);
        if (!nextBoard) continue;

        const h = hashBitBoard(nextBoard);
        if (visitedHashes.has(h)) continue;
        visitedHashes.add(h);

        const topology = analyzeTopology(nextBoard);
        const metrics = computeStateMetrics(topology, nextBoard);
        
        nextCandidates.push({
          board: nextBoard,
          path: [...candidate.path, placement],
          A_open: metrics.A_open,
          rugosidad: metrics.geometric.rugosidad,
          A_closed: metrics.A_closed_total,
          quadraticHeight: metrics.quadraticHeight,
          openMinY: metrics.geometric.openMinY,
          burialScore: metrics.burialScore
        });
      }
    }

    if (nextCandidates.length === 0) break;

    // --- LÓGICA DE PRIORIDADES HÍBRIDA ---
    nextCandidates.sort((a, b) => {
      const scoreA = evaluateScore(a);
      const scoreB = evaluateScore(b);

      if (scoreA !== scoreB) return scoreA - scoreB;
      if (a.quadraticHeight !== b.quadraticHeight) return a.quadraticHeight - b.quadraticHeight;
      if (a.rugosidad !== b.rugosidad) return a.rugosidad - b.rugosidad;
      if (a.A_closed !== b.A_closed) return a.A_closed - b.A_closed;
      return b.A_open - a.A_open;
    });

    candidates = nextCandidates.slice(0, BEAM_WIDTH);
  }

  const best = candidates[0];
  if (!best) return { path: [] };

  return {
    path: best.path,
    deltaAopen: best.A_open - A0
  };
}
// --- Capa física pura: alcanzabilidad y consolidación ---

function collides(matrix, board, px, py) {
  const width = matrix[0].length;
  if (px < 0 || px + width > COLS) return true;

  for (let ry = 0; ry < matrix.length; ry++) {
    const ny = py + ry;
    if (ny >= ROWS) return true;

    const rowMask = matrixMask(matrix[ry]);
    const shifted = rowMask << px;

    if (ny >= 0 && (board[ny] & shifted)) return true;
  }
  return false;
}

function findLandingY(matrix, board, x) {
  // Permitir spawn por encima del techo (y < 0)
  let y = -matrix.length;

  // Si incluso en spawn inicial colisiona, no es placement válido
  if (collides(matrix, board, x, y)) return null;

  while (!collides(matrix, board, x, y + 1)) {
    y++;
    if (y > ROWS) return null; // guard de seguridad
  }
  return y;
}

function generatePlacements(board, currentTypeId) {
  if (currentTypeId === null || currentTypeId === undefined) {
    console.warn('[AGENT][placements] Fast-Fail: pieza actual indefinida.');
    return [];
  }

  const typeKey = PIECE_TYPES[currentTypeId];
  const shapes = typeKey ? TETROMINOS[typeKey] : null;
  if (!shapes || !Array.isArray(shapes)) return [];

  const placements = [];

  shapes.forEach((matrix, rotation) => {
    const width = matrix[0].length;
    const maxX = COLS - width;

    for (let x = 0; x <= maxX; x++) {
      const y = findLandingY(matrix, board, x);
      if (y === null || y === undefined) continue;

      placements.push({
        typeId: currentTypeId,
        position: { x, y, rotation, matrix }
      });
    }
  });

  return placements;
}

function simulatePlacementAndClearLines(board, placement) {
  if (!placement || !placement.position) {
    console.warn('[AGENT][simulate] Fast-Fail: datos inválidos de simulación.');
    return null;
  }

  const { x, y, matrix, rotation } = placement.position;

  if (x === undefined || y === undefined || !matrix) {
    console.warn('[AGENT][simulate] Fast-Fail: posición o matriz inválida.');
    return null;
  }

  const newBoard = board.slice();
  const maskRows = PIECE_MASKS[placement.typeId]?.[rotation];

  for (let ry = 0; ry < matrix.length; ry++) {
    const ny = y + ry;
    if (ny < 0) continue;
    if (ny >= ROWS) return null;

    const rowMask = maskRows ? maskRows[ry] : (matrixMask(matrix[ry]));
    const shifted = rowMask << x;

    if (shifted & newBoard[ny]) return null;
    newBoard[ny] = newBoard[ny] | shifted;
  }

  // Limpieza de líneas completas
  const compacted = new Uint16Array(ROWS);
  let writeIndex = ROWS - 1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (newBoard[r] !== FULL_MASK) {
      compacted[writeIndex] = newBoard[r];
      writeIndex--;
    }
  }
  while (writeIndex >= 0) {
    compacted[writeIndex] = 0;
    writeIndex--;
  }

  return compacted;
}

// --- Utilidades de bitboards y máscaras ---

function toBitBoard(board) {
  const bitRows = new Uint16Array(ROWS);
  for (let y = 0; y < ROWS; y++) {
    let mask = 0;
    const row = board[y];
    for (let x = 0; x < COLS; x++) {
      if (row[x] !== EMPTY) {
        mask |= (1 << x);
      }
    }
    bitRows[y] = mask;
  }
  return bitRows;
}

function hashBitBoard(bitboard) {
  return bitboard.join('|');
}

function matrixMask(row) {
  let mask = 0;
  for (let x = 0; x < row.length; x++) {
    if (row[x]) {
      mask |= (1 << x);
    }
  }
  return mask;
}

function buildPieceMasks(tetrominos) {
  const masks = [];
  PIECE_TYPES.forEach((key, typeId) => {
    const rotations = tetrominos[key]?.map((shape) =>
      shape.map((row) => matrixMask(row))
    ) || [];
    masks[typeId] = rotations;
  });
  return masks;
}
