// bot.worker.js - Worker de IA con modo FUSION (Ramsey + Clique Quotas) + Filtro Ternario

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

// ================================================================
// CONFIGURACION FUSION (Ramsey + Clique Quotas)
// ================================================================
const USE_CLIQUE_BEAM = true;        // true = FUSION, false = BLINEAL puro
const PROFILE_TAU = 6;                // Umbral SAD para compatibilidad
const SHORTLIST_FACTOR = 2;           // M = factor * BEAM_WIDTH
const QUOTA_CONSENSUS = 0.60;         // 60% mejores de cliques grandes
const QUOTA_MINORITY = 0.25;          // 25% mejores de cliques pequenos
const QUOTA_WELL_DIV = 0.15;          // 15% diversidad de pozo
const MAX_CLIQUE_K = 4;               // Tamano maximo de clique a buscar
const RAMSEY_K4_WEIGHT = 35.0;        // Peso del bonus K4 en score hibrido
const RAMSEY_K3_WEIGHT = 15.0;        // Peso del bonus K3 (L-shapes)
// ================================================================
// RAMSEY TERNARIO: Analisis de tripletes en la secuencia
// ================================================================
// Penalizacion aplicada al score cuando el triplete siguiente es BLUE.
// Calibrado en relacion a scoreRamseyHybrid (max impacto ~50):
// 80 puntos demota el candidato sin excluirlo completamente del beam.
const TERNARY_BLUE_PENALTY = 80.0;

// Profundidad del mini-beam interno del filtro ternario (top-A x top-B x top-C)
const TERNARY_TOP_A = 3;
const TERNARY_TOP_B = 2;
const TERNARY_TOP_C = 1;
// ================================================================

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
    console.warn('[AGENT][worker] Fast-Fail: datos invalidos para pensar.');
    return { ghost: null, mode: 'UNDEFINED' };
  }
  if (currentTypeId === null || currentTypeId === undefined) {
    console.warn('[AGENT][worker] Fast-Fail: pieza actual no definida.');
    return { ghost: null, mode: 'UNDEFINED' };
  }
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
  return { ghost, mode: 'PLANNING', strategy: strategyName, wallsIntact: planResult.wallsIntact, wellColumn: planResult.wellColumn };
}

// --- API minima para evaluacion topologica ---

