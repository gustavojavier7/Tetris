// trainer.worker.js (VERSIÓN ALINEADA CON ALGORITMO GENÉTICO)

// --- 1. ALINEACIÓN DE DIMENSIONES ---
const WIDTH = 12;  // Sincronizado con tetris.js (this.areaX)
const HEIGHT = 22; // Sincronizado con tetris.js (this.areaY)

// --- 2. CONFIGURACIÓN DEL ALGORITMO GENÉTICO ---
const TRAINING_CONFIG = {
    POPULATION_SIZE: 20,       // Tamaño de la población por generación
    ELITISM_RATE: 0.1,         // Proporción de individuos elite a conservar (10%)
    CROSSOVER_RATE: 0.7,       // Probabilidad de cruzar dos padres
    GAMES_PER_INDIVIDUAL: 5,   // Partidas por individuo para reducir la suerte
    MAX_MOVES: 500,
    MUTATION_RATE: 0.3,
    MUTATION_STEP: 0.05
};

// --- 3. ALINEACIÓN DE PIEZAS (Copia exacta de this.puzzles) ---
const PUZZLES = [
    [[0,0,1],[1,1,1],[0,0,0]], // 0: L
    [[1,0,0],[1,1,1],[0,0,0]], // 1: J
    [[0,1,1],[1,1,0],[0,0,0]], // 2: S
    [[1,1,0],[0,1,1],[0,0,0]], // 3: Z
    [[0,1,0],[1,1,1],[0,0,0]], // 4: T
    [[1,1],[1,1]],             // 5: O
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] // 6: I
];

// --- 4. ESTADO GLOBAL DEL ENTRENAMIENTO ---
let currentBestWeights = {
    LINES_CLEARED: 3.2,
    HOLES: -2.0,
    DEEP_HOLES: -1.5,
    BLOCKED_CELLS: -0.8,
    AGGREGATE_HEIGHT: -0.51,
    MAX_HEIGHT: -0.6,
    BUMPINESS: -0.45,
    WELLS: -0.35,
    ROOF: -1.2,
    ROW_TRANSITIONS: -0.3,
    COL_TRANSITIONS: -0.35,
    PIT_DEPTH: -0.5,
    FLATNESS_BONUS: 0.2
};

let bestFitness = -Infinity;
let active = false;

// --- 5. MOTOR DE SIMULACIÓN (SIN CAMBIOS, PERO CON ROTACIÓN ALINEADA) ---

function initBoard() {
    return Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
}

function getDropY(board, shape, x) {
    let y = -2;
    while (true) {
        if (!isValid(board, shape, x, y + 1)) break;
        y++;
    }
    return y;
}

function isValid(board, shape, x, y) {
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c]) {
                const newX = x + c;
                const newY = y + r;
                if (newX < 0 || newX >= WIDTH || newY >= HEIGHT) return false;
                if (newY < 0) continue;
                if (board[newY][newX] !== 0) return false;
            }
        }
    }
    return true;
}

function lockPiece(board, shape, x, y) {
    const newBoard = board.map((row) => row.slice());
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c] && y + r >= 0) {
                newBoard[y + r][x + c] = 1;
            }
        }
    }
    return newBoard;
}

function removeLines(board) {
    let lines = 0;
    const newBoard = board.filter((row) => {
        if (row.every((cell) => cell !== 0)) {
            lines++;
            return false;
        }
        return true;
    });
    while (newBoard.length < HEIGHT) {
        newBoard.unshift(Array(WIDTH).fill(0));
    }
    return { board: newBoard, lines };
}

// ==============================
// HEURISTIC METRICS (shared)
// ==============================

function getColumnHeights(board) {
    const heights = new Array(WIDTH).fill(0);
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x]) {
                heights[x] = HEIGHT - y;
                break;
            }
        }
    }
    return heights;
}

