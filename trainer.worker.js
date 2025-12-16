// --- CONFIGURACIÓN BÁSICA ---
const WIDTH = 10;
const HEIGHT = 20;
const TRAINING_CONFIG = {
    GAMES_PER_INDIVIDUAL: 5, // Aumentamos para reducir suerte
    MAX_MOVES: 500,
    MUTATION_RATE: 0.3,
    MUTATION_STEP: 0.05
};

// Definición de Piezas (Estándar)
const TETROMINOS = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]]
};

// Pesos Iniciales (Semilla Conservadora)
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

// --- MOTOR DE SIMULACIÓN LIGERO ---

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

// --- LÓGICA GENÉTICA (MUTACIÓN) ---

function mutate(weights) {
    const mutated = { ...weights };
    for (const key in mutated) {
        if (Object.prototype.hasOwnProperty.call(mutated, key)) {
            if (Math.random() < TRAINING_CONFIG.MUTATION_RATE) {
                const delta =
                    mutated[key] *
                    TRAINING_CONFIG.MUTATION_STEP *
                    (Math.random() - 0.5) *
                    2;
                mutated[key] += delta;
            }
        }
    }
    return mutated;
}

// --- EVALUACIÓN (Debe coincidir con la lógica del Main) ---
function evaluateState(board, linesCleared, landingY, weights) {
    const heights = [];
    let holes = 0,
        blocked = 0,
        wells = 0;
    let aggHeight = 0;

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
                holes++;
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

    let bumpiness = 0;
    for (let x = 0; x < WIDTH - 1; x++) bumpiness += Math.abs(heights[x] - heights[x + 1]);

    const maxHeight = Math.max(...heights);
    const normalizedHeight = Math.min(1, maxHeight / HEIGHT);
    const bumpRisk = Math.pow(normalizedHeight, 4);
    const dynamicBump = weights.bumpiness - weights.bumpRisk * bumpRisk;

    let rowTrans = 0;
    for (let y = 0; y < HEIGHT; y++) {
        let prev = 1;
        for (let x = 0; x < WIDTH; x++) {
            if (!!board[y][x] !== !!prev) rowTrans++;
            prev = board[y][x];
        }
        if (!prev) rowTrans++;
    }

    let colTrans = 0;
    for (let x = 0; x < WIDTH; x++) {
        let prev = 1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
            if (!!board[y][x] !== !!prev) colTrans++;
            prev = board[y][x];
        }
    }

    let score = 0;
    score += linesCleared * weights.lines;
    score += (HEIGHT - landingY) * weights.landingHeight;
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

    const piecesKeys = Object.keys(TETROMINOS);

    while (moves < TRAINING_CONFIG.MAX_MOVES) {
        const type = piecesKeys[Math.floor(Math.random() * piecesKeys.length)];
        const shape = TETROMINOS[type];

        let bestScore = -Infinity;
        let bestMove = null;

        let currentShape = shape;
        for (let r = 0; r < 4; r++) {
            const w = currentShape[0].length;
            for (let x = 0; x <= WIDTH - w; x++) {
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
            currentShape = currentShape[0].map((val, index) => currentShape.map((row) => row[index]).reverse());
        }

        if (!bestMove) break;

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