function analyzeTopology(board) {
  const visited = new Uint8Array(ROWS * COLS);
  const stackX = new Int16Array(ROWS * COLS);
  const stackY = new Int16Array(ROWS * COLS);
  const bottomProfile = new Int16Array(COLS);
  bottomProfile.fill(-1);
  let openArea = 0;
  let openMinY = ROWS;
  let stackSize = 0;

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
      const nx = x + 1, ny = y, idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
    // Izquierda
    if (x - 1 >= 0) {
      const nx = x - 1, ny = y, idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
    // Abajo
    if (y + 1 < ROWS) {
      const nx = x, ny = y + 1, idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
    // Arriba
    if (y - 1 >= 0) {
      const nx = x, ny = y - 1, idx = ny * COLS + nx;
      if ((board[ny] & (1 << nx)) === 0 && !visited[idx]) {
        visited[idx] = 1;
        stackX[stackSize] = nx;
        stackY[stackSize] = ny;
        stackSize++;
      }
    }
  }

  const openRV = { area: openArea, minY: openMinY, bottomProfile };

  // RV cerradas
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
        if (cx + 1 < COLS) {
          const nx = cx + 1, ny = cy, nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
        if (cx - 1 >= 0) {
          const nx = cx - 1, ny = cy, nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
        if (cy + 1 < ROWS) {
          const nx = cx, ny = cy + 1, nidx = ny * COLS + nx;
          if ((board[ny] & (1 << nx)) === 0 && !visited[nidx]) {
            visited[nidx] = 1;
            stackX[stackSize] = nx;
            stackY[stackSize] = ny;
            stackSize++;
          }
        }
        if (cy - 1 >= 0) {
          const nx = cx, ny = cy - 1, nidx = ny * COLS + nx;
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
      if (row === undefined) break;
      const isSolid = isBitBoard ? ((row & (1 << x)) !== 0) : (Array.isArray(row) && row[x] !== EMPTY);
      if (isSolid) { colY = y; break; }
    }
    const height = ROWS - colY;
    totalQuadraticHeight += (height * height);
  }
  return totalQuadraticHeight;
}

function computeStateMetrics(topology, board) {
  if (!topology || !topology.openRV) {
    return {
      A_open: 0, A_closed_total: 0, closed_count: 0,
      geometric: { openMinY: ROWS, rugosidad: 0 },
      quadraticHeight: computeQuadraticHeight(board), burialScore: 0
    };
  }
  const { openRV, closedRVs, totalBurial } = topology;
  const A_open = openRV.area;
  let A_closed_total = 0;
  for (const rv of closedRVs) { A_closed_total += rv.area; }
  const closed_count = closedRVs.length;
  const bottomProfile = openRV.bottomProfile;
  let rugosidad = 0;
  for (let x = 0; x < COLS - 1; x++) {
    rugosidad += Math.abs(bottomProfile[x] - bottomProfile[x + 1]);
  }
  return {
    A_open, A_closed_total, closed_count,
    geometric: { openMinY: openRV.minY, rugosidad },
    quadraticHeight: computeQuadraticHeight(board),
    burialScore: totalBurial
  };
}

function findHighestOccupiedRow(board) {
  if (!board || typeof board.length !== 'number') return null;
  const isBitBoard = Number.isInteger(board[0]);
  for (let y = 0; y < ROWS; y++) {
    const row = board[y];
    if (row === undefined) break;
    const hasSolid = isBitBoard ? ((row & FULL_MASK) !== 0) : (Array.isArray(row) && row.some((c) => c !== EMPTY));
    if (hasSolid) return y;
  }
  return null;
}

// ================================================================
// FUSION: Funciones Ramsey - Cliques y Score Hibrido
// ================================================================

function countK4Blocks(board) {
  let count = 0;
  for (let y = 0; y < ROWS - 1; y++) {
    const a = board[y];
    const b = board[y + 1];
    for (let x = 0; x < COLS - 1; x++) {
      const mask = (1 << x) | (1 << (x + 1));
      if ((a & mask) === mask && (b & mask) === mask) count++;
    }
  }
  return count;
}

function countK3Shapes(board) {
  let count = 0;
  for (let y = 0; y < ROWS - 1; y++) {
    for (let x = 0; x < COLS - 1; x++) {
      const c00 = (board[y] & (1 << x)) !== 0;
      const c10 = (board[y] & (1 << (x + 1))) !== 0;
      const c01 = (board[y + 1] & (1 << x)) !== 0;
      const c11 = (board[y + 1] & (1 << (x + 1))) !== 0;
      const sum = (c00 ? 1 : 0) + (c10 ? 1 : 0) + (c01 ? 1 : 0) + (c11 ? 1 : 0);
      if (sum === 3) count++;
    }
  }
  return count;
}

function scoreRamseyHybrid(baseScore, board) {
  const k4 = countK4Blocks(board);
  const k3 = countK3Shapes(board);
  return baseScore - RAMSEY_K4_WEIGHT * (k4 / (ROWS * COLS)) - RAMSEY_K3_WEIGHT * (k3 / (ROWS * COLS));
}

// ================================================================
// FUSION: Grafo de Compatibilidad y Sistema de Cuotas
// ================================================================

function getProfile(board) {
  const prof = new Int16Array(COLS);
  for (let x = 0; x < COLS; x++) {
    prof[x] = ROWS;
    for (let y = 0; y < ROWS; y++) {
      if ((board[y] & (1 << x)) !== 0) { prof[x] = ROWS - y; break; }
    }
  }
  return prof;
}

function profileSAD(p1, p2) {
  let sum = 0;
  for (let i = 0; i < COLS; i++) sum += Math.abs(p1[i] - p2[i]);
  return sum;
}

function buildCompatGraph(shortlist, tau) {
  const n = shortlist.length;
  const adj = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = shortlist[i];
      const b = shortlist[j];
      if (a.targetWell !== b.targetWell) continue;
      if (a.wallsIntact !== b.wallsIntact) continue;
      if (profileSAD(a._profile, b._profile) < tau) {
        adj[i].add(j);
        adj[j].add(i);
      }
    }
  }
  return adj;
}

