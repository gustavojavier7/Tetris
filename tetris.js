// tetris.js - Motor Tetris con Modelo Geométrico Matricial v4.1 Integrado
// Compatible con indextetris.html y tetriscss.css (render DOM-based)

const COLS = 12;
const ROWS = 22;
const UNIT = 20; // Coincide con --unit en CSS

const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const BLOCK_CLASSES = ['block0', 'block1', 'block2', 'block3', 'block4', 'block5', 'block6'];

const TETROMINOS = {
  I: [[[1,1,1,1]], [[1],[1],[1],[1]]],
  O: [[[1,1],[1,1]]],
  T: [[[0,1,0],[1,1,1]], [[1,0],[1,1],[1,0]], [[1,1,1],[0,1,0]], [[0,1],[1,1],[0,1]]],
  S: [[[0,1,1],[1,1,0]], [[1,0],[1,1],[0,1]]],
  Z: [[[1,1,0],[0,1,1]], [[0,1],[1,1],[1,0]]],
  J: [[[1,0,0],[1,1,1]], [[1,1],[1,0],[1,0]], [[1,1,1],[0,0,1]], [[0,1],[0,1],[1,1]]],
  L: [[[0,0,1],[1,1,1]], [[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]]]
};

class GeometricEvaluator {
  static findHuecos(board) {
    const huecos = [];
    for (let top = 0; top < ROWS; top++) {
      for (let h = 2; h <= 5 && top + h <= ROWS; h++) {
        for (let left = 0; left < COLS; left++) {
          for (let w = 1; w <= 4 && left + w <= COLS; w++) {
            if (this.isValidHueco(board, top, left, h, w)) {
              huecos.push({top, left, h, w, area: h * w});
            }
          }
        }
      }
    }
    return huecos.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  static isValidHueco(board, top, left, h, w) {
    // 1) Volumen interno (incluye techo) completamente vacío
    for (let y = top; y < top + h; y++) {
      for (let x = left; x < left + w; x++) {
        if (board[y][x] !== -1) return false;
      }
    }

    // 2) Apertura total hacia arriba:
    // No puede haber ocupados por encima del techo en ninguna columna del hueco
    for (let x = left; x < left + w; x++) {
      for (let y = 0; y < top; y++) {
        if (board[y][x] !== -1) return false;
      }
    }

    // 3) Soporte lateral: columnas ADYACENTES, continuidad SOLO en altura del hueco
    const touchesLeftWall  = (left === 0);
    const touchesRightWall = (left + w === COLS);

    const leftSupport  = touchesLeftWall  || this.hasVerticalSupport(board, left - 1, top, h);
    const rightSupport = touchesRightWall || this.hasVerticalSupport(board, left + w, top, h);

    return leftSupport || rightSupport;
  }

  static hasVerticalSupport(board, col, top, h) {
    if (col < 0 || col >= COLS) return false;
    for (let y = top; y < top + h; y++) {
      if (board[y][col] === -1) return false; // debe ser ocupado en TODO el rango del hueco
    }
    return true;
  }

  static countAgujerosCanonicos(board) {
    let holes = 0;
    let depthSum = 0;

    for (let x = 0; x < COLS; x++) {
      let y = 0;
      while (y < ROWS) {
        // avanzar sobre ocupados
        while (y < ROWS && board[y][x] !== -1) y++;
        if (y >= ROWS) break;

        // segmento de ceros
        const yStart = y;
        while (y < ROWS && board[y][x] === -1) y++;
        const yEnd = y - 1;

        const baseOk = (yEnd + 1 < ROWS) && (board[yEnd + 1][x] !== -1);
        const roofOk = (yStart === 0) || (board[yStart - 1][x] !== -1);

        if (baseOk && roofOk) {
          holes++;
          depthSum += (yEnd - yStart + 1);
        }
      }
    }

    return { holes, depthSum };
  }

  static calculateCL(matrix, px, py, board) {
    let cl = 0;
    const h = matrix.length;
    const w = matrix[0].length;
    for (let ry = 0; ry < h; ry++) {
      const gy = py + ry;
      if (gy < 0 || gy >= ROWS) continue;

      for (let rx = 0; rx < w; rx++) {
        if (matrix[ry][rx]) {
          if (rx === 0 || matrix[ry][rx - 1] || px + rx - 1 < 0 || board[gy][px + rx - 1] !== -1) cl++;
          if (rx === w - 1 || matrix[ry][rx + 1] || px + rx + 1 >= COLS || board[gy][px + rx + 1] !== -1) cl++;
        }
      }
    }
    return cl;
  }

  static getShapeFit(pieceArea, hueco) {
    return hueco ? pieceArea / hueco.area : 0;
  }

  static buildHuecoMask(huecos) {
    const mask = Array.from({length: ROWS}, () => Array(COLS).fill(false));
    for (const hu of huecos) {
      for (let y = hu.top; y < hu.top + hu.h; y++) {
        for (let x = hu.left; x < hu.left + hu.w; x++) {
          mask[y][x] = true;
        }
      }
    }
    return mask;
  }

  static countPlacedInHuecos(matrix, px, py, huecoMask) {
    let c = 0;
    for (let ry = 0; ry < matrix.length; ry++) {
      for (let rx = 0; rx < matrix[ry].length; rx++) {
        if (!matrix[ry][rx]) continue;
        const y = py + ry, x = px + rx;
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS && huecoMask[y][x]) c++;
      }
    }
    return c;
  }
}