function countHoles(board) {
    let holes = 0;
    for (let x = 0; x < WIDTH; x++) {
        let blockFound = false;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x]) {
                blockFound = true;
            } else if (blockFound) {
                holes++;
            }
        }
    }
    return holes;
}

function countDeepHoles(board) {
    let deepHoles = 0;
    for (let x = 0; x < WIDTH; x++) {
        let blocksAbove = 0;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x]) {
                blocksAbove++;
            } else if (blocksAbove > 1) {
                deepHoles++;
            }
        }
    }
    return deepHoles;
}

function countBlockedCells(board) {
    let blocked = 0;
    for (let x = 0; x < WIDTH; x++) {
        let holeFound = false;
        for (let y = HEIGHT - 1; y >= 0; y--) {
            if (!board[y][x]) {
                holeFound = true;
            } else if (holeFound) {
                blocked++;
            }
        }
    }
    return blocked;
}

function countWells(board, heights = getColumnHeights(board)) {
    let wells = 0;
    for (let x = 0; x < WIDTH; x++) {
        const leftH = x === 0 ? Infinity : heights[x - 1];
        const rightH = x === WIDTH - 1 ? Infinity : heights[x + 1];
        const wellDepth = Math.max(0, Math.min(leftH, rightH) - heights[x]);
        wells += wellDepth;
    }
    return wells;
}

function getBumpiness(heights) {
    let bumpiness = 0;
    for (let x = 0; x < heights.length - 1; x++) {
        bumpiness += Math.abs(heights[x] - heights[x + 1]);
    }
    return bumpiness;
}

function getAggregateHeight(heights) {
    return heights.reduce((sum, h) => sum + h, 0);
}

function getMaxHeight(heights) {
    return heights.reduce((max, h) => Math.max(max, h), 0);
}

function countRowTransitions(board) {
    let transitions = 0;
    for (let y = 0; y < HEIGHT; y++) {
        let prev = 1;
        for (let x = 0; x < WIDTH; x++) {
            const filled = board[y][x] ? 1 : 0;
            if (filled !== prev) transitions++;
            prev = filled;
        }
        if (prev === 0) transitions++;
    }
    return transitions;
}

function countColTransitions(board) {
    let transitions = 0;
    for (let x = 0; x < WIDTH; x++) {
        let prev = 1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
            const filled = board[y][x] ? 1 : 0;
            if (filled !== prev) transitions++;
            prev = filled;
        }
    }
    return transitions;
}

function countRoofedHoles(board) {
    let roofed = 0;
    for (let x = 0; x < WIDTH; x++) {
        for (let y = 1; y < HEIGHT; y++) {
            if (!board[y][x] && board[y - 1][x]) {
                roofed++;
            }
        }
    }
    return roofed;
}

function getPitDepth(heights) {
    const maxHeight = getMaxHeight(heights);
    return heights.reduce((sum, h) => sum + (maxHeight - h), 0);
}

function getFlatness(heights) {
    if (!heights.length) return 0;
    const avg = heights.reduce((sum, h) => sum + h, 0) / heights.length;
    const variance = heights.reduce((sum, h) => sum + Math.pow(h - avg, 2), 0) / heights.length;
    const stdDev = Math.sqrt(variance);
    return 1 / (1 + stdDev);
}

// --- 7. LÓGICA GENÉTICA NUEVA ---

/**
 * Inicializa la población: empieza por el mejor individuo actual y muta para generar el resto
 * Evita empezar de cero y acelera la convergencia
 */
function initPopulation() {
    const population = [];
    // Agregar el mejor individuo actual como semilla
    population.push({ weights: { ...currentBestWeights }, fitness: 0 });
    // Generar el resto de la población mutando la semilla
    for (let i = 1; i < TRAINING_CONFIG.POPULATION_SIZE; i++) {
        population.push({ weights: mutate({ ...currentBestWeights }), fitness: 0 });
    }
    return population;
}