function findComponents(adj) {
  const n = adj.length;
  const visited = new Uint8Array(n);
  const cliqueOf = new Int32Array(n).fill(-1);
  const cliqueSize = new Int32Array(n).fill(1);
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const comp = [];
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const u of adj[v]) {
        if (!visited[u]) { visited[u] = 1; stack.push(u); }
      }
    }
    for (const v of comp) { cliqueOf[v] = cid; cliqueSize[v] = comp.length; }
    cid++;
  }
  return { cliqueOf, cliqueSize };
}

function detectChaos(M, cliqueSize) {
  const expectedK = Math.ceil(Math.log2(Math.max(M, 2)));
  const maxFoundK = cliqueSize.length > 0 ? Math.max(...cliqueSize) : 1;
  return { chaoticTurn: maxFoundK < expectedK - 1, expectedK, maxFoundK };
}

function selectByCliqueQuotas(sortedCandidates, beamWidth) {
  if (sortedCandidates.length <= beamWidth) return sortedCandidates;
  const M = Math.min(sortedCandidates.length, SHORTLIST_FACTOR * beamWidth);
  const shortlist = sortedCandidates.slice(0, M).map((c) => ({
    ...c,
    _profile: c.profile || getProfile(c.board)
  }));
  const adj = buildCompatGraph(shortlist, PROFILE_TAU);
  const { cliqueOf, cliqueSize } = findComponents(adj);
  const { chaoticTurn } = detectChaos(M, Array.from(cliqueSize));
  const qConsensus = chaoticTurn ? 0.40 : QUOTA_CONSENSUS;
  const qMinority = chaoticTurn ? 0.50 : QUOTA_MINORITY;
  const slotsConsensus = Math.max(1, Math.floor(beamWidth * qConsensus));
  const slotsMinority = Math.max(1, Math.floor(beamWidth * qMinority));
  const selected = new Set();
  const result = [];
  // 1. Cuota consenso
  const usedCliques = new Set();
  for (let i = 0; i < M; i++) {
    if (result.length >= slotsConsensus) break;
    const c = cliqueOf[i];
    if (cliqueSize[i] >= 3 && !usedCliques.has(c)) {
      usedCliques.add(c);
      selected.add(i);
      result.push(shortlist[i]);
    }
  }
  // 2. Cuota minoria
  for (let i = 0; i < M; i++) {
    if (result.length >= slotsConsensus + slotsMinority) break;
    if (selected.has(i)) continue;
    if (cliqueSize[i] <= 2) { selected.add(i); result.push(shortlist[i]); }
  }
  // 3. Diversidad de pozo
  const usedWells = new Set();
  for (const c of result) { if (c.targetWell !== undefined) usedWells.add(c.targetWell); }
  for (let i = 0; i < M; i++) {
    if (result.length >= beamWidth) break;
    if (selected.has(i)) continue;
    const tw = shortlist[i].targetWell;
    if (tw !== undefined && !usedWells.has(tw)) { usedWells.add(tw); selected.add(i); result.push(shortlist[i]); }
  }
  // 4. Relleno
  for (let i = 0; i < M; i++) {
    if (result.length >= beamWidth) break;
    if (!selected.has(i)) result.push(shortlist[i]);
  }
  return result;
}

// ================================================================
// RAMSEY TERNARIO: Funciones de soporte
// ================================================================

