// trainer.worker.js (VERSIÓN ALINEADA)

// --- 1. ALINEACIÓN DE DIMENSIONES ---
const WIDTH = 12;  // Sincronizado con tetris.js (this.areaX)
const HEIGHT = 22; // Sincronizado con tetris.js (this.areaY)

const TRAINING_CONFIG = {
    GAMES_PER_INDIVIDUAL: 5,
    MAX_MOVES: 500,
    MUTATION_RATE: 0.3,
    MUTATION_STEP: 0.05
};

// --- 2. ALINEACIÓN DE PIEZAS (Copia exacta de this.puzzles) ---
// Usamos índices 0-6 en lugar de nombres para garantizar la misma física de rotación
const PUZZLES = [
    [[0,0,1],[1,1,1],[0,0,0]], // 0: L
    [[1,0,0],[1,1,1],[0,0,0]], // 1: J
    [[0,1,1],[1,1,0],[0,0,0]], // 2: S
    [[1,1,0],[0,1,1],[0,0,0]], // 3: Z
    [[0,1,0],[1,1,1],[0,0,0]], // 4: T
    [[1,1],[1,1]],             // 5: O
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] // 6: I
];

// Pesos Iniciales
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

// --- MOTOR DE SIMULACIÓN ---

function initBoard() {
    return Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
}

function getDropY(board, shape, x) {
    let y = -2;
    // Bajar hasta chocar
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
                // Límites del tablero
                if (newX < 0 || newX >= WIDTH || newY >= HEIGHT) return false;
                if (newY < 0) continue; // Ignorar espacio sobre el techo
                if (board[newY][newX] !== 0) return false; // Colisión
            }
        }
    }
    return true;
}

function lockPiece(board, shape, x, y) {
    // Copia profunda del tablero para no alterar el estado previo en simulaciones
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

// --- FUNCIONES AUXILIARES DE EVALUACIÓN (Sincronizadas) ---

function calculateWells(heights) {
    let wells = 0;
    for (let x = 0; x < WIDTH; x++) {
        // Paredes laterales cuentan como altura infinita
        let leftH = (x === 0) ? Infinity : heights[x - 1];
        let rightH = (x === WIDTH - 1) ? Infinity : heights[x + 1];
        
        let wellDepth = Math.max(0, Math.min(leftH, rightH) - heights[x]);
        wells += wellDepth;
    }
    return wells;
}

// --- LÓGICA GENÉTICA ---

function mutate(weights) {
    const mutated = { ...weights };
    for (const key in mutated) {
        if (Object.prototype.hasOwnProperty.call(mutated, key)) {
            if (Math.random() < TRAINING_CONFIG.MUTATION_RATE) {
                const delta = mutated[key] * TRAINING_CONFIG.MUTATION_STEP * (Math.random() - 0.5) * 2;
                mutated[key] += delta;
            }
        }
    }
    return mutated;
}

function evaluateState(board, linesCleared, landingY, weights) {
    const heights = [];
    let holes = 0, blocked = 0;
    let aggHeight = 0;

    // 1. Calcular Alturas, Huecos y Bloqueos
    for (let x = 0; x < WIDTH; x++) {
        let colHeight = 0;
        let foundBlock = false;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x]) {
                if (!foundBlock) {
                    colHeight = HEIGHT - y;
                    foundBlock = true;
                }
            } else if (foundBlock) {
                holes++; // Hueco encontrado
                // Verificar si está bloqueado (tiene techo)
                let k = y - 1;
                while (k >= 0 && board[k][x]) {
                    blocked++;
                    k--;
                }
            }
        }
        heights[x] = colHeight;
        aggHeight += colHeight;
    }

    // 2. Calcular Rugosidad (Bumpiness)
    let bumpiness = 0;
    for (let x = 0; x < WIDTH - 1; x++) {
        bumpiness += Math.abs(heights[x] - heights[x + 1]);
    }

    // 3. --- ALINEACIÓN: Cálculo Real de Pozos (Wells) ---
    // (Antes faltaba o estaba a 0)
    const wells = calculateWells(heights);

    // 4. Aversión Dinámica (Bump Risk)
    const maxHeight = Math.max(...heights);
    const normalizedHeight = Math.min(1, maxHeight / HEIGHT);
    const bumpRisk = Math.pow(normalizedHeight, 4);
    const dynamicBump = weights.bumpiness - (weights.bumpRisk * bumpRisk);

    // 5. Transiciones (Solidez)
    let rowTrans = 0;
    for (let y = 0; y < HEIGHT; y++) {
        let prev = 1; // Pared izquierda sólida
        for (let x = 0; x < WIDTH; x++) {
            if (!!board[y][x] !== !!prev) rowTrans++;
            prev = board[y][x];
        }
        if (!prev) rowTrans++; // Pared derecha sólida
    }

    let colTrans = 0;
    for (let x = 0; x < WIDTH; x++) {
        let prev = 1; // Suelo sólido
        for (let y = HEIGHT - 1; y >= 0; y--) {
            if (!!board[y][x] !== !!prev) colTrans++;
            prev = board[y][x];
        }
    }

    // 6. Score Final
    let score = 0;
    score += linesCleared * weights.lines;
    score += landingY * weights.landingHeight; // GRAVEDAD CORRECTA (Y positivo)
    score += holes * weights.holes;
    score += blocked * weights.blocked;
    score += rowTrans * weights.rowTrans;
    score += colTrans * weights.colTrans;
    score += bumpiness * dynamicBump;
    score += aggHeight * weights.aggHeight;
    score += wells * weights.wells;

    return score;
}

