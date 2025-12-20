// tetris.js - Motor Tetris con Modelo Geométrico Matricial v4.1 Integrado

const COLS = 12;
const ROWS = 22;
let UNIT = 20; // Coincide con --unit en CSS y se ajusta al alto del contenedor

const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const BLOCK_CLASSES = ['block0', 'block1', 'block2', 'block3', 'block4', 'block5', 'block6'];

document.documentElement.style.setProperty('--area-x', COLS);
document.documentElement.style.setProperty('--area-y', ROWS);

function syncBoardScale(gameInstance = null) {
  const wrapper = document.querySelector('.game-board-wrapper');
  const board = document.querySelector('.game-board');
  if (!wrapper || !board) return;

  const wrapperHeight = wrapper.clientHeight;
  if (!wrapperHeight) return;
  const dynamicUnit = wrapperHeight / ROWS;

  document.documentElement.style.setProperty('--unit', `${dynamicUnit}px`);
  UNIT = dynamicUnit;
  board.style.height = `${wrapperHeight}px`;
  board.style.width = `${COLS * dynamicUnit}px`;

  if (gameInstance) {
    gameInstance.render();
    gameInstance.renderNext();
  }
}

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
    // [FIX] Fast-Fail Geométrico: Solo es hueco si hay contención BILATERAL.
    return leftSupport && rightSupport;
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
        const roofOk = (yStart > 0) && (board[yStart - 1][x] !== -1);

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
    this.activeBlocksDOM = [];
    this.initActiveBlocks();

    this.botWorker = new Worker('bot.worker.js');
    this.botWorker.onmessage = (e) => this.handleWorkerMessage(e);
    this.botRequestId = 0;
    this.botPlan = null;
    this.pendingBotRequestId = null;
    this.isBotThinking = false;
    this.botActionQueue = [];
    this.botActionTimer = 0;
    this.botMode = null;

    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.iaAssist = false;
    this.paused = true;
    this.gameOver = false;
    this.lastTime = 0;

    // SISTEMA DE CONTROL NES (Tiempos en milisegundos)
    this.DAS_DELAY = 267;
    this.ARR_DELAY = 100;
    this.ARE_DELAY = 0;
    this.BOT_ACTION_INTERVAL = 80
    // NUEVO: Velocidad fija de caída forzada (cuanto menor número, más rápido)
    this.SOFT_DROP_DELAY = 60;

    // Estado de teclas y temporizadores
    this.keys = { left: false, right: false, down: false };
    this.dasTimer = 0;
    this.areTimer = 0;
    this.fallAccumulator = 0;

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

  initActiveBlocks() {
    for (let i = 0; i < 4; i++) {
      const div = document.createElement('div');
      div.className = 'active-block';
      div.style.display = 'none';
      this.area.appendChild(div);
      this.activeBlocksDOM.push(div);
    }
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
    this.dasTimer = 0;
    this.fallAccumulator = 0;
    this.botPlan = null;
    this.botActionQueue = [];
    this.botActionTimer = 0;

    this.current.x = Math.floor(COLS / 2) - Math.floor(this.current.shapes[0][0].length / 2);
    this.current.y = 0;
    this.current.rotation = 0;
    this.current.matrix = this.current.shapes[0];

    if (this.collides(this.current.matrix, this.current.x, this.current.y)) {
      this.gameOver = true;
      this.paused = true;
      this.stopTimer();
    }

    if (this.gameOver) return;

    if (this.iaAssist) {
      this.releaseHorizontalKeys();
      this.keys.down = false;
    } else if (this.keys.left) {
      this.move(-1);
    } else if (this.keys.right) {
      this.move(1);
    }
    this.ghost = null;

    if (this.iaAssist) {
      this.requestBotMove();
    }
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
      this.pendingBotRequestId = null;
      this.isBotThinking = false;
      this.ghost = null;
      this.botPlan = null;
      this.botActionQueue = [];
      this.botMode = null;
      if (this.iaAssist) {
        this.requestBotMove();
      }
      this.fallAccumulator = 0;
      this.dasTimer = 0;
      this.keys = { left: false, right: false, down: false };
      this.updateIndicator();
    };

    document.addEventListener('keydown', (event) => this.handleKeyDown(event));
    document.addEventListener('keyup', (event) => this.handleKeyUp(event));
  }

  handleKeyDown(event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'p', 'P'].includes(event.key)) {
      event.preventDefault();
    }

    if (event.key.toUpperCase() === 'P') {
      this.togglePause();
      return;
    }

    if (this.paused || this.gameOver || this.iaAssist) return;
    const pieceReady = this.current && this.areTimer === 0;

    switch (event.key) {
      case 'ArrowLeft':
        if (!this.keys.left) {
          this.keys.left = true;
          this.keys.right = false;
          if (pieceReady) this.move(-1);
          this.dasTimer = 0;
        }
        break;
      case 'ArrowRight':
        if (!this.keys.right) {
          this.keys.right = true;
          this.keys.left = false;
          if (pieceReady) this.move(1);
          this.dasTimer = 0;
        }
        break;
      case 'ArrowDown':
        this.keys.down = true;
        break;
      case 'ArrowUp':
        if (pieceReady) this.rotate();
        break;
      case ' ':
        if (pieceReady) this.hardDrop();
        break;
      case 'c':
      case 'C':
        this.holdPiece();
        break;
    }
  }

  handleKeyUp(event) {
    switch (event.key) {
      case 'ArrowLeft':
        this.keys.left = false;
        this.dasTimer = 0;
        break;
      case 'ArrowRight':
        this.keys.right = false;
        this.dasTimer = 0;
        break;
      case 'ArrowDown':
        this.keys.down = false;
        break;
    }
  }

  updateIndicator() {
    if (!this.indicator) return;
    this.indicator.classList.remove('bot-thinking', 'bot-idle', 'balanced');
    this.indicator.classList.add('bot-strategy');

    if (this.iaAssist) {
      this.indicator.classList.add('balanced');
      this.indicator.classList.add(this.isBotThinking ? 'bot-thinking' : 'bot-idle');
      this.indicator.textContent = this.isBotThinking ? 'CALCULANDO...' : (this.botMode || 'LISTO');
    } else {
      this.indicator.classList.add('bot-idle');
      this.indicator.textContent = 'MANUAL';
    }
  }

  render() {
    // 1. Limpieza NO Destructiva (Fix Crítico)
    // En lugar de borrar todo (innerHTML = ''), buscamos y eliminamos
    // solo los bloques que NO son parte de la pieza activa persistente.
    // Esto mantiene vivos los nodos .active-block para actualizaciones inmediatas.
    const junkBlocks = this.area.querySelectorAll('div:not(.active-block)');
    junkBlocks.forEach(el => el.remove());

    // 2. Renderizar piezas fijas (Board)
    // Estas se dibujan de nuevo en cada frame (se podría optimizar, pero está bien así)
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.board[y][x] >= 0) {
          this.createBlock(this.board[y][x], x, y);
        }
      }
    }

    // 3. Renderizar Ghost (si IA activa)
    // El ghost no necesita animación, así que usamos el método estándar
    if (this.ghost && this.iaAssist) this.renderPieceGhost(this.ghost);

    // 4. Actualizar visuales de la pieza activa
    // Aquí es donde ocurre la magia: solo cambiamos las coordenadas (top/left)
    // y los bloques se tele-transportan sin interpolación para reflejar el NES.
    if (this.current) {
      this.updateActivePieceVisuals();
    } else {
      this.hideActiveBlocks();
    }
  }

  createBlock(typeId, x, y, extraClass = '') {
    const div = document.createElement('div');
    div.className = BLOCK_CLASSES[typeId] + ' ' + extraClass;
    div.style.left = `${x * UNIT}px`;
    div.style.top = `${y * UNIT}px`;
    this.area.appendChild(div);
  }

  renderPieceGhost(piece) {
    const extra = 'bot-ghost';
    piece.matrix.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (val) {
          this.createBlock(piece.typeId, piece.x + dx, piece.y + dy, extra);
        }
      });
    });
  }

  updateActivePieceVisuals() {
    let blockIndex = 0;
    const matrix = this.current.matrix;

    matrix.forEach((row, dy) => {
      row.forEach((val, dx) => {
        if (val && blockIndex < 4) {
          const block = this.activeBlocksDOM[blockIndex];
          block.className = `active-block ${BLOCK_CLASSES[this.current.typeId]} bot-controlled`;
          block.style.left = `${(this.current.x + dx) * UNIT}px`;
          block.style.top = `${(this.current.y + dy) * UNIT}px`;
          block.style.display = 'block';
          blockIndex++;
        }
      });
    });

    for (let i = blockIndex; i < this.activeBlocksDOM.length; i++) {
      this.activeBlocksDOM[i].style.display = 'none';
    }
  }

  hideActiveBlocks() {
    this.activeBlocksDOM.forEach(block => {
      block.style.display = 'none';
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

  requestBotMove() {
    if (!this.iaAssist || !this.current || this.isBotThinking || !this.botWorker) return;

    this.isBotThinking = true;
    this.botRequestId += 1;
    this.pendingBotRequestId = this.botRequestId;
    this.updateIndicator();

    try {
      const bagSequence = [this.current.typeId];
      if (this.next && this.next.typeId !== undefined && this.next.typeId !== null) {
        bagSequence.push(this.next.typeId);
      }
      if (Array.isArray(this.bag) && this.bag.length > 0) {
        bagSequence.push(...[...this.bag].reverse());
      }

      this.botWorker.postMessage({
        type: 'THINK',
        board: this.board.map(row => [...row]),
        currentTypeId: this.current.typeId,
        nextTypeId: this.next ? this.next.typeId : null,
        bagTypeIds: bagSequence,
        requestId: this.pendingBotRequestId
      });
    } catch (err) {
      console.warn('[AGENT][requestBotMove] Fast-Fail: no se pudo enviar trabajo al worker.', err);
      this.isBotThinking = false;
      this.pendingBotRequestId = null;
      this.updateIndicator();
    }
  }

  handleWorkerMessage(e) {
    const { type, ghost, requestId, mode } = e.data || {};
    if (type !== 'DECISION') return;
    if (this.pendingBotRequestId !== null && requestId !== this.pendingBotRequestId) return;

    this.pendingBotRequestId = null;
    this.isBotThinking = false;
    this.botMode = mode || this.botMode;

    if (this.iaAssist) {
      this.ghost = ghost;
      if (!this.botActionQueue.length) {
        this.prepareBotPlanFromGhost();
      }
    } else {
      this.ghost = null;
      this.botPlan = null;
      this.botActionQueue = [];
    }

    this.updateIndicator();
    this.render();
  }

  botThink() {
    if (!this.current) return;
    this.ghost = null;

    const pre = GeometricEvaluator.countAgujerosCanonicos(this.board);
    const huecos = GeometricEvaluator.findHuecos(this.board);
    // Altura máxima actual del tablero (perfil global)
    let maxHeight = 0;
    for (let cx = 0; cx < COLS; cx++) {
      for (let cy = 0; cy < ROWS; cy++) {
        if (this.board[cy][cx] !== -1) {
          maxHeight = Math.max(maxHeight, ROWS - cy);
          break;
        }
      }
    }
    let lowestHueco = null;
    for (const h of huecos) {
      const yEnd = h.top + h.h - 1;
      if (!lowestHueco ||
          yEnd > (lowestHueco.top + lowestHueco.h - 1) ||
          (yEnd === (lowestHueco.top + lowestHueco.h - 1) && h.left < lowestHueco.left)) {
        lowestHueco = h;
      }
    }
    const huecoMask = GeometricEvaluator.buildHuecoMask(huecos);

    const better = (a, b) => {
      // 0. Validación de Integridad (Fail-Fast)
      if (!a) return false;
      if (!b) return true;

      // 1. SUPERVIVENCIA & LIMPIEZA (Prioridad Absoluta)
      // Si limpiamos líneas, es objetivamente mejor porque reduce entropía.
      if (a.lines !== b.lines) return a.lines > b.lines;

      // 2. INTEGRIDAD ESTRUCTURAL (Seguridad)
      // Rechazo total a movimientos que creen nuevos agujeros (deudas).
      // Esta regla ahora domina sobre la profundidad.
      if (a.deltaHoles !== b.deltaHoles) return a.deltaHoles < b.deltaHoles;

      // 3. ESTABILIDAD DEL ENCASTRE (Fricción)
      // Buscamos el movimiento que toque más superficies (mayor CL).
      if (a.cl !== b.cl) return a.cl > b.cl;

      // 4. ESTRATEGIA DE PROFUNDIDAD (Desempate)
      // Solo si la seguridad estructural es idéntica, miramos la profundidad.
      
      // 4a. Afinidad al Objetivo (Si existe un hueco profundo detectado)
      if (lowestHueco && a.lines === 0 && b.lines === 0) {
        // Aquí SÍ priorizamos bajar, pero solo porque ya pasamos el filtro de seguridad #2
        if (a.y !== b.y) return a.y > b.y; 
      }

      // 4b. Relleno y Gravedad General
      if (a.huecoFill !== b.huecoFill) return a.huecoFill > b.huecoFill;
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
        const simulation = this.getSimulatedBoardWithLines(shapeMatrix, x, y);
        if (!simulation) {
          console.warn('[AGENT][botThink] Fast-Fail: simulación inválida, candidato descartado.');
          continue;
        }
        const {board: simulatedBoard, linesCleared} = simulation;
        // Filtro de crecimiento relativo (NO suicida)
        if (linesCleared === 0) {
          const placementHeight = ROWS - y;
          if (placementHeight > maxHeight + 4) continue;
        }

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

  prepareBotPlanFromGhost() {
    this.botPlan = null;
    this.botActionQueue = [];
    this.botActionTimer = 0;

    if (!this.iaAssist || !this.current || !this.ghost) {
      return;
    }

    if (this.current.typeId !== this.ghost.typeId) {
      console.warn('[AGENT][botPlan] Fast-Fail: el ghost no coincide con la pieza activa.');
      return;
    }

    const rotationsNeeded = (this.ghost.rotation - this.current.rotation + this.current.shapes.length) % this.current.shapes.length;

    const actions = [];
    for (let i = 0; i < rotationsNeeded; i++) {
      actions.push('ROTATE');
    }

    const deltaX = this.ghost.x - this.current.x;
    if (deltaX !== 0) {
      const horizontalAction = deltaX > 0 ? 'MOVE_RIGHT' : 'MOVE_LEFT';
      for (let i = 0; i < Math.abs(deltaX); i++) {
        actions.push(horizontalAction);
      }
    }

    actions.push('SOFT_DROP');

    this.botPlan = {
      pieceId: this.current.typeId
    };

    this.botActionQueue = actions;
    this.releaseHorizontalKeys();
  }

  releaseHorizontalKeys() {
    this.keys.left = false;
    this.keys.right = false;
    this.dasTimer = 0;
  }

  applyBotHorizontalHold(dir) {
    const pieceReady = this.current && this.areTimer === 0;
    if (dir < 0) {
      if (!this.keys.left) {
        this.keys.left = true;
        this.keys.right = false;
        if (pieceReady) this.move(-1);
        this.dasTimer = 0;
      }
    } else if (dir > 0) {
      if (!this.keys.right) {
        this.keys.right = true;
        this.keys.left = false;
        if (pieceReady) this.move(1);
        this.dasTimer = 0;
      }
    }
  }

  applyBotControl(deltaTime = 0) {
    // 1. Validaciones básicas de seguridad
    if (!this.iaAssist || !this.current || this.areTimer > 0) return;

    if (!this.ghost) {
      this.botPlan = null;
      this.botActionQueue = [];
      return;
    }

    if (this.botPlan && this.botPlan.pieceId !== this.current.typeId) {
      console.warn('[AGENT][botPlan] Fast-Fail: la pieza activa cambió antes de terminar la animación.');
      this.botPlan = null;
      this.botActionQueue = [];
      this.releaseHorizontalKeys();
      return;
    }

    if (this.botActionQueue.length === 0) {
      this.prepareBotPlanFromGhost();
    }

    if (this.botActionQueue.length === 0) return;

    this.botActionTimer += deltaTime;
    if (this.botActionTimer < this.BOT_ACTION_INTERVAL) return;
    this.botActionTimer = 0;

    const action = this.botActionQueue.shift();
    const success = this.executeBotAction(action);

    if (!success) {
      console.warn('[AGENT][botPlan] Fast-Fail: acción bloqueada, abortando secuencia.');
      this.botPlan = null;
      this.botActionQueue = [];
      this.releaseHorizontalKeys();
    }
  }

  executeBotAction(action) {
    if (!this.current || this.areTimer > 0) return false;

    switch (action) {
      case 'ROTATE': {
        if (typeof this.mayRotate === 'function' && !this.mayRotate()) return false;
        return this.attemptBotRotateWithWallKick();
      }
      case 'MOVE_LEFT':
      case 'MOVE_RIGHT': {
        const dir = action === 'MOVE_LEFT' ? -1 : 1;
        const prevX = this.current.x;
        this.move(dir);
        return this.current && this.current.x !== prevX;
      }
      case 'DROP':
      case 'SOFT_DROP': {
        return this.performBotSoftDrop();
      }
      default:
        return false;
    }
  }

  performBotSoftDrop() {
    const result = this.botSoftDropStep();
    if (result === 'MOVED') {
      this.botActionQueue.unshift('SOFT_DROP');
      return true;
    }
    return result === 'LOCKED';
  }

  botSoftDropStep() {
    if (!this.current || this.areTimer > 0) return 'BLOCKED';
    if (!this.collides(this.current.matrix, this.current.x, this.current.y + 1)) {
      this.current.y++;
      this.render();
      return 'MOVED';
    }
    this.lockPiece();
    return 'LOCKED';
  }

  handleHorizontalInput(deltaTime) {
    if (!this.current || this.areTimer > 0) return;

    if (this.keys.left || this.keys.right) {
      this.dasTimer += deltaTime;
      if (this.dasTimer >= this.DAS_DELAY) {
        while (this.dasTimer >= this.DAS_DELAY + this.ARR_DELAY) {
          this.move(this.keys.left ? -1 : 1);
          this.dasTimer -= this.ARR_DELAY;
          if (!this.current || this.areTimer > 0) break;
        }
      }
    } else {
      this.dasTimer = 0;
    }
  }

  handleGravity(deltaTime) {
    if (!this.current || this.areTimer > 0) return;

    const botIsSoftDropping =
      this.iaAssist &&
      this.botActionQueue &&
      this.botActionQueue.length > 0 &&
      this.botActionQueue[0] === 'SOFT_DROP';

    if (botIsSoftDropping) return;

    const gravitySpeed = Math.max(50, 1000 - (this.level * 50));
    
    // --- CAMBIO AQUÍ ---
    // Si se presiona abajo, usamos SOFT_DROP_DELAY.
    // Usamos Math.min para asegurar que el Soft Drop nunca sea 
    // más lento que la gravedad natural (en niveles muy altos).
    const currentSpeed = this.keys.down 
        ? Math.min(this.SOFT_DROP_DELAY, gravitySpeed) 
        : gravitySpeed;
    // -------------------

    this.fallAccumulator += deltaTime;
    while (this.fallAccumulator >= currentSpeed) {
      this.applyGravity();
      this.fallAccumulator -= currentSpeed;
      if (!this.current || this.areTimer > 0) break;
    }
  }

  move(dir) {
    if (!this.current || this.areTimer > 0) return;
    if (!this.collides(this.current.matrix, this.current.x + dir, this.current.y)) {
      this.current.x += dir;
      this.render(); 
    }
  }

  rotate() {
    if (!this.current || this.areTimer > 0) return;
    // Calcular siguiente índice de rotación
    const nextRotation = (this.current.rotation + 1) % this.current.shapes.length;
    const nextMatrix = this.current.shapes[nextRotation];

    // Verificar si la rotación es válida (colisión básica)
    // Nota: Aquí se podrían agregar "Wall Kicks" (intentar mover x-1, x+1) si falla
    if (!this.collides(nextMatrix, this.current.x, this.current.y)) {
      this.current.rotation = nextRotation;
      this.current.matrix = nextMatrix;
      this.render();
    }
  }

  attemptBotRotateWithWallKick() {
    if (!this.current || this.areTimer > 0) return false;

    const nextRotation = (this.current.rotation + 1) % this.current.shapes.length;
    const nextMatrix = this.current.shapes[nextRotation];
    const offsets = [0, 1, -1, 2, -2];

    for (const offset of offsets) {
      const candidateX = this.current.x + offset;
      if (!this.collides(nextMatrix, candidateX, this.current.y)) {
        this.current.x = candidateX;
        this.current.rotation = nextRotation;
        this.current.matrix = nextMatrix;
        this.render();
        return true;
      }
    }

    return false;
  }

  hardDrop() {
    if (!this.current || this.areTimer > 0) return;
    // Reutilizamos getDropY() que ya tenías para el Ghost
    const y = this.getDropY();
    this.score += (y - this.current.y) * 2; // Puntos extra
    this.current.y = y;
    this.lockPiece(); // Fijar inmediatamente
    this.render();
  }

  holdPiece() {
    console.warn('[AGENT] Hold de pieza no implementado.');
  }

  // Helper necesario para que el evaluador vea el futuro con líneas limpiadas
  getSimulatedBoardWithLines(matrix, px, py) {
    if (!matrix || !Array.isArray(matrix) || !Array.isArray(this.board)) {
      console.warn('[AGENT][botThink] Fast-Fail: datos inválidos para simular tablero.');
      return null;
    }

    const clone = this.board.map(row => [...row]);
    let invalidProjection = false;

    for (let dy = 0; dy < matrix.length; dy++) {
      for (let dx = 0; dx < matrix[dy].length; dx++) {
        if (!matrix[dy][dx]) continue;
        const ny = py + dy;
        const nx = px + dx;
        if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) {
          invalidProjection = true;
          break;
        }
        clone[ny][nx] = this.current.typeId;
      }
      if (invalidProjection) break;
    }

    if (invalidProjection) {
      console.warn('[AGENT][botThink] Fast-Fail: proyección fuera de los límites del tablero.');
      return null;
    }

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

  applyGravity() {
    if (!this.current || this.areTimer > 0) return;
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
        const ny = this.current.y + dy;
        const nx = this.current.x + dx;
        if (val && ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
          this.board[ny][nx] = this.current.typeId;
        }
      });
    });

    // 2. Limpieza de líneas (Reducción de entropía)
    this.board = this.board.filter(row => row.some(cell => cell === -1));
    const linesCleared = ROWS - this.board.length;
    this.score += linesCleared * 100; // Puntuación simple
    this.lines += linesCleared;

    document.getElementById('tetris-stats-lines').textContent = this.lines;
    document.getElementById('tetris-stats-score').textContent = this.score;
    while (this.board.length < ROWS) {
        this.board.unshift(Array(COLS).fill(-1));
    }
    this.ghost = null;
    this.botPlan = null;
    this.botActionQueue = [];
    this.botActionTimer = 0;
    this.renderNext();

    // 3. Generar nueva oportunidad
    this.current = null;
    this.areTimer = this.ARE_DELAY;
    this.fallAccumulator = 0;
    this.render();
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
    this.score = 0;
    this.lines = 0;
    this.lastTime = 0;
    this.areTimer = 0;
    this.dasTimer = 0;
    this.fallAccumulator = 0;
    this.botPlan = null;
    this.keys = { left: false, right: false, down: false };
    this.elapsedMs = 0;
    this.isBotThinking = false;
    this.pendingBotRequestId = null;
    this.ghost = null;
    this.botActionTimer = 0;
    this.botMode = null;
    this.stopTimer();
    this.updateTimerDisplay();
    document.getElementById('tetris-stats-score').textContent = this.score;
    document.getElementById('tetris-stats-lines').textContent = this.lines;
    this.render();
    this.renderNext();
    this.updateIndicator();
  }

  loop(time = 0) {
    const deltaTime = this.lastTime ? time - this.lastTime : 0;
    this.lastTime = time;

    if (!this.paused && !this.gameOver) {
      if (this.areTimer > 0) {
        this.areTimer = Math.max(0, this.areTimer - deltaTime);
      } else {
        if (!this.current) {
          this.spawnNewPiece();
        }

        if (this.current) {
          if (this.iaAssist) {
            this.applyBotControl(deltaTime);
          }
          this.handleHorizontalInput(deltaTime);
          this.handleGravity(deltaTime);
        }
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

window.addEventListener('load', () => {
  syncBoardScale();
  const game = new TetrisGame();
  window.addEventListener('resize', () => syncBoardScale(game));
});