/**
 * Evalua un tablero con pesos fijos DEFAULT.
 * Se usa internamente en el filtro ternario (independiente de la
 * estrategia activa) para que el lookahead sea neutral y estable.
 */
function evaluateBoardMetrics(metrics) {
  return metrics.quadraticHeight * 1.0 +
         metrics.geometric.rugosidad * 0.4 +
         metrics.A_closed_total * 4.0 +
         metrics.burialScore * 1.5 -
         metrics.A_open * 0.05;
}

/**
 * Dado un tablero y una lista de placements, devuelve los placements
 * ordenados de mejor a peor segun evaluateBoardMetrics.
 * Los placements invalidos (simulacion fallida) quedan al final con score Infinity.
 */
function evaluateAndRankPlacements(board, placements) {
  return placements.map(p => {
    const result = simulatePlacementAndClearLines(board, p);
    if (!result) return { ...p, score: Infinity };
    const metrics = computeStateMetrics(analyzeTopology(result.board), result.board);
    return { ...p, score: evaluateBoardMetrics(metrics), resultBoard: result.board };
  }).sort((a, b) => a.score - b.score);
}

/**
 * Clasifica un triplete de piezas como RED o BLUE.
 *
 * RED  -> el mejor camino posible para las 3 piezas no genera huecos cerrados.
 * BLUE -> incluso jugando de forma optima, el triplete genera regiones cerradas.
 *
 * El mini-beam interno es acotado (TERNARY_TOP_A x TOP_B x TOP_C = 3x2x1 = 6 caminos),
 * por lo que el costo computacional es bajo y no bloquea el beam principal.
 *
 * @param {number} pieceA  typeId de la primera pieza del triplete
 * @param {number} pieceB  typeId de la segunda pieza
 * @param {number} pieceC  typeId de la tercera pieza
 * @param {Uint16Array} board  tablero bitboard en el momento de evaluacion
 * @returns {'RED'|'BLUE'}
 */
function evaluateTriplet(pieceA, pieceB, pieceC, board) {
  // Nivel A
  const placementsA = generatePlacements(board, pieceA);
  if (placementsA.length === 0) return 'BLUE'; // tablero ya inviable

  const topA = evaluateAndRankPlacements(board, placementsA).slice(0, TERNARY_TOP_A);
  const bestScores = [];

  for (const pa of topA) {
    const r1 = simulatePlacementAndClearLines(board, pa);
    if (!r1) continue;

    // Nivel B
    const placementsB = generatePlacements(r1.board, pieceB);
    if (placementsB.length === 0) continue;
    const topB = evaluateAndRankPlacements(r1.board, placementsB).slice(0, TERNARY_TOP_B);

    for (const pb of topB) {
      const r2 = simulatePlacementAndClearLines(r1.board, pb);
      if (!r2) continue;

      // Nivel C
      const placementsC = generatePlacements(r2.board, pieceC);
      if (placementsC.length === 0) continue;
      const topC = evaluateAndRankPlacements(r2.board, placementsC).slice(0, TERNARY_TOP_C);

      for (const pc of topC) {
        const r3 = simulatePlacementAndClearLines(r2.board, pc);
        if (!r3) continue;

        const topo = analyzeTopology(r3.board);

        // Clasificacion directa: si hay cualquier region cerrada -> BLUE
        if (topo.closedRVs.length > 0) {
          bestScores.push('BLUE');
        } else {
          bestScores.push('RED');
        }
      }
    }
  }

  // Si no se pudo simular ningun camino completo -> BLUE (caso degenerado)
  if (bestScores.length === 0) return 'BLUE';

  // El triplete es RED solo si AL MENOS UN camino resulta limpio.
  // Esto es conservador: un solo camino viable ya valida el triplete.
  return bestScores.includes('RED') ? 'RED' : 'BLUE';
}
// ================================================================
// FIN RAMSEY TERNARIO
// ================================================================

// ================================================================
// FIN FUSION
// ================================================================

