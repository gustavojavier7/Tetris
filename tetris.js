// tetris.js - Motor Tetris con Modelo Geométrico Matricial v4.1 Integrado
// Compatible con indextetris.html y tetriscss.css (render DOM-based)

const COLS = 10;
const ROWS = 20;
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
    // Techo vacío + vacío interno + apertura total arriba
    for (let y = 0; y < top + h; y++) {
      for (let x = left; x < left + w; x++) {
        if (y < top || board[y][x] !== -1) return false;
      }
    }
    // Soporte lateral continuo (al menos uno, pared implícita)
    const leftOk = left === 0 || this.hasSupportBelow(board, left, top + h);
    const rightOk = left + w === COLS || this.hasSupportBelow(board, left + w - 1, top + h);
    return leftOk || rightOk;
  }

  static hasSupportBelow(board, col, row) {
    for (let y = row; y < ROWS; y++) {
      if (board[y][col] !== -1) return true;
    }
    return true; // Fondo del tablero como soporte
  }

  static calculateAgujeros(board) {
    let total = 0;
    for (let c = 0; c < COLS; c++) {
      let roofFound = false;
      let depth = 0;
      for (let r = 0; r < ROWS; r++) {
        if (board[r][c] !== -1) {
          total += depth;
          roofFound = true;
          depth = 0;
        } else if (roofFound) {
          depth++;
        }
      }
    }
    return total;
  }

  static calculateCL(matrix, px, py, board) {
    let cl = 0;
    const h = matrix.length;
    const w = matrix[0].length;
    for (let ry = 0; ry < h; ry++) {
      for (let rx = 0; rx < w; rx++) {
        if (matrix[ry][rx]) {
          if (rx === 0 || matrix[ry][rx - 1] || px + rx - 1 < 0 || board[py + ry][px + rx - 1] !== -1) cl++;
          if (rx === w - 1 || matrix[ry][rx + 1] || px + rx + 1 >= COLS || board[py + ry][px + rx + 1] !== -1) cl++;
        }
      }
    }
    return cl;
  }

  static getShapeFit(pieceArea, hueco) {
    return hueco ? pieceArea / hueco.area : 0;
  }
}

class TetrisGame {
  constructor() {
    this.board = Array.from({length: ROWS}, () => Array(COLS).fill(-1));
    this.area = document.getElementById('tetris-area');
    this.nextBox = document.getElementById('tetris-nextpuzzle');
    this.indicator = document.getElementById('bot-strategy-indicator');

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

    this.initBag();
    this.next = this.getNextPieceType();
    this.spawnNewPiece();

    this.render();
    this.renderNext();
    this.updateIndicator();

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
    
    let bestScore = -Infinity;
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

        // 2. Simular Estado Final (Punto 10 Mapa Mental)
        const simulatedBoard = this.getSimulatedBoard(shapeMatrix, x, y);
        
        // 3. Evaluación Geométrica (Puntos 8.3 y 6)
        // Beneficio: Estabilidad (CL) y Profundidad (y)
        const cl = GeometricEvaluator.calculateCL(shapeMatrix, x, y, this.board);
        // Costo: Deuda Estructural (Agujeros)
        const holes = GeometricEvaluator.calculateAgujeros(simulatedBoard);
        
        // Función de Energía (Pesos ajustables)
        // Valoramos mucho el CL (Estabilidad) y penalizamos fuerte los Agujeros
        const score = (cl * 2.5) + (y * 1.0) - (holes * 20.0);

        if (score > bestScore) {
          bestScore = score;
          this.ghost = {
            typeId: this.current.typeId,
            matrix: shapeMatrix, // Guardamos la matriz rotada correcta
            rotation: rotationIdx,
            x: x,
            y: y
          };
        }
      }
    });
    
    this.render();
  }

  // Helper necesario para que el evaluador vea el futuro
  getSimulatedBoard(matrix, px, py) {
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
    return clone;
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
}

window.addEventListener('load', () => new TetrisGame());
