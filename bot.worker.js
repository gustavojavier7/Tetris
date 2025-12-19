// bot.worker.js - Worker de IA para evaluación topológica y planificación de colocaciones

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
  return board
    .map((row) => row.map((cell) => (cell === EMPTY ? '0' : '1')).join(''))
    .join(';');
}

function planBestSequence(board, bagTypeIds) {
  // CONFIGURACIÓN DE RENDIMIENTO
  const BEAM_WIDTH = 15; // Número de "futuros" a mantener vivos. (Bajar a 5-10 si hay lag)

  if (!BoardAnalyzer.validate(board)) {
    return { deltaAopen: 0, finalRugosidad: 0, path: [] };
  }

  // 1. Preparar secuencia y métricas iniciales
  const sequence = Array.isArray(bagTypeIds)
    ? bagTypeIds.filter((id) => id !== null && id !== undefined)
    : [];

  if (sequence.length === 0) return { path: [] };

  const topology0 = analyzeTopology(board);
  const metrics0 = computeStateMetrics(topology0);
  const A0 = metrics0?.A_open ?? 0;

  // 2. Estado inicial del haz (Beam)
  // Cada candidato guarda su tablero actual y la ruta de movimientos que llevó ahí
  let candidates = [{
    board: board,
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
        const h = hashBoard(nextBoard);
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
    candidates = nextCandidates.slice(0, BEAM_WIDTH);
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