function computeTowerHeightEstimate(board, bottomProfile) {
  const highestSolidY = findHighestOccupiedRow(board);
  if (highestSolidY !== null) return ROWS - highestSolidY;
  if (bottomProfile && bottomProfile.length === COLS) {
    let maxOpenDepth = -1;
    for (let i = 0; i < bottomProfile.length; i++) {
      if (bottomProfile[i] > maxOpenDepth) maxOpenDepth = bottomProfile[i];
    }
    if (maxOpenDepth >= 0) return ROWS - (maxOpenDepth + 1);
  }
  return 0;
}

// --- ESTRATEGIAS ---
const DEFAULT_STRATEGY = {
  BEAM_WIDTH: 25,
  weights: { height: 1.0, rugosidad: 0.4, closed: 4.0, burial: 1.5, open: 0.05 },
  evaluate: function(candidate) {
    const w = this.weights;
    return candidate.quadraticHeight * w.height +
           candidate.rugosidad * w.rugosidad +
           candidate.A_closed * w.closed +
           candidate.burialScore * w.burial -
           candidate.A_open * w.open;
  }
};

const STACK_STRATEGY = {
  BEAM_WIDTH: 35,
  weights: { height: 0.05, rugosidad: 0.3, closed: 8.0, burial: 2.0, open: 0.1, well_wall: 0.0, burn: 1000000.0 },
  evaluate: function(candidate) {
    const w = this.weights;
    const linesCleared = candidate.linesCleared ?? 0;
    let wellPenalty = 0;
    const targetWell = (candidate.targetWell !== undefined) ? parseInt(candidate.targetWell) : 11;
    const lastMove = candidate.path[candidate.path.length - 1];
    if (lastMove) {
      const { x, matrix } = lastMove.position;
      const pieceWidth = matrix[0].length;
      if ((x <= targetWell) && (x + pieceWidth > targetWell) && linesCleared < 4) {
        wellPenalty = w.burn;
      }
    }
    const burnPenalty = (linesCleared > 0 && linesCleared < 4) ? w.burn : 0;
    if (!candidate.profile) {
      return (candidate.quadraticHeight * w.height) + burnPenalty + wellPenalty;
    }
    const p = candidate.profile;
    let stackRugosidad = 0;
    for (let x = 0; x < COLS - 1; x++) {
      if (x === targetWell || x + 1 === targetWell) continue;
      if (p[x] !== -1 && p[x + 1] !== -1) stackRugosidad += Math.abs(p[x] - p[x + 1]);
    }
    return (candidate.quadraticHeight * w.height) +
           (stackRugosidad * w.rugosidad) +
           (candidate.A_closed * w.closed) +
           (candidate.burialScore * w.burial) -
           (candidate.A_open * w.open) +
           burnPenalty + wellPenalty;
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
      if (wellCol > 0) { const h = wellY - profile[wellCol - 1]; if (h < minSideHeight) minSideHeight = h; }
      if (wellCol < COLS - 1) { const h = wellY - profile[wellCol + 1]; if (h < minSideHeight) minSideHeight = h; }
      wellDebug = `${wellCol} (D:${minSideHeight})`;
    } else {
      wellDebug = wellCol;
    }
  }
  if (wellDebug === null) wellDebug = wellCol;
  const strategyName = (isClean && isSafeHeight && wallsIntact) ? 'STACK' : 'DEFAULT';
  return {
    strategy: strategyName === 'STACK' ? STACK_STRATEGY : DEFAULT_STRATEGY,
    strategyName, wallsIntact,
    wellColumn: wellDebug,
    targetWell: profile ? wellCol : 11
  };
}

// ================================================================
// PLAN BEST SEQUENCE - Integracion FUSION + Filtro Ternario
// ================================================================

