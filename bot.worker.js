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
  const strategyName = planResult?.strategy || 'NEUTRAL';

  let ghost = null;
  if (nextPlacement && nextPlacement.position) {
    const { x, y, rotation, matrix } = nextPlacement.position;
    const typeId = nextPlacement.typeId;
    if (x !== undefined && y !== undefined && rotation !== undefined && matrix) {
      ghost = { typeId, rotation, x, y, matrix };
    }
  }

  const mode = 'PLANNING';
  return {
    ghost,
    mode,
    strategy: strategyName,
    wallsIntact: planResult.wallsIntact,
    wellColumn: planResult.wellColumn
  };
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

function findHighestOccupiedRow(board) {
  if (!board || typeof board.length !== 'number') return null;

  const isBitBoard = Number.isInteger(board[0]);

  for (let y = 0; y < ROWS; y++) {
    const row = board[y];
    if (row === undefined) break; // Fast-Fail defensivo

    const hasSolid = isBitBoard
      ? ((row & FULL_MASK) !== 0)
      : (Array.isArray(row) && row.some((cell) => cell !== EMPTY));

    if (hasSolid) return y;
  }

  return null;
}

function computeTowerHeightEstimate(board, bottomProfile) {
  const highestSolidY = findHighestOccupiedRow(board);
  if (highestSolidY !== null) {
    return ROWS - highestSolidY;
  }

  if (bottomProfile && bottomProfile.length === COLS) {
    let maxOpenDepth = -1;
    for (let i = 0; i < bottomProfile.length; i++) {
      const depth = bottomProfile[i];
      if (depth > maxOpenDepth) {
        maxOpenDepth = depth;
      }
    }

    if (maxOpenDepth >= 0) {
      return ROWS - (maxOpenDepth + 1);
    }
  }

  return 0;
}

// --- ESTRATEGIA DEFAULT ---
const DEFAULT_STRATEGY = {
  // Configuración de búsqueda
  BEAM_WIDTH: 25,

  // Pesos del modelo lineal
  weights: {
    height: 1.0,      // 1. ALTURA DOMINANTE
    rugosidad: 0.4,   // 2. RUGOSIDAD BALANCEADA
    closed: 2.0,      // 3. IMPUESTO A HUECOS
    burial: 0.5,      // 4. SEPULTURA LINEAL
    open: 0.05        // Bonificación por área abierta
  },

  // Función de evaluación (Score: menor es mejor)
  evaluate: function(candidate) {
    const w = this.weights;
    const heightCost = candidate.quadraticHeight * w.height;
    const rugoCost = candidate.rugosidad * w.rugosidad;
    const closedCost = candidate.A_closed * w.closed;
    const burialCost = candidate.burialScore * w.burial;
    const openRelief = candidate.A_open * w.open;
    
    return heightCost + rugoCost + closedCost + burialCost - openRelief;
  }
};

const STACK_STRATEGY = {
  BEAM_WIDTH: 35,
  
  weights: {
    height: 0.05,
    rugosidad: 0.3,
    closed: 8.0,
    burial: 2.0,
    open: 0.1,
    well_wall: 0.0,
    burn: 1000000.0
  },

  evaluate: function(candidate) {
    const w = this.weights;
    const linesCleared = candidate.linesCleared ?? 0;
    
    // 1. PENALIZACIÓN NUCLEAR DE POZO (NUEVA LÓGICA)
    // Si la pieza toca el pozo objetivo y NO hace un Tetris -> Castigo máximo.
    let wellPenalty = 0;
    
    // Recuperamos el pozo objetivo guardado en el candidato (o recalculamos si no existe)
    // Nota: parseInt maneja strings como "11 (D:3)" devolviendo 11.
    const targetWell = (candidate.targetWell !== undefined) 
        ? parseInt(candidate.targetWell) 
        : 11; 

    // Obtenemos el último movimiento
    const lastMove = candidate.path[candidate.path.length - 1];
    
    if (lastMove) {
        const { x, matrix } = lastMove.position;
        const pieceWidth = matrix[0].length;
        
        // Verificamos intersección horizontal con el pozo
        const touchesWell = (x <= targetWell) && (x + pieceWidth > targetWell);
        
        // CONDICIÓN DEL USUARIO:
        // Si tocamos el pozo Y (limpiamos menos de 4 líneas), es un intento fallido de relleno.
        if (touchesWell && linesCleared < 4) {
            wellPenalty = w.burn; // Usamos el mismo peso que el "Burn" (5000)
        }
    }

    // Penalización por Quema estándar (limpiar 1-3 líneas en cualquier lado)
    const burnPenalty = (linesCleared > 0 && linesCleared < 4) ? w.burn : 0;

    // Fallback defensivo
    if (!candidate.profile) {
        return (candidate.quadraticHeight * w.height) +
               burnPenalty +
               wellPenalty;
    }

    const p = candidate.profile;
    
    // 2. RUGOSIDAD SELECTIVA
    let stackRugosidad = 0;
    for (let x = 0; x < COLS - 1; x++) {
        if (x === targetWell || x + 1 === targetWell) continue; // Usamos targetWell para consistencia

        if (p[x] !== -1 && p[x+1] !== -1) {
            stackRugosidad += Math.abs(p[x] - p[x+1]);
        }
    }

    return (candidate.quadraticHeight * w.height) +
           (stackRugosidad * w.rugosidad) +
           (candidate.A_closed * w.closed) +
           (candidate.burialScore * w.burial) -
           (candidate.A_open * w.open) +
           burnPenalty + 
           wellPenalty; // <--- Sumamos la nueva penalización
  }
};

