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
    lines: 100,
    holes: -400,
    blocked: -80,
    rowTrans: -40,
    colTrans: -40,
    bumpiness: -5,
    bumpRisk: 1000,
    aggHeight: -4,
    wells: -20,
    landingHeight: 5
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

// --- 6. FUNCIONES AUXILIARES DE EVALUACIÓN (SIN CAMBIOS) ---

function calculateWells(heights) {
    let wells = 0;
    for (let x = 0; x < WIDTH; x++) {
        let leftH = (x === 0) ? Infinity : heights[x - 1];
        let rightH = (x === WIDTH - 1) ? Infinity : heights[x + 1];
        let wellDepth = Math.max(0, Math.min(leftH, rightH) - heights[x]);
        wells += wellDepth;
    }
    return wells;
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

/**
 * Mutación Controlada: modifica pesos de forma aleatoria con límites para evitar valores extremos
 */
function mutate(weights) {
    const mutated = { ...weights };
    // Límites razonables para cada peso para evitar sesgos extremos
    const WEIGHT_BOUNDS = {
        lines: [50, 200],
        holes: [-500, -200],
        blocked: [-100, -30],
        rowTrans: [-50, -20],
        colTrans: [-50, -20],
        bumpiness: [-10, -2],
        bumpRisk: [500, 1500],
        aggHeight: [-10, -2],
        wells: [-30, -10],
        landingHeight: [2, 10]
    };

    for (const key in mutated) {
        if (Object.prototype.hasOwnProperty.call(mutated, key)) {
            if (Math.random() < TRAINING_CONFIG.MUTATION_RATE) {
                const delta = mutated[key] * TRAINING_CONFIG.MUTATION_STEP * (Math.random() - 0.5) * 2;
                mutated[key] += delta;
                // Aplicar límites para evitar pesos extremos que rompan la evaluación
                mutated[key] = Math.max(WEIGHT_BOUNDS[key][0], Math.min(WEIGHT_BOUNDS[key][1], mutated[key]));
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

// --- 8. EVALUACIÓN (SIN CAMBIOS, PERO CON ROTACIÓN ALINEADA) ---
function evaluateState(board, linesCleared, landingY, weights) {
    let holes = 0;
    let blocked = 0;
    const heights = new Array(WIDTH).fill(0);
    
    for (let x = 0; x < WIDTH; x++) {
        let colHeight = 0;
        let blockFound = false;
        let holeFoundBelow = false;

        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x] !== 0) {
                if (!blockFound) {
                    colHeight = HEIGHT - y;
                    blockFound = true;
                }
            } else if (blockFound) {
                holes++;
            }
        }
        heights[x] = colHeight;

        for (let y = HEIGHT - 1; y >= 0; y--) {
            if (board[y][x] === 0) {
                holeFoundBelow = true;
            } else {
                if (holeFoundBelow) {
                    blocked++;
                }
            }
        }
    }

    let aggHeight = 0;
    let bumpiness = 0;
    let wells = 0;

    for (let x = 0; x < WIDTH; x++) {
        aggHeight += heights[x];
        if (x < WIDTH - 1) {
            bumpiness += Math.abs(heights[x] - heights[x + 1]);
        }

        let leftH = (x === 0) ? Infinity : heights[x - 1];
        let rightH = (x === WIDTH - 1) ? Infinity : heights[x + 1];
        let wellDepth = Math.max(0, Math.min(leftH, rightH) - heights[x]);
        wells += wellDepth;
    }

    const maxHeight = Math.max(...heights);
    const normalizedHeight = Math.min(1, maxHeight / HEIGHT);
    const bumpRisk = Math.pow(normalizedHeight, 4);
    const dynamicBump = weights.bumpiness - (weights.bumpRisk * bumpRisk);

    let rowTrans = 0;
    for (let y = 0; y < HEIGHT; y++) {
        let prev = 1;
        for (let x = 0; x < WIDTH; x++) {
            const filled = board[y][x] !== 0 ? 1 : 0;
            if (filled !== prev) rowTrans++;
            prev = filled;
        }
        if (prev === 0) rowTrans++;
    }

    let colTrans = 0;
    for (let x = 0; x < WIDTH; x++) {
        let prev = 1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
            const filled = board[y][x] !== 0 ? 1 : 0;
            if (filled !== prev) colTrans++;
            prev = filled;
        }
    }

    let score = 0;
    score += linesCleared * weights.lines;
    score += landingY * weights.landingHeight;
    score += holes * weights.holes;
    score += blocked * weights.blocked;
    score += rowTrans * weights.rowTrans;
    score += colTrans * weights.colTrans;
    score += bumpiness * dynamicBump;
    score += aggHeight * weights.aggHeight;
    score += wells * weights.wells;

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
                    const score = evaluateState(res.board, res.lines, y, weights);
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = { x, y, shape: currentShape };
                    }
                }
            }
            // Rotación EXACTA copiada de tetris.js para alinear la física
            currentShape = rotateGrid(currentShape);
        }

        if (!bestMove) break;

        board = lockPiece(board, bestMove.shape, bestMove.x, bestMove.y);
        const clearRes = removeLines(board);
        totalLines += clearRes.lines;
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
            type: 'NEW_WEIGHTS',
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