class TetrisGame {
  constructor() {
    this.board = Array.from({length: ROWS}, () => Array(COLS).fill(-1));
    this.area = document.getElementById('tetris-area');
    this.nextBox = document.getElementById('tetris-nextpuzzle');
    this.indicator = document.getElementById('bot-strategy-indicator');
    this.timerDisplay = document.getElementById('tetris-stats-time');

    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.iaAssist = false;
    this.paused = true;
    this.gameOver = false;
    this.lastTime = 0;

    this.bag = [];
    this.current = null;
    this.next = null;
    this.ghost = null;
    this.elapsedMs = 0;
    this.timerInterval = null;
    this.timerAnchor = null;

    this.initBag();
    this.next = this.getNextPieceType();
    this.spawnNewPiece();

    this.render();
    this.renderNext();
    this.updateIndicator();
    this.updateTimerDisplay();

    this.bindEvents();
    this.loop();
  }

  initBag() {
    if (this.bag.length === 0) {
      this.bag = [0, 1, 2, 3, 4, 5, 6];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
  }

  getNextPieceType() {
    this.initBag();
    const typeId = this.bag.pop();
    return {
      typeId,
      shapes: TETROMINOS[PIECE_TYPES[typeId]]
    };
  }

  spawnNewPiece() {
    this.current = this.next || this.getNextPieceType();
    this.next = this.getNextPieceType();

    this.current.x = Math.floor(COLS / 2) - Math.floor(this.current.shapes[0][0].length / 2);
    this.current.y = 0;
    this.current.rotation = 0;
    this.current.matrix = this.current.shapes[0];

    if (this.collides(this.current.matrix, this.current.x, this.current.y)) {
      this.gameOver = true;
      this.paused = true;
      this.stopTimer();
    }

    this.botThink(); // Calcula ghost si IA activa
    this.renderNext();
  }

  collides(matrix, px, py) {
    for (let ry = 0; ry < matrix.length; ry++) {
      for (let rx = 0; rx < matrix[ry].length; rx++) {
        if (matrix[ry][rx]) {
          const nx = px + rx;
          const ny = py + ry;
          if (nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && this.board[ny][nx] !== -1)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  bindEvents() {
    document.getElementById('playBtn').onclick = () => this.togglePause();
    document.getElementById('newGameBtn').onclick = () => this.reset();
    document.getElementById('iaAssistToggle').onclick = () => {
      this.iaAssist = !this.iaAssist;
      document.getElementById('iaAssistToggle').classList.toggle('active', this.iaAssist);
      this.updateIndicator();
      if (this.iaAssist) this.botThink();
    };
  }

  updateIndicator() {
    this.indicator.textContent = this.iaAssist ? 'IA ACTIVE' : 'MANUAL';
    this.indicator.className = 'bot-strategy ' + (this.iaAssist ? 'balanced' : '');
  }

  render() {
    this.area.innerHTML = '';
    // Locked pieces
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.board[y][x] >= 0) {
          this.createBlock(this.board[y][x], x, y);
        }
      }
    }
    // Ghost (si IA activa)
    if (this.ghost && this.iaAssist) this.renderPiece(this.ghost, true);
    // Current piece
    if (this.current) this.renderPiece(this.current, false);
  }

  createBlock(typeId, x, y, extraClass = '') {
    const div = document.createElement('div');
    div.className = BLOCK_CLASSES[typeId] + ' ' + extraClass;
    div.style.left = `${x * UNIT}px`;
    div.style.top = `${y * UNIT}px`;
    this.area.appendChild(div);
  }

  renderPiece(piece, isGhost = false) {
    const extra = isGhost ? 'bot-ghost' : 'bot-controlled';
    piece.matrix.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (val) {
          this.createBlock(piece.typeId, piece.x + dx, piece.y + dy, extra);
        }
      });
    });
  }

  renderNext() {
    this.nextBox.innerHTML = '';
    if (!this.next) return;
    const matrix = this.next.shapes[0];
    const offsetX = 2 - Math.floor(matrix[0].length / 2);
    const offsetY = 2 - Math.floor(matrix.length / 2);
    matrix.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (val) {
          const div = document.createElement('div');
          div.className = BLOCK_CLASSES[this.next.typeId];
          div.style.left = `${(dx + offsetX + 1) * UNIT}px`;
          div.style.top = `${(dy + offsetY + 1) * UNIT}px`;
          this.nextBox.appendChild(div);
        }
      });
    });
  }

  botThink() {
    if (!this.current) return;
    this.ghost = null;

    const pre = GeometricEvaluator.countAgujerosCanonicos(this.board);
    const huecos = GeometricEvaluator.findHuecos(this.board);
    const huecoMask = GeometricEvaluator.buildHuecoMask(huecos);

    const better = (a, b) => {
      if (!b) return true;
      if (a.lines !== b.lines) return a.lines > b.lines;
      if (a.deltaHoles !== b.deltaHoles) return a.deltaHoles < b.deltaHoles;
      if (a.holesReduced !== b.holesReduced) return a.holesReduced > b.holesReduced;
      if (a.huecoFill !== b.huecoFill) return a.huecoFill > b.huecoFill;
      if (a.cl !== b.cl) return a.cl > b.cl;
      if (a.y !== b.y) return a.y > b.y;
      if (a.depthSum !== b.depthSum) return a.depthSum < b.depthSum;
      return false;
    };

    let bestCandidate = null;

    // Iteramos por las rotaciones predefinidas en TETROMINOS
    this.current.shapes.forEach((shapeMatrix, rotationIdx) => {
      const width = shapeMatrix[0].length;

      // Barrido lateral
      for (let x = -1; x <= COLS - width + 1; x++) {
        // 1. Simular gravedad (Drop Y)
        let y = this.current.y;
        while (!this.collides(shapeMatrix, x, y + 1)) {
          y++;
        }

        // Si la pieza choca al nacer, posición inválida
        if (this.collides(shapeMatrix, x, y)) continue;

        // 2. Simular Estado Final con limpieza de líneas
        const {board: simulatedBoard, linesCleared} = this.getSimulatedBoardWithLines(shapeMatrix, x, y);

        // 3. Evaluación Geométrica
        const cl = GeometricEvaluator.calculateCL(shapeMatrix, x, y, this.board);
        const post = GeometricEvaluator.countAgujerosCanonicos(simulatedBoard);
        const deltaHoles = post.holes - pre.holes;
        const holesReduced = Math.max(0, pre.holes - post.holes);
        const huecoFill = GeometricEvaluator.countPlacedInHuecos(shapeMatrix, x, y, huecoMask);

        const candidate = {
          lines: linesCleared,
          deltaHoles,
          holesReduced,
          huecoFill,
          cl,
          y,
          depthSum: post.depthSum,
          matrix: shapeMatrix,
          rotation: rotationIdx,
          x
        };

        if (better(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    });

    if (bestCandidate) {
      this.ghost = {
        typeId: this.current.typeId,
        matrix: bestCandidate.matrix,
        rotation: bestCandidate.rotation,
        x: bestCandidate.x,
        y: bestCandidate.y
      };
    }

    this.render();
  }

  // Helper necesario para que el evaluador vea el futuro con líneas limpiadas
  getSimulatedBoardWithLines(matrix, px, py) {
    const clone = this.board.map(row => [...row]);
    matrix.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (val) {
          const ny = py + dy;
          const nx = px + dx;
          if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
            clone[ny][nx] = this.current.typeId;
          }
        }
      });
    });

    let filtered = clone.filter(row => row.some(cell => cell === -1));
    const linesCleared = ROWS - filtered.length;
    while (filtered.length < ROWS) {
      filtered.unshift(Array(COLS).fill(-1));
    }

    return {board: filtered, linesCleared};
  }

  getDropY() {
    let y = this.current.y;
    while (!this.collides(this.current.matrix, this.current.x, y + 1)) {
      y++;
    }
    return y;
  }

  executeBotMove() {
    if (!this.ghost) return;
    
    // 1. Aplicar la transformación geométrica elegida
    this.current.matrix = this.ghost.matrix; // Aplicar rotación
    this.current.rotation = this.ghost.rotation;
    this.current.x = this.ghost.x;
    this.current.y = this.ghost.y;

    // 2. Materializar el encastre (Punto 8.5)
    this.lockPiece();
    
    // Feedback visual opcional (resaltar el encastre)
    this.render();
  }

  applyGravity() {
    if (!this.collides(this.current.matrix, this.current.x, this.current.y + 1)) {
      this.current.y++;
      this.render();
    } else {
      this.lockPiece();
    }
  }

  lockPiece() {
    // 1. Integrar pieza al Tablero (Entidad base del sistema)
    this.current.matrix.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (val && this.board[this.current.y + dy]) {
           this.board[this.current.y + dy][this.current.x + dx] = this.current.typeId;
        }
      });
    });

    // 2. Limpieza de líneas (Reducción de entropía)
    this.board = this.board.filter(row => row.some(cell => cell === -1));
    const linesCleared = ROWS - this.board.length;
    this.score += linesCleared * 100; // Puntuación simple
    while (this.board.length < ROWS) {
        this.board.unshift(Array(COLS).fill(-1));
    }

    // 3. Generar nueva oportunidad
    this.spawnNewPiece();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.pauseTimer();
    } else if (!this.gameOver) {
      this.resumeTimer();
    }
  }

  reset() {
    this.board = Array.from({length: ROWS}, () => Array(COLS).fill(-1));
    this.bag = [];
    this.initBag();
    this.next = this.getNextPieceType();
    this.spawnNewPiece();
    this.gameOver = false;
    this.paused = true;
    this.lastTime = 0;
    this.elapsedMs = 0;
    this.stopTimer();
    this.updateTimerDisplay();
    this.render();
    this.renderNext();
  }

  loop(time = 0) {
    if (!this.paused && !this.gameOver) {
      // Velocidad reactiva: El bot juega rápido (50ms), el humano según nivel
      const dropInterval = this.iaAssist ? 50 : 1000 - (this.level * 50);
      const deltaTime = time - (this.lastTime || 0);

      if (deltaTime > dropInterval) {
        if (this.iaAssist) {
          this.executeBotMove(); // Ejecución inmediata del plan geométrico
        } else {
          this.applyGravity();   // Caída física normal
        }
        this.lastTime = time;
      }
    }
    requestAnimationFrame((t) => this.loop(t));
  }

  startTimer() {
    if (this.timerInterval) return;
    this.timerAnchor = performance.now();
    this.timerInterval = setInterval(() => this.tickTimer(), 250);
  }

  resumeTimer() {
    if (!this.timerInterval) this.startTimer();
    this.timerAnchor = performance.now();
  }

  pauseTimer() {
    if (this.timerAnchor !== null) {
      this.elapsedMs += performance.now() - this.timerAnchor;
      this.timerAnchor = null;
      this.updateTimerDisplay();
    }
  }

  stopTimer() {
    this.pauseTimer();
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  tickTimer() {
    if (this.paused || this.gameOver || this.timerAnchor === null) return;
    const now = performance.now();
    this.elapsedMs += now - this.timerAnchor;
    this.timerAnchor = now;
    this.updateTimerDisplay();
  }

  updateTimerDisplay() {
    if (!this.timerDisplay) return;
    const totalSeconds = Math.floor(this.elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    this.timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

window.addEventListener('load', () => new TetrisGame());