function determineStrategyContext(board, topology, metrics) {
  const profile = topology?.openRV?.bottomProfile;
  const closedArea = metrics?.A_closed_total ?? metrics?.A_closed ?? 0;
  const isClean = closedArea === 0;

  const highestSolidY = findHighestOccupiedRow(board);
  const realTowerHeight = highestSolidY === null ? 0 : ROWS - highestSolidY;
  const isSafeHeight = realTowerHeight < 11;

  let wallsIntact = false;
  let wellCol = 11;
  let wellDebug = null;

  if (profile && isClean) {
    wellCol = findTargetWellColumn(profile);
    wallsIntact = areWallsIntact(board, profile, wellCol);

    if (wallsIntact) {
      const wellY = profile[wellCol];
      let minSideHeight = 99;

      if (wellCol > 0) {
        const leftY = profile[wellCol - 1];
        const h = wellY - leftY;
        if (h < minSideHeight) minSideHeight = h;
      }

      if (wellCol < COLS - 1) {
        const rightY = profile[wellCol + 1];
        const h = wellY - rightY;
        if (h < minSideHeight) minSideHeight = h;
      }

      wellDebug = `${wellCol} (D:${minSideHeight})`;
    } else {
      wellDebug = wellCol;
    }
  }

  if (wellDebug === null) {
    wellDebug = wellCol;
  }

  const strategyName = (isClean && isSafeHeight && wallsIntact) ? 'STACK' : 'DEFAULT';
  const strategy = strategyName === 'STACK' ? STACK_STRATEGY : DEFAULT_STRATEGY;

  return {
    strategy,
    strategyName,
    wallsIntact,
    wellColumn: wellDebug,
    targetWell: profile ? wellCol : 11
  };
}

function planBestSequence(board, bagTypeIds) {
  let wallsIntact = false;
  let debugWellCol = null;

  if (!BoardAnalyzer.validate(board)) {
    return { deltaAopen: 0, finalRugosidad: 0, path: [], strategy: 'DEFAULT', wallsIntact, wellColumn: debugWellCol };
  }

  const baseBoard = Array.isArray(board?.[0]) ? toBitBoard(board) : board;

  const sequence = Array.isArray(bagTypeIds)
    ? bagTypeIds.filter((id) => id !== null && id !== undefined)
    : [];

  if (sequence.length === 0) return { path: [], strategy: 'DEFAULT', wallsIntact: wallsIntact, wellColumn: debugWellCol };

  const topology0 = analyzeTopology(baseBoard);
  const metrics0 = computeStateMetrics(topology0, baseBoard);
  const A0 = metrics0?.A_open ?? 0;

  // --- ZONA DE DEBUG ---
  const debugClosed = metrics0?.A_closed_total ?? -999;
  const debugProfile = topology0?.openRV?.bottomProfile ? topology0.openRV.bottomProfile.join(',') : 'NULL';
  
  // Imprimir solo si es el primer turno (tablero vacío suele tener A_open alto) o condicional
  // O simplemente imprimir siempre por ahora para ver qué pasa al inicio.
  console.log(`[WORKER DEBUG] ClosedArea: ${debugClosed} | Profile: [${debugProfile}]`);
  // --------------------

  const initialContext = determineStrategyContext(baseBoard, topology0, metrics0);
  wallsIntact = initialContext.wallsIntact;
  debugWellCol = initialContext.wellColumn;

  const BEAM_WIDTH = Math.max(DEFAULT_STRATEGY.BEAM_WIDTH, STACK_STRATEGY.BEAM_WIDTH);

  let candidates = [{
    board: baseBoard,
    path: [],
    linesCleared: 0,
    A_open: A0,
    rugosidad: metrics0?.geometric?.rugosidad ?? 0,
    A_closed: metrics0?.A_closed_total ?? 0,
    quadraticHeight: metrics0?.quadraticHeight ?? 0,
    openMinY: metrics0?.geometric?.openMinY ?? ROWS,
    burialScore: metrics0?.burialScore ?? 0,
    profile: topology0.openRV.bottomProfile, // <--- NECESARIO PARA STACK
    targetWell: initialContext.targetWell,
    strategyName: initialContext.strategyName,
    wallsIntact: initialContext.wallsIntact,
    wellColumn: initialContext.wellColumn
  }];

  for (let i = 0; i < sequence.length; i++) {
    const currentTypeId = sequence[i];
    const nextCandidates = [];
    const visitedHashes = new Set();

    for (const candidate of candidates) {
      const placements = generatePlacements(candidate.board, currentTypeId);

      for (const placement of placements) {
        const result = simulatePlacementAndClearLines(candidate.board, placement);
        if (!result) continue;

        const { board: nextBoard, linesCleared } = result;

        const h = hashBitBoard(nextBoard);
        if (visitedHashes.has(h)) continue;
        visitedHashes.add(h);

        const topology = analyzeTopology(nextBoard);
        const metrics = computeStateMetrics(topology, nextBoard);
        const context = determineStrategyContext(nextBoard, topology, metrics);
        
        const nextCandidate = {
          board: nextBoard,
          path: [...candidate.path, placement],
          linesCleared,
          A_open: metrics.A_open,
          rugosidad: metrics.geometric.rugosidad,
          A_closed: metrics.A_closed_total,
          quadraticHeight: metrics.quadraticHeight,
          openMinY: metrics.geometric.openMinY,
          burialScore: metrics.burialScore,
          profile: topology.openRV.bottomProfile, // <--- NECESARIO PARA STACK
          targetWell: context.targetWell,
          strategyName: context.strategyName,
          wallsIntact: context.wallsIntact,
          wellColumn: context.wellColumn
        };

        nextCandidate.score = context.strategy.evaluate(nextCandidate);
        nextCandidates.push(nextCandidate);
      }
    }

    if (nextCandidates.length === 0) break;

    nextCandidates.sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) return scoreA - scoreB;
      // Desempates
      if (a.quadraticHeight !== b.quadraticHeight) return a.quadraticHeight - b.quadraticHeight;
      return a.rugosidad - b.rugosidad;
    });

    candidates = nextCandidates.slice(0, BEAM_WIDTH);
  }

  const best = candidates[0];

  // CORRECCIÓN DE ROBUSTEZ:
  // Devolvemos la estrategia decidida (strategyName) explícitamente,
  // desacoplando la "Intención" (Estrategia) de la "Ejecución" (Path).
  return {
    path: best?.path || [],
    deltaAopen: (best?.A_open ?? A0) - A0,
    linesCleared: best?.linesCleared || 0,
    strategy: best?.strategyName || initialContext.strategyName, // <--- ¡Siempre enviamos la estrategia calculada al inicio!
    wallsIntact: best?.wallsIntact ?? wallsIntact,
    wellColumn: best?.wellColumn ?? debugWellCol
  };
}

