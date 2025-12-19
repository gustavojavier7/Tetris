// bot.worker.js - Worker de IA para Tetris preparado para evaluación topológica

// Este worker NO decide movimientos todavía.
// Su rol es preparar la infraestructura para una evaluación
// topológica del tablero basada en Regiones Vacías (RV).

const COLS = 12;
const ROWS = 22;
const EMPTY = -1;
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
  const sequence = Array.isArray(bagTypeIds) && bagTypeIds.length > 0
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
  const visited = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(false)
  );

  const openCells = [];
  let openArea = 0;
  let openMinY = ROWS;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  // --- 1. Flood fill desde el techo: RV abierta ---
  const stack = [];

  for (let x = 0; x < COLS; x++) {
    if (board[0][x] === EMPTY && !visited[0][x]) {
      visited[0][x] = true;
      stack.push({ x, y: 0 });
    }
  }

  while (stack.length) {
    const { x, y } = stack.pop();

    openCells.push({ x, y });
    openArea++;
    if (y < openMinY) openMinY = y;

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;

      if (
        nx >= 0 && nx < COLS &&
        ny >= 0 && ny < ROWS &&
        board[ny][nx] === EMPTY &&
        !visited[ny][nx]
      ) {
        visited[ny][nx] = true;
        stack.push({ x: nx, y: ny });
      }
    }
  }

  const openRV = {
    area: openArea,
    cells: openCells,
    minY: openMinY
  };

  // --- 2. Flood fill de RV cerradas ---
  const closedRVs = [];

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (board[y][x] === EMPTY && !visited[y][x]) {
        const cells = [];
        let area = 0;

        const stack = [{ x, y }];
        visited[y][x] = true;

        while (stack.length) {
          const { x: cx, y: cy } = stack.pop();
          cells.push({ x: cx, y: cy });
          area++;

          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;

            if (
              nx >= 0 && nx < COLS &&
              ny >= 0 && ny < ROWS &&
              board[ny][nx] === EMPTY &&
              !visited[ny][nx]
            ) {
              visited[ny][nx] = true;
              stack.push({ x: nx, y: ny });
            }
          }
        }

        closedRVs.push({ area, cells });
      }
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
  // Perfil inferior de la RV abierta por columna
  const bottomProfile = Array(COLS).fill(-1);

  for (const { x, y } of openRV.cells) {
    if (y > bottomProfile[x]) {
      bottomProfile[x] = y;
    }
  }

  // Si una columna no tiene RV abierta, su perfil queda en -1
  // (esto es válido y expresa bloqueo completo)
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

function hashBoard(board) {
  return board.map((row) => row.join(',')).join(';');
}

function planBestSequence(board, bagTypeIds) {
  if (!BoardAnalyzer.validate(board)) {
    console.warn('[AGENT][planner] Fast-Fail: tablero inválido para planificar.');
    return { delta: 0, path: [] };
  }

  const sequence = Array.isArray(bagTypeIds)
    ? bagTypeIds.filter((id) => id !== null && id !== undefined)
    : [];

  if (sequence.length === 0) {
    return { delta: 0, path: [] };
  }

  const topology0 = analyzeTopology(board);
  const metrics0 = computeStateMetrics(topology0);
  const A0 = metrics0?.A_open ?? 0;

  const memo = new Map();

  function dfs(currentBoard, index) {
    if (index >= sequence.length) {
      const topology = analyzeTopology(currentBoard);
      const metrics = computeStateMetrics(topology);
      const Af = metrics?.A_open ?? 0;
      return { delta: Af - A0, path: [] };
    }

    const key = `${index}|${hashBoard(currentBoard)}`;
    if (memo.has(key)) return memo.get(key);

    const placements = generatePlacements(currentBoard, sequence[index]);
    let bestResult = null;

    placements.forEach((placement) => {
      const nextBoard = simulatePlacementAndClearLines(currentBoard, placement);
      if (!nextBoard) return;

      const child = dfs(nextBoard, index + 1);
      if (!child) return;

      const candidate = {
        delta: child.delta,
        path: [placement, ...child.path]
      };

      if (!bestResult || candidate.delta > bestResult.delta) {
        bestResult = candidate;
      }
    });

    if (!bestResult) {
      const topology = analyzeTopology(currentBoard);
      const metrics = computeStateMetrics(topology);
      const Af = metrics?.A_open ?? 0;
      bestResult = { delta: Af - A0, path: [] };
    }

    memo.set(key, bestResult);
    return bestResult;
  }

  return dfs(board, 0);
}

