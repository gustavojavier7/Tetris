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
    return Array.isArray(board) && board.length === ROWS && board.every(r => Array.isArray(r) && r.length === COLS);
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
  bottomProfile.fill(-1);

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
    if (y > bottomProfile[x]) bottomProfile[x] = y;

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

  // --- 2. Flood fill de RV cerradas ---
  const closedRVs = [];

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const idx = y * COLS + x;
      if ((board[y] & (1 << x)) !== 0 || visited[idx]) continue;

      let area = 0;
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
    }
  }

  return { openRV, closedRVs };
}

function computeStateMetrics(topology) {
  if (!topology || !topology.openRV) {
    return {
      A_open: 0,
      A_closed_total: 0,
      closed_count: 0,
      geometric: {
        minY: ROWS,
        rugosidad: 0
      }
    };
  }

  const { openRV, closedRVs } = topology;

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
      minY: openRV.minY,
      rugosidad
    }
  };
}

function planBestSequence(board, bagTypeIds) {
  // CONFIGURACIÓN DE RENDIMIENTO
  const BEAM_WIDTH = 15; // Número de "futuros" a mantener vivos. (Bajar a 5-10 si hay lag)

  if (!BoardAnalyzer.validate(board)) {
    return { deltaAopen: 0, finalRugosidad: 0, path: [] };
  }

  const bitboard0 = toBitBoard(board);

  // 1. Preparar secuencia y métricas iniciales
  const sequence = Array.isArray(bagTypeIds)
    ? bagTypeIds.filter((id) => id !== null && id !== undefined)
    : [];

  if (sequence.length === 0) return { path: [] };

  const topology0 = analyzeTopology(bitboard0);
  const metrics0 = computeStateMetrics(topology0);
  const A0 = metrics0?.A_open ?? 0;

  // 2. Estado inicial del haz (Beam)
  // Cada candidato guarda su tablero actual y la ruta de movimientos que llevó ahí
  let candidates = [{
    board: bitboard0,
    path: [],
    A_open: A0,
    rugosidad: metrics0?.geometric?.rugosidad ?? 0
  }];

  // 3. Iterar sobre cada pieza de la secuencia (Profundidad)
  for (let i = 0; i < sequence.length; i++) {
    const currentTypeId = sequence[i];
    const nextCandidates = [];
    const visitedHashes = new Set(); // Para no procesar el mismo tablero dos veces en el mismo turno

    // Expandir cada candidato sobreviviente
    for (const candidate of candidates) {
      const placements = generatePlacements(candidate.board, currentTypeId);

      for (const placement of placements) {
        // Simular física
        const nextBoard = simulatePlacementAndClearLines(candidate.board, placement);
        if (!nextBoard) continue;

        // Deduplicación (Optimización crítica)
        const h = hashBitBoard(nextBoard);
        if (visitedHashes.has(h)) continue;
        visitedHashes.add(h);

        // Evaluar Topología
        const topology = analyzeTopology(nextBoard);
        const metrics = computeStateMetrics(topology);
        
        // Guardar nuevo candidato
        nextCandidates.push({
          board: nextBoard,
          path: [...candidate.path, placement], // Historial de movimientos
          A_open: metrics.A_open,
          rugosidad: metrics.geometric.rugosidad,
          A_closed: metrics.A_closed_total
        });
      }
    }

    if (nextCandidates.length === 0) break; // Camino sin salida

    // 4. PODA (SELECCIÓN NATURAL)
    // Ordenamos los candidatos:
    // 1. Menos área cerrada (Seguridad)
    // 2. Más área abierta (Libertad)
    // 3. Menos rugosidad (Estabilidad)
    nextCandidates.sort((a, b) => {
      if (a.A_closed !== b.A_closed) return a.A_closed - b.A_closed; // Menor es mejor
      if (a.A_open !== b.A_open) return b.A_open - a.A_open;       // Mayor es mejor
      return a.rugosidad - b.rugosidad;                            // Menor es mejor
    });

    // Sobreviven solo los mejores (BEAM_WIDTH)
    const survivors = nextCandidates.slice(0, BEAM_WIDTH);
    visitedHashes.clear();
    nextCandidates.length = 0;
    candidates = survivors;
  }

  // 5. Retornar el mejor resultado final
  const best = candidates[0];
  if (!best) return { path: [] };

  return {
    path: best.path, // Esto es lo que think() espera
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