function findTargetWellColumn(profile) {
  if (!profile) return 11;

  let wellCol = 11;
  let maxDepth = -99;

  for (let x = 0; x < COLS; x++) {
    if (profile[x] > maxDepth) {
      maxDepth = profile[x];
      wellCol = x;
    } else if (profile[x] === maxDepth) {
      const wellIsEdge = (wellCol === 0 || wellCol === COLS - 1);
      const currIsEdge = (x === 0 || x === COLS - 1);

      if (currIsEdge && !wellIsEdge) {
        wellCol = x;
      } else if (x === COLS - 1) {
        wellCol = x; // Preferencia convencional a la derecha
      }
    }
  }

  return wellCol;
}

function areWallsIntact(baseBoard, bottomProfile, wellColFromPlan = null) {
  const p = bottomProfile;

  // A. Selección de pozo (reutilizando heurística)
  const wellCol = (wellColFromPlan === null || wellColFromPlan === undefined)
    ? findTargetWellColumn(p)
    : wellColFromPlan;

  // B. Escanear columnas adyacentes al pozo elegido
  const checkCols = [];
  if (wellCol > 0) checkCols.push(wellCol - 1);
  if (wellCol < COLS - 1) checkCols.push(wellCol + 1);

  for (const cx of checkCols) {
    // 1. ANCLAJE AL SUELO: La celda en ROWS-1 debe estar ocupada
    const isAnchored = (baseBoard[ROWS - 1] & (1 << cx)) !== 0;
    if (!isAnchored) {
      console.warn(`[AGENT][worker] Fast-Fail: pared sin anclaje en Col ${cx}.`);
      return false;
    }

    // 2. CONTINUIDAD: Evitar voladizos (aire bajo bloque)
    // Buscamos "Overhangs": Celdas vacías con algo ocupado encima
    for (let y = 1; y < ROWS; y++) {
      const isOccAbove = (baseBoard[y - 1] & (1 << cx)) !== 0;
      const isEmptyCurr = (baseBoard[y] & (1 << cx)) === 0;

      if (isEmptyCurr && isOccAbove) {
        console.warn(`[AGENT][worker] Fast-Fail: pared rota en Col ${cx}, Y=${y}.`);
        return false;
      }
    }
  }

  return true;
}

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
  let linesCleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (newBoard[r] === FULL_MASK) {
      linesCleared++;
      continue;
    }

    compacted[writeIndex] = newBoard[r];
    writeIndex--;
  }
  while (writeIndex >= 0) {
    compacted[writeIndex] = 0;
    writeIndex--;
  }

  return { board: compacted, linesCleared };
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