function planBestSequence(board, bagTypeIds) {
  let wallsIntact = false;
  let debugWellCol = null;
  if (!BoardAnalyzer.validate(board)) {
    return { deltaAopen: 0, finalRugosidad: 0, path: [], strategy: 'DEFAULT', wallsIntact, wellColumn: debugWellCol };
  }
  const baseBoard = Array.isArray(board?.[0]) ? toBitBoard(board) : board;
  const sequence = Array.isArray(bagTypeIds) ? bagTypeIds.filter((id) => id !== null && id !== undefined) : [];
  if (sequence.length === 0) return { path: [], strategy: 'DEFAULT', wallsIntact, wellColumn: debugWellCol };

  const topology0 = analyzeTopology(baseBoard);
  const metrics0 = computeStateMetrics(topology0, baseBoard);
  const A0 = metrics0?.A_open ?? 0;
  const initialContext = determineStrategyContext(baseBoard, topology0, metrics0);
  wallsIntact = initialContext.wallsIntact;
  debugWellCol = initialContext.wellColumn;
  const BEAM_WIDTH = Math.max(DEFAULT_STRATEGY.BEAM_WIDTH, STACK_STRATEGY.BEAM_WIDTH);

  let candidates = [{
    board: baseBoard, path: [], linesCleared: 0, A_open: A0,
    rugosidad: metrics0?.geometric?.rugosidad ?? 0,
    A_closed: metrics0?.A_closed_total ?? 0,
    quadraticHeight: metrics0?.quadraticHeight ?? 0,
    openMinY: metrics0?.geometric?.openMinY ?? ROWS,
    burialScore: metrics0?.burialScore ?? 0,
    profile: topology0.openRV.bottomProfile,
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
          profile: topology.openRV.bottomProfile,
          targetWell: context.targetWell,
          strategyName: context.strategyName,
          wallsIntact: context.wallsIntact,
          wellColumn: context.wellColumn
        };

        // --- SCORE ---
        let baseScore = context.strategy.evaluate(nextCandidate);

        if (USE_CLIQUE_BEAM) {
          // Capa 1: penalizacion por densidad K4/K3 en el tablero actual
          baseScore = scoreRamseyHybrid(baseScore, nextBoard);

          // Capa 2: filtro ternario -- penalizar si el futuro inmediato es BLUE
          // Guard: solo si hay al menos 3 piezas adelante en la secuencia
          if (i + 3 < sequence.length) {
            const tripletColor = evaluateTriplet(
              sequence[i + 1],
              sequence[i + 2],
              sequence[i + 3],
              nextBoard
            );
            if (tripletColor === 'BLUE') {
              baseScore += TERNARY_BLUE_PENALTY;
            }
          }
        }

        nextCandidate.score = baseScore;
        nextCandidates.push(nextCandidate);
      }
    }

    if (nextCandidates.length === 0) break;

    nextCandidates.sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) return scoreA - scoreB;
      if (a.quadraticHeight !== b.quadraticHeight) return a.quadraticHeight - b.quadraticHeight;
      return a.rugosidad - b.rugosidad;
    });

    // --- FUSION: Cuotas de cliques vs slice top-N ---
    if (USE_CLIQUE_BEAM) {
      candidates = selectByCliqueQuotas(nextCandidates, BEAM_WIDTH);
    } else {
      candidates = nextCandidates.slice(0, BEAM_WIDTH);
    }
  }

  const best = candidates[0];
  return {
    path: best?.path || [],
    deltaAopen: (best?.A_open ?? A0) - A0,
    linesCleared: best?.linesCleared || 0,
    strategy: best?.strategyName || initialContext.strategyName,
    wallsIntact: best?.wallsIntact ?? wallsIntact,
    wellColumn: best?.wellColumn ?? debugWellCol
  };
}

function findTargetWellColumn(profile) {
  if (!profile) return 11;
  let wellCol = 11;
  let maxDepth = -99;
  for (let x = 0; x < COLS; x++) {
    if (profile[x] > maxDepth) { maxDepth = profile[x]; wellCol = x; }
    else if (profile[x] === maxDepth) {
      const wellIsEdge = (wellCol === 0 || wellCol === COLS - 1);
      const currIsEdge = (x === 0 || x === COLS - 1);
      if (currIsEdge && !wellIsEdge) wellCol = x;
      else if (x === COLS - 1) wellCol = x;
    }
  }
  return wellCol;
}

