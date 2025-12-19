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
  const topology = analyzeTopology(board);
  const metrics = computeStateMetrics(topology);

  // === PLACEHOLDER DE DECISIÓN ===
  // La lógica final de evaluación comparará estados consolidados
  // usando métricas topológicas (ΔA_open, ΔA_closed, etc.)
  // Esta sección será implementada en una iteración futura.
  const ghost = null;
  const mode = 'UNDEFINED';

  // Retornamos sin emitir decisiones automáticas; el consumidor podrá registrar métricas futuras.
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