function compareStates(prevMetrics, nextMetrics) {
  if (!prevMetrics || !nextMetrics) return 'EQUIVALENT';

  if (nextMetrics.A_closed_total > prevMetrics.A_closed_total) return 'WORSE';
  if (nextMetrics.A_closed_total < prevMetrics.A_closed_total) return 'BETTER';

  if (nextMetrics.A_open > prevMetrics.A_open) return 'BETTER';
  if (nextMetrics.A_open < prevMetrics.A_open) return 'WORSE';

  const prevRug = prevMetrics.geometric?.rugosidad;
  const nextRug = nextMetrics.geometric?.rugosidad;
  if (typeof nextRug === 'number' && typeof prevRug === 'number') {
    if (nextRug < prevRug) return 'BETTER';
    if (nextRug > prevRug) return 'WORSE';
  }

  return 'EQUIVALENT';
}

function chooseBestPlacement(board, placements) {
  if (!Array.isArray(placements) || placements.length === 0) return null;

  let bestPlacement = null;
  let bestMetrics = null;

  placements.forEach((placement) => {
    const simulatedBoard = simulatePlacementAndClearLines(board, placement);
    if (!simulatedBoard) return; // placement físicamente inválido

    const topology = analyzeTopology(simulatedBoard);
    const metrics = computeStateMetrics(topology);

    if (!bestPlacement) {
      bestPlacement = placement;
      bestMetrics = metrics;
      return;
    }

    const verdict = compareStates(bestMetrics, metrics);
    if (verdict === 'BETTER') {
      bestPlacement = placement;
      bestMetrics = metrics;
    }
  });

  return { bestPlacement, bestMetrics };
}

// --- Capa física pura: alcanzabilidad y consolidación ---

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
  if (!BoardAnalyzer.validate(board)) {
    console.warn('[AGENT][placements] Fast-Fail: tablero inválido.');
    return [];
  }
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
  if (!BoardAnalyzer.validate(board) || !placement || !placement.position) {
    console.warn('[AGENT][simulate] Fast-Fail: datos inválidos de simulación.');
    return board.map((row) => row.slice());
  }

  const clonedBoard = board.map((row) => row.slice());
  const { x, y, matrix } = placement.position;
  const typeId = placement.typeId;

  if (x === undefined || y === undefined || !matrix) {
    console.warn('[AGENT][simulate] Fast-Fail: posición o matriz inválida.');
    return null;
  }

  for (let ry = 0; ry < matrix.length; ry++) {
    for (let rx = 0; rx < matrix[ry].length; rx++) {
      if (!matrix[ry][rx]) continue;

      const nx = x + rx;
      const ny = y + ry;
      if (ny < 0) continue; // parte de la pieza aún fuera del tablero
      if (ny >= ROWS || nx < 0 || nx >= COLS) return null;

      // Colisión inesperada → placement inválido
      if (clonedBoard[ny][nx] !== EMPTY) return null;

      clonedBoard[ny][nx] =
        typeId !== undefined && typeId !== null ? typeId : 0;
    }
  }

  const consolidated = clonedBoard.filter((row) => row.some((cell) => cell === EMPTY));
  while (consolidated.length < ROWS) {
    consolidated.unshift(Array(COLS).fill(EMPTY));
  }

  return consolidated;
}
