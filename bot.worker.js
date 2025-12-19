// bot.worker.js - Worker de IA para Tetris preparado para evaluación topológica

// Este worker NO decide movimientos todavía.
// Su rol es preparar la infraestructura para una evaluación
// topológica del tablero basada en Regiones Vacías (RV).

const COLS = 12;
const ROWS = 22;
const EMPTY = -1;

class BoardAnalyzer {
  static validate(board) {
    return Array.isArray(board) && board.length === ROWS && board.every(r => Array.isArray(r) && r.length === COLS);
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
  if (!BoardAnalyzer.validate(board)) {
    console.warn('[AGENT][worker] Fast-Fail: datos inválidos para pensar.');
    return { ghost: null, mode: 'UNDEFINED' };
  }

  if (currentTypeId === null || currentTypeId === undefined) {
    console.warn('[AGENT][worker] Fast-Fail: pieza actual no definida.');
    return { ghost: null, mode: 'UNDEFINED' };
  }

  // La física y alcanzabilidad se resuelven fuera del evaluador; aquí solo se observa el tablero consolidado.
  const placements = generatePlacements(board, currentTypeId);

  if (!placements || placements.length === 0) {
    return { ghost: null, mode: 'UNDEFINED' };
  }

  const { bestPlacement } = chooseBestPlacement(board, placements);

  // Construcción parcial de ghost; se completará cuando matrix/rotation estén disponibles.
  let ghost = null;
  if (bestPlacement && bestPlacement.position) {
    const { x, y, rotation, matrix } = bestPlacement.position;
    if (x !== undefined && y !== undefined && rotation !== undefined && matrix) {
      ghost = { typeId: currentTypeId, rotation, x, y, matrix };
    } else {
      // TODO: ensamblar ghost con datos completos de colocación (matrix, rotación, etc.)
      ghost = null;
    }
  }

  const mode = 'UNDEFINED';
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

  const baseTopology = analyzeTopology(board);
  const baseMetrics = computeStateMetrics(baseTopology);

  let bestPlacement = null;
  let bestMetrics = baseMetrics;

  placements.forEach((placement) => {
    const simulatedBoard = simulatePlacementAndClearLines(board, placement);
    const topology = analyzeTopology(simulatedBoard);
    const metrics = computeStateMetrics(topology);

    if (!bestPlacement) {
      bestPlacement = placement;
      bestMetrics = metrics;
      return;
    }

    const verdict = compareStates(bestMetrics, metrics);
    if (verdict === 'WORSE') {
      bestPlacement = placement;
      bestMetrics = metrics;
    }
  });

  return { bestPlacement, bestMetrics };
}

// --- PLACEHOLDERS CONTROLADOS PARA LA INTEGRACIÓN DE SIMULACIÓN ---

function generatePlacements(board, currentTypeId) {
  // TODO: Generar todas las posiciones alcanzables para la pieza actual.
  return [];
}

function simulatePlacementAndClearLines(board, placement) {
  // TODO: Simular la pieza en el tablero y eliminar líneas completas.
  return board;
}