function areWallsIntact(baseBoard, bottomProfile, wellColFromPlan) {
  const p = bottomProfile;
  const wellCol = (wellColFromPlan === null || wellColFromPlan === undefined) ? findTargetWellColumn(p) : wellColFromPlan;
  const checkCols = [];
  if (wellCol > 0) checkCols.push(wellCol - 1);
  if (wellCol < COLS - 1) checkCols.push(wellCol + 1);
  for (const cx of checkCols) {
    const isAnchored = (baseBoard[ROWS - 1] & (1 << cx)) !== 0;
    if (!isAnchored) { console.warn(`[AGENT][worker] Fast-Fail: pared sin anclaje en Col ${cx}.`); return false; }
    for (let y = 1; y < ROWS; y++) {
      const isOccAbove = (baseBoard[y - 1] & (1 << cx)) !== 0;
      const isEmptyCurr = (baseBoard[y] & (1 << cx)) === 0;
      if (isEmptyCurr && isOccAbove) { console.warn(`[AGENT][worker] Fast-Fail: pared rota en Col ${cx}, Y=${y}.`); return false; }
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
  let y = -matrix.length;
  if (collides(matrix, board, x, y)) return null;
  while (!collides(matrix, board, x, y + 1)) { y++; if (y > ROWS) return null; }
  return y;
}

function generatePlacements(board, currentTypeId) {
  if (currentTypeId === null || currentTypeId === undefined) { console.warn('[AGENT][placements] Fast-Fail.'); return []; }
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
      placements.push({ typeId: currentTypeId, position: { x, y, rotation, matrix } });
    }
  });
  return placements;
}

function simulatePlacementAndClearLines(board, placement) {
  if (!placement || !placement.position) { console.warn('[AGENT][simulate] Fast-Fail.'); return null; }
  const { x, y, matrix, rotation } = placement.position;
  if (x === undefined || y === undefined || !matrix) { console.warn('[AGENT][simulate] Fast-Fail.'); return null; }
  const newBoard = board.slice();
  const maskRows = PIECE_MASKS[placement.typeId]?.[rotation];
  for (let ry = 0; ry < matrix.length; ry++) {
    const ny = y + ry;
    if (ny < 0) continue;
    if (ny >= ROWS) return null;
    const rowMask = maskRows ? maskRows[ry] : matrixMask(matrix[ry]);
    const shifted = rowMask << x;
    if (shifted & newBoard[ny]) return null;
    newBoard[ny] = newBoard[ny] | shifted;
  }
  const compacted = new Uint16Array(ROWS);
  let writeIndex = ROWS - 1;
  let linesCleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (newBoard[r] === FULL_MASK) { linesCleared++; continue; }
    compacted[writeIndex] = newBoard[r]; writeIndex--;
  }
  while (writeIndex >= 0) { compacted[writeIndex] = 0; writeIndex--; }
  return { board: compacted, linesCleared };
}

// --- Utilidades ---
function toBitBoard(board) {
  const bitRows = new Uint16Array(ROWS);
  for (let y = 0; y < ROWS; y++) {
    let mask = 0;
    const row = board[y];
    for (let x = 0; x < COLS; x++) { if (row[x] !== EMPTY) mask |= (1 << x); }
    bitRows[y] = mask;
  }
  return bitRows;
}
function hashBitBoard(bitboard) { return bitboard.join('|'); }
function matrixMask(row) { let mask = 0; for (let x = 0; x < row.length; x++) { if (row[x]) mask |= (1 << x); } return mask; }
function buildPieceMasks(tetrominos) {
  const masks = [];
  PIECE_TYPES.forEach((key, typeId) => {
    const rotations = tetrominos[key]?.map((shape) => shape.map((row) => matrixMask(row))) || [];
    masks[typeId] = rotations;
  });
  return masks;
}