/**
 * Selección por Torneo: elige un padre robustamente sin que se dominen por individuos extremos
 */
function tournamentSelection(population, tournamentSize = 3) {
    const tournament = [];
    // Seleccionar individuos aleatorios para el torneo
    for (let i = 0; i < tournamentSize; i++) {
        const randomIdx = Math.floor(Math.random() * population.length);
        tournament.push(population[randomIdx]);
    }
    // Devolver el individuo con mayor fitness del torneo
    return tournament.reduce((best, current) => current.fitness > best.fitness ? current : best, tournament[0]);
}

/**
 * Cruce Uniforme: combina pesos de dos padres para crear un descendiente
 * Cada peso se hereda de uno de los padres con 50% de probabilidad
 */
function crossover(parentA, parentB) {
    const child = { ...parentA.weights };
    for (const key in child) {
        if (Object.prototype.hasOwnProperty.call(child, key) && Math.random() < TRAINING_CONFIG.CROSSOVER_RATE) {
            child[key] = parentB.weights[key];
        }
    }
    return child;
}

const WEIGHT_RANGES = {
    LINES_CLEARED: [0, 6],
    HOLES: [-3, 0],
    DEEP_HOLES: [-3, 0],
    BLOCKED_CELLS: [-2, 0],
    AGGREGATE_HEIGHT: [-1.5, 0],
    MAX_HEIGHT: [-1.5, 0],
    BUMPINESS: [-1.2, 0],
    WELLS: [-1, 0],
    ROOF: [-2, 0],
    ROW_TRANSITIONS: [-1, 0],
    COL_TRANSITIONS: [-1, 0],
    PIT_DEPTH: [-1.5, 0],
    FLATNESS_BONUS: [0, 1]
};

function gaussianNoise() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Mutación Controlada: modifica pesos de forma aleatoria con límites para evitar valores extremos
 */
function mutate(weights) {
    const mutated = { ...weights };
    for (const key in mutated) {
        if (Object.prototype.hasOwnProperty.call(mutated, key)) {
            if (Math.random() < TRAINING_CONFIG.MUTATION_RATE) {
                const range = WEIGHT_RANGES[key][1] - WEIGHT_RANGES[key][0];
                mutated[key] += gaussianNoise() * range * 0.05;
                // Aplicar límites para evitar pesos extremos que rompan la evaluación
                mutated[key] = Math.max(WEIGHT_RANGES[key][0], Math.min(WEIGHT_RANGES[key][1], mutated[key]));
            }
        }
    }
    return mutated;
}

/**
 * Elitismo: conserva los mejores individuos de la generación para no perder progreso
 */
function selectElites(population) {
    const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
    const eliteCount = Math.ceil(TRAINING_CONFIG.POPULATION_SIZE * TRAINING_CONFIG.ELITISM_RATE);
    return sorted.slice(0, eliteCount);
}

// --- 8. EVALUACIÓN ---
function evaluateBoard(board, linesCleared, weights) {
    const heights = getColumnHeights(board);

    const score =
        linesCleared * weights.LINES_CLEARED +
        countHoles(board) * weights.HOLES +
        countDeepHoles(board) * weights.DEEP_HOLES +
        countBlockedCells(board) * weights.BLOCKED_CELLS +
        getAggregateHeight(heights) * weights.AGGREGATE_HEIGHT +
        getMaxHeight(heights) * weights.MAX_HEIGHT +
        getBumpiness(heights) * weights.BUMPINESS +
        countWells(board, heights) * weights.WELLS +
        countRoofedHoles(board) * weights.ROOF +
        countRowTransitions(board) * weights.ROW_TRANSITIONS +
        countColTransitions(board) * weights.COL_TRANSITIONS +
        getPitDepth(heights) * weights.PIT_DEPTH +
        getFlatness(heights) * weights.FLATNESS_BONUS;

    return score;
}