// --- BUCLE DE SIMULACIÓN ---

function playOneGame(weights) {
    let board = initBoard();
    let totalLines = 0;
    let moves = 0;

    while (moves < TRAINING_CONFIG.MAX_MOVES) {
        // Seleccionar pieza aleatoria del set sincronizado
        const typeIdx = Math.floor(Math.random() * PUZZLES.length);
        const shape = PUZZLES[typeIdx];

        let bestScore = -Infinity;
        let bestMove = null;

        let currentShape = shape;
        
        // Probar las 4 rotaciones
        for (let r = 0; r < 4; r++) {
            const width = currentShape[0].length; // Ancho de la matriz de la pieza
            // Probar todas las columnas posibles
            for (let x = 0; x <= WIDTH - width; x++) {
                const y = getDropY(board, currentShape, x);
                if (isValid(board, currentShape, x, y)) {
                    // Simular bloqueo
                    const nextBoard = lockPiece(board, currentShape, x, y);
                    const res = removeLines(nextBoard);
                    // Evaluar
                    const score = evaluateState(res.board, res.lines, y, weights);
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = { x, y, shape: currentShape };
                    }
                }
            }
            // Rotar matriz 90 grados (misma lógica que tetris.js)
            // Nota: tetris.js crea una nueva matriz vacía, aquí usamos map/reverse para brevedad pero
            // el efecto geométrico debe ser el mismo.
            // Para asegurar paridad estricta con tetris.js 'rotateGrid':
            const N = currentShape.length; // Filas
            const M = currentShape[0].length; // Cols
            const rotated = Array.from({length: M}, () => Array(N).fill(0));
            for (let i = 0; i < N; i++) {
                for (let j = 0; j < M; j++) {
                    // newY = M - 1 - j (pero tetris.js hace newY = size-1-x... ojo con dimensiones no cuadradas)
                    // tetris.js 'rotate' asume matriz cuadrada para la rotación interna lógica 
                    // o ajusta offsets.
                    // Para simplificar y asegurar compatibilidad con matrices NO cuadradas (I piece 4x4 es cuadrada, otras no),
                    // usaremos la rotación estándar de matrices: Transponer + Reverse filas
                    rotated[j][N - 1 - i] = currentShape[i][j];
                }
            }
            currentShape = rotated;
        }

        if (!bestMove) break; // Game Over

        board = lockPiece(board, bestMove.shape, bestMove.x, bestMove.y);
        const clearRes = removeLines(board);
        totalLines += clearRes.lines;
        moves++;
    }
    return totalLines;
}

function trainStep() {
    if (!active) return;

    const candidateWeights = mutate(currentBestWeights);

    let totalScore = 0;
    for (let i = 0; i < TRAINING_CONFIG.GAMES_PER_INDIVIDUAL; i++) {
        totalScore += playOneGame(candidateWeights);
    }
    const avgScore = totalScore / TRAINING_CONFIG.GAMES_PER_INDIVIDUAL;

    if (bestFitness === -Infinity || avgScore > bestFitness) {
        bestFitness = avgScore;
        currentBestWeights = candidateWeights;

        self.postMessage({
            type: 'NEW_WEIGHTS',
            weights: currentBestWeights,
            fitness: bestFitness,
        });
    }

    setTimeout(trainStep, 0);
}

// --- COMUNICACIÓN ---
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
