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
  // TODO: Implementar detección de RV abierta y RV cerradas
  return {
    openRV: null,          // { area, cells, minY }
    closedRVs: []          // Array<{ area, cells }>
  };
}

function computeStateMetrics(topology) {
  // TODO: Derivar métricas del estado (A_open, A_closed_total, etc.)
  return {
    A_open: 0,
    A_closed_total: 0,
    geometric: {}
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