// --- 9. BUCLE DE SIMULACIÓN CON ROTACIÓN ALINEADA ---
function playOneGame(weights) {
    let board = initBoard();
    let totalLines = 0;
    let moves = 0;

    while (moves < TRAINING_CONFIG.MAX_MOVES) {
        const typeIdx = Math.floor(Math.random() * PUZZLES.length);
        const shape = PUZZLES[typeIdx];

        let bestScore = -Infinity;
        let bestMove = null;

        let currentShape = shape;
        
        // Probar las 4 rotaciones con la lógica EXACTA de tetris.js
        for (let r = 0; r < 4; r++) {
            const width = currentShape[0].length;
            for (let x = 0; x <= WIDTH - width; x++) {
                const y = getDropY(board, currentShape, x);
                if (isValid(board, currentShape, x, y)) {
                    const nextBoard = lockPiece(board, currentShape, x, y);
                    const res = removeLines(nextBoard);
                    const score = evaluateBoard(res.board, res.lines, weights);

                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = { x, y, shape: currentShape, board: res.board, lines: res.lines };
                    }
                }
            }
            // Rotación EXACTA copiada de tetris.js para alinear la física
            currentShape = rotateGrid(currentShape);
        }

        if (!bestMove) break;

        board = bestMove.board;
        totalLines += bestMove.lines;
        moves++;
    }
    return totalLines;
}

/**
 * Rotación EXACTA copiada de tetris.js para alinear la física de piezas
 */
function rotateGrid(matrix) {
    const size = matrix.length;
    const rotated = Array.from({ length: size }, () => Array(size).fill(0));
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (matrix[y][x]) {
                const newY = size - 1 - x;
                const newX = y;
                rotated[newY][newX] = 1;
            }
        }
    }
    return rotated;
}

// --- 10. BUCLE DE ENTRENAMIENTO GENÉTICO ---
function trainStep() {
    if (!active) return;

    // 1. Inicializar población (empieza por el mejor individuo actual)
    let population = initPopulation();

    // 2. Evaluar cada individuo de la población
    for (let i = 0; i < population.length; i++) {
        let totalLines = 0;
        for (let g = 0; g < TRAINING_CONFIG.GAMES_PER_INDIVIDUAL; g++) {
            totalLines += playOneGame(population[i].weights);
        }
        population[i].fitness = totalLines / TRAINING_CONFIG.GAMES_PER_INDIVIDUAL;
    }

    // 3. Seleccionar elites para conservar los mejores individuos
    const elites = selectElites(population);

    // 4. Crear nueva población combinando elites y descendientes
    const newPopulation = [...elites];

    // 5. Generar descendientes por cruce y mutación
    while (newPopulation.length < TRAINING_CONFIG.POPULATION_SIZE) {
        const parentA = tournamentSelection(population);
        const parentB = tournamentSelection(population);
        let childWeights = crossover(parentA, parentB);
        childWeights = mutate(childWeights);
        newPopulation.push({ weights: childWeights, fitness: 0 });
    }

    // 6. Actualizar el mejor individuo global y enviar al hilo principal
    const globalBest = elites[0];
    if (globalBest.fitness > bestFitness || bestFitness === -Infinity) {
        bestFitness = globalBest.fitness;
        currentBestWeights = { ...globalBest.weights };

        self.postMessage({
            type: 'BEST_WEIGHTS',
            weights: currentBestWeights,
            fitness: bestFitness,
        });
        console.log(`[GENÉTICA] Nueva mejor puntuación: ${bestFitness.toFixed(2)}`);
    }

    // 7. Siguiente generación
    setTimeout(trainStep, 0);
}

// --- 11. COMUNICACIÓN ---
self.onmessage = function (e) {
    if (e.data.command === 'START') {
        active = true;
        if (e.data.initialWeights) {
            currentBestWeights = e.data.initialWeights;
        }
        trainStep();
    } else if (e.data.command === 'STOP') {
        active = false;
    }
};
