// tetris.js - Motor Tetris con Modelo GeomÃ©trico Matricial v4.1 Integrado

const COLS = 12;
const ROWS = 22;

const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const BLOCK_CLASSES = ['block0', 'block1', 'block2', 'block3', 'block4', 'block5', 'block6'];

function syncBoardScale(gameInstance, scaleFactor = 1) {
  if (!(gameInstance instanceof TetrisGame)) {
    console.error('[AGENT][syncBoardScale] Fast-Fail: instancia de juego invalida.');
    return;
  }
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    console.error('[AGENT][syncBoardScale] Fast-Fail: factor de escala invalido.');
    return;
  }

  const wrapper = gameInstance.$('.game-board-wrapper');
  const board = gameInstance.$('.game-board');
  const gameSection = gameInstance.root.matches('.game-section')
    ? gameInstance.root
    : gameInstance.$('.game-section');

  if (!wrapper || !board) return;

  // Forzar que el wrapper use TODO el espacio disponible.
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.padding = '4px'; // MÃ­nimo para el borde win98.

  // Asegurar que la secciÃ³n tambiÃ©n tenga una altura Ãºtil antes de medir.
  if (gameSection) {
    gameSection.style.height = '100%';
    gameSection.style.minHeight = '0';
  }

  // Obtener dimensiones reales del wrapper despuÃ©s de layout.
  const wrapperRect = wrapper.getBoundingClientRect();
  const availableWidth = wrapperRect.width - 20; // Margen para padding y sombra Win98.
  const availableHeight = wrapperRect.height - 20;

  if (availableWidth <= 0 || availableHeight <= 0) return;

  // Calcular unit para llenar al mÃ¡ximo manteniendo proporciÃ³n.
  const unitByWidth = Math.floor(availableWidth / COLS);
  const unitByHeight = Math.floor(availableHeight / ROWS);

  let dynamicUnit = Math.floor(Math.min(unitByWidth, unitByHeight) * scaleFactor);
  dynamicUnit = Math.max(scaleFactor < 1 ? 8 : 12, dynamicUnit);

  gameInstance.UNIT = dynamicUnit;
  gameInstance.root.style.setProperty('--unit', `${dynamicUnit}px`);

  // Forzar tamaÃ±o exacto del tablero.
  board.style.width = `${COLS * dynamicUnit}px`;
  board.style.height = `${ROWS * dynamicUnit}px`;
  board.style.maxWidth = 'none';
  board.style.maxHeight = 'none';

  // Asegurar que la grilla de fondo tambiÃ©n coincida.
  const gameGrid = gameInstance.$('.game-grid');
  if (gameGrid) {
    gameGrid.style.width = `${COLS * dynamicUnit}px`;
    gameGrid.style.height = `${ROWS * dynamicUnit}px`;
  }

  gameInstance.render();
  gameInstance.renderNext();
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
    // 1) Volumen interno (incluye techo) completamente vacÃ­o
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
    // [FIX] Fast-Fail GeomÃ©trico: Solo es hueco si hay contenciÃ³n BILATERAL.
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
  constructor(root, options = {}) {
    if (!root) throw new Error('[AGENT] TetrisGame requiere un root element.');
    this.root = root;
    this.uiRoot = options.uiRoot ?? null;
    this.controlsRoot = options.controlsRoot ?? null;
    this.isCPU = options.isCPU ?? false;
    this.playerName = options.playerName ?? 'P1';
    this.onAttack = options.onAttack ?? null;
    this.onDefeat = options.onDefeat ?? null;
    this.UNIT = 20;
    this.garbageQueue = 0;
    this.root.style.setProperty('--area-x', COLS);
    this.root.style.setProperty('--area-y', ROWS);
    this.root.style.setProperty('--unit', `${this.UNIT}px`);

    this.els = {
      area: this.$('.tetris-area'),
      nextBox: this.$('.tetris-nextpuzzle'),
      indicator: this.$('.bot-strategy-indicator'),
      timer: this.$('.tetris-stats-time'),
      score: this.$('.tetris-stats-score'),
      lines: this.$('.tetris-stats-lines'),
      status: this.$('.mode-status'),
      wallLogs: this.$('.wall-logs'),
      playBtn: this.$('.playBtn'),
      newGameBtn: this.$('.newGameBtn'),
      iaAssistToggle: this.$('.iaAssistToggle'),
      gameMessage: this.$('.gameMessage'),
      gameOver: this.$('.tetris-gameover')
    };
    if (!this.els.area || !this.els.nextBox) {
      throw new Error(`[AGENT][${this.playerName}] DOM de tablero incompleto.`);
    }
    this.board = Array.from({length: ROWS}, () => Array(COLS).fill(-1));
    this.area = this.els.area;
    this.nextBox = this.els.nextBox;
    this.indicator = this.els.indicator;
    this.timerDisplay = this.els.timer;
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
    this.isAnimating = false;
    this.isGameOverAnimating = false;
    this.rowsToClear = null;
    this.lastTime = 0;

    // SISTEMA DE CONTROL NES (Tiempos en milisegundos)
    this.DAS_DELAY = 267;
    this.ARR_DELAY = 100;
    this.ARE_DELAY = 0;
    this.BOT_ACTION_INTERVAL = 80
    // NUEVO: Velocidad fija de caÃ­da forzada (cuanto menor nÃºmero, mÃ¡s rÃ¡pido)
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
    this.lastWallsIntactState = null;
    this.lastWellColumn = null;
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

  $(sel) {
    return this.root.querySelector(sel)
      || this.uiRoot?.querySelector(sel)
      || this.controlsRoot?.querySelector(sel)
      || null;
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
    if (this.isAnimating || this.isGameOverAnimating) return;
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
      this.triggerGameOver();
    }

    if (this.gameOver || this.isGameOverAnimating) return;

    if (this.iaAssist) {
      this.releaseHorizontalKeys();
      this.keys.down = false;
    } else if (this.keys.left) {
      this.move(-1);
    } else if (this.keys.right) {
      this.move(1);
    }
    this.ghost = null;

    if (this.iaAssist && !this.isGameOverAnimating) {
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
    if (this.isCPU) return;
    if (!this.els.playBtn || !this.els.newGameBtn || !this.els.iaAssistToggle) {
      console.error(`[AGENT][${this.playerName}] Fast-Fail: controles incompletos.`);
      return;
    }
    this.els.playBtn.onclick = () => this.togglePause();
    this.els.newGameBtn.onclick = () => this.reset();
    this.els.iaAssistToggle.onclick = () => {
      this.iaAssist = !this.iaAssist;
      this.els.iaAssistToggle.classList.toggle('active', this.iaAssist);
      
      // --- CORRECCIÃ“N DE LIMPIEZA ---
      this.pendingBotRequestId = null;
      this.isBotThinking = false;
      this.ghost = null;
      this.botPlan = null;
      this.botActionQueue = []; // Limpiar cola para evitar bloqueos
      this.botMode = null;
      // -----------------------------

      if (this.iaAssist) {
        // Solo pedimos movimiento si el juego NO estÃ¡ en Game Over y tenemos pieza
        if (!this.gameOver && this.current && !this.isAnimating && !this.isGameOverAnimating) {
          this.requestBotMove();
        }
      }
      
      // ... resto del cÃ³digo (fallAccumulator, timer reset, visuales) ...
      this.fallAccumulator = 0;
      this.dasTimer = 0;
      this.keys = { left: false, right: false, down: false };
      const statusEl = this.els.status;
      if (statusEl) {
        statusEl.textContent = this.iaAssist ? 'MODO: INICIANDO...' : 'MODO: MANUAL';
      }
      this.updateIndicator();
    };

  }

  handleKeyDown(event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) {
      event.preventDefault();
    }

    if (this.paused || this.gameOver || this.isAnimating || this.isGameOverAnimating) return;
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
        thëN8¶‰žËkºwµç}A}1d¸4(€€€€¼¼UÍ…µ½Ì5…Ñ ¹µ¥¸Á…É„…Í•ÕÉ…ÈÅÕ”•°M½™ÐÉ½À¹Õ¹„Í•„€4(€€€€¼¼·…Ì±•¹Ñ¼ÅÕ”±„É…Ù•‘…¹…ÑÕÉ…°€¡•¸¹¥Ù•±•ÌµÕä…±Ñ½Ì¤¸4(€€€½¹ÍÐÕÉÉ•¹ÑMÁ••€ôÑ¡¥Ì¹­•åÌ¹‘½Ý¸€4(€€€€€€€€ü5…Ñ ¹µ¥¸¡Ñ¡¥Ì¹M=Q}I=A}1d°É…Ù¥ÑåMÁ••¤€4(€€€€€€€€èÉ…Ù¥ÑåMÁ••ì4(€€€€¼¼€´´´´´´´´´´´´´´´´´´´4(4(€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€¬ô‘•±Ñ…Q¥µ”ì4(€€€Ý¡¥±”€¡Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€øôÕÉÉ•¹ÑMÁ••¤ì4(€€€€€Ñ¡¥Ì¹…ÁÁ±åÉ…Ù¥Ñä ¤ì4(€€€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€´ôÕÉÉ•¹ÑMÁ••ì4(€€€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ÐñðÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤‰É•…¬ì4(€€€ô4(€ô4(4(€µ½Ù”¡‘¥È¤ì4(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ÐñðÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì4(€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹à€¬‘¥È°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä¤¤ì4(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹à€¬ô‘¥Èì4(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì€4(€€€ô4(€ô4(4(€É½Ñ…Ñ” ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ÐñðÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì4(€€€€¼¼…±Õ±…ÈÍ¥Õ¥•¹Ñ”ƒµ¹‘¥”‘”É½Ñ…§Í¸4(€€€½¹ÍÐ¹•áÑI½Ñ…Ñ¥½¸€ô€¡Ñ¡¥Ì¹ÕÉÉ•¹Ð¹É½Ñ…Ñ¥½¸€¬€Ä¤€”Ñ¡¥Ì¹ÕÉÉ•¹Ð¹Í¡…Á•Ì¹±•¹Ñ ì4(€€€½¹ÍÐ¹•áÑ5…ÑÉ¥à€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹Í¡…Á•Ím¹•áÑI½Ñ…Ñ¥½¹tì4(4(€€€€¼¼Y•É¥™¥…ÈÍ¤±„É½Ñ…§Í¸•ÌÛ…±¥‘„€¡½±¥Í§Í¸‹…Í¥„¤4(€€€€¼¼9½Ñ„èÅ×´Í”Á½‘Ëµ…¸…É•…È€‰]…±°-¥­Ìˆ€¡¥¹Ñ•¹Ñ…Èµ½Ù•Èà´Ä°à¬Ä¤Í¤™…±±„4(€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡¹•áÑ5…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹à°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä¤¤ì4(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹É½Ñ…Ñ¥½¸€ô¹•áÑI½Ñ…Ñ¥½¸ì4(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à€ô¹•áÑ5…ÑÉ¥àì4(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(€€€ô4(€ô4(4(€…ÑÑ•µÁÑ	½ÑI½Ñ…Ñ•]¥Ñ¡]…±±-¥¬ ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ÐñðÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸™…±Í”ì4(4(€€€½¹ÍÐ¹•áÑI½Ñ…Ñ¥½¸€ô€¡Ñ¡¥Ì¹ÕÉÉ•¹Ð¹É½Ñ…Ñ¥½¸€¬€Ä¤€”Ñ¡¥Ì¹ÕÉÉ•¹Ð¹Í¡…Á•Ì¹±•¹Ñ ì4(€€€½¹ÍÐ¹•áÑ5…ÑÉ¥à€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹Í¡…Á•Ím¹•áÑI½Ñ…Ñ¥½¹tì4(€€€½¹ÍÐ½™™Í•ÑÌ€ôlÀ°€Ä°€´Ä°€È°€´Étì4(4(€€€™½È€¡½¹ÍÐ½™™Í•Ð½˜½™™Í•ÑÌ¤ì4(€€€€€½¹ÍÐ…¹‘¥‘…Ñ•`€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹à€¬½™™Í•Ðì4(€€€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡¹•áÑ5…ÑÉ¥à°…¹‘¥‘…Ñ•`°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä¤¤ì4(€€€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹à€ô…¹‘¥‘…Ñ•`ì4(€€€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹É½Ñ…Ñ¥½¸€ô¹•áÑI½Ñ…Ñ¥½¸ì4(€€€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à€ô¹•áÑ5…ÑÉ¥àì4(€€€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€€€ô4(€€€ô4(4(€€€É•ÑÕÉ¸™…±Í”ì4(€ô4(4(€¡…É‘É½À ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ÐñðÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì4(€€€€¼¼I•ÕÑ¥±¥é…µ½Ì•ÑÉ½Ád ¤ÅÕ”å„Ñ•»µ…ÌÁ…É„•°¡½ÍÐ4(€€€½¹ÍÐä€ôÑ¡¥Ì¹•ÑÉ½Ád ¤ì4(€€€Ñ¡¥Ì¹Í½É”€¬ô€¡ä€´Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä¤€¨€Èì€¼¼AÕ¹Ñ½Ì•áÑÉ„4(€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä€ôäì4(€€€Ñ¡¥Ì¹±½­A¥•” ¤ì€¼¼¥©…È¥¹µ•‘¥…Ñ…µ•¹Ñ”4(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(€ô4(4(€¡½±‘A¥•” ¤ì4(€€€½¹Í½±”¹Ý…É¸ m9Qt!½±‘”Á¥•é„¹¼¥µÁ±•µ•¹Ñ…‘¼¸œ¤ì4(€ô4(4(€€¼¼!•±Á•È¹••Í…É¥¼Á…É„ÅÕ”•°•Ù…±Õ…‘½ÈÙ•„•°™ÕÑÕÉ¼½¸³µ¹•…Ì±¥µÁ¥…‘…Ì4(€•ÑM¥µÕ±…Ñ•‘	½…É‘]¥Ñ¡1¥¹•Ì¡µ…ÑÉ¥à°Áà°Áä¤ì4(€€€¥˜€ …µ…ÑÉ¥àñð€…ÉÉ…ä¹¥ÍÉÉ…ä¡µ…ÑÉ¥à¤ñð€…ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ¡¥Ì¹‰½…É¤¤ì4(€€€€€½¹Í½±”¹Ý…É¸ m9Qum‰½ÑQ¡¥¹­t…ÍÐµ…¥°è‘…Ñ½Ì¥¹Û…±¥‘½ÌÁ…É„Í¥µÕ±…ÈÑ…‰±•É¼¸œ¤ì4(€€€€€É•ÑÕÉ¸¹Õ±°ì4(€€€ô4(4(€€€½¹ÍÐ±½¹”€ôÑ¡¥Ì¹‰½…É¹µ…À¡É½Ü€ôøl¸¸¹É½Ýt¤ì4(€€€±•Ð¥¹Ù…±¥‘AÉ½©•Ñ¥½¸€ô™…±Í”ì4(4(€€€™½È€¡±•Ð‘ä€ô€Àì‘ä€ðµ…ÑÉ¥à¹±•¹Ñ ì‘ä¬¬¤ì4(€€€€€™½È€¡±•Ð‘à€ô€Àì‘à€ðµ…ÑÉ¥ám‘åt¹±•¹Ñ ì‘à¬¬¤ì4(€€€€€€€¥˜€ …µ…ÑÉ¥ám‘åum‘át¤½¹Ñ¥¹Õ”ì4(€€€€€€€½¹ÍÐ¹ä€ôÁä€¬‘äì4(€€€€€€€½¹ÍÐ¹à€ôÁà€¬‘àì4(€€€€€€€¥˜€¡¹ä€ð€Àñð¹ä€øôI=]Lñð¹à€ð€Àñð¹à€øô=1L¤ì4(€€€€€€€€€¥¹Ù…±¥‘AÉ½©•Ñ¥½¸€ôÑÉÕ”ì4(€€€€€€€€€‰É•…¬ì4(€€€€€€€ô4(€€€€€€€±½¹•m¹åum¹át€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹ÑåÁ•%ì4(€€€€€ô4(€€€€€¥˜€¡¥¹Ù…±¥‘AÉ½©•Ñ¥½¸¤‰É•…¬ì4(€€€ô4(4(€€€¥˜€¡¥¹Ù…±¥‘AÉ½©•Ñ¥½¸¤ì4(€€€€€½¹Í½±”¹Ý…É¸ m9Qum‰½ÑQ¡¥¹­t…ÍÐµ…¥°èÁÉ½å•§Í¸™Õ•É„‘”±½Ì³µµ¥Ñ•Ì‘•°Ñ…‰±•É¼¸œ¤ì4(€€€€€É•ÑÕÉ¸¹Õ±°ì4(€€€ô4(4(€€€±•Ð™¥±Ñ•É•€ô±½¹”¹™¥±Ñ•È¡É½Ü€ôøÉ½Ü¹Í½µ”¡•±°€ôø•±°€ôôô€´Ä¤¤ì4(€€€½¹ÍÐ±¥¹•Í±•…É•€ôI=]L€´™¥±Ñ•É•¹±•¹Ñ ì4(€€€Ý¡¥±”€¡™¥±Ñ•É•¹±•¹Ñ €ðI=]L¤ì4(€€€€€™¥±Ñ•É•¹Õ¹Í¡¥™Ð¡ÉÉ…ä¡=1L¤¹™¥±° ´Ä¤¤ì4(€€€ô4(4(€€€É•ÑÕÉ¸í‰½…Éè™¥±Ñ•É•°±¥¹•Í±•…É•‘ôì4(€ô4(4(€•ÑÉ½Ád ¤ì4(€€€±•Ðä€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹äì4(€€€Ý¡¥±”€ …Ñ¡¥Ì¹½±±¥‘•Ì¡Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹à°ä€¬€Ä¤¤ì4(€€€€€ä¬¬ì4(€€€ô4(€€€É•ÑÕÉ¸äì4(€ô4(4(€…ÁÁ±åÉ…Ù¥Ñä ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ÐñðÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì4(€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹à°Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä€¬€Ä¤¤ì4(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹ä¬¬ì4(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(€€€ô•±Í”ì4(€€€€€Ñ¡¥Ì¹±½­A¥•” ¤ì4(€€€ô4(€ô4(4(€±½­A¥•” ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œñðÑ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì4(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹Ðñð€…Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à¤ì4(€€€€€½¹Í½±”¹•ÉÉ½È m9QtA¥•é„¹¼‘¥ÍÁ½¹¥‰±”Á…É„‰±½ÅÕ•…È¸œ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ¡¥Ì¹‰½…É¤¤ì4(€€€€€½¹Í½±”¹•ÉÉ½È m9QtQ…‰±•É¼¥¹Û…±¥‘¼°…‰½ÉÑ…¹‘¼‰±½ÅÕ•¼¸œ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€½¹ÍÐÁ±…•µ•¹ÑÌ€ômtì4(€€€±•Ð¥¹Ù…±¥‘A±…•µ•¹Ð€ô™…±Í”ì4(4(€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð¹µ…ÑÉ¥à¹™½É…  ¡É½Ü°‘ä¤€ôøì4(€€€€€É½Ü¹™½É…  ¡Ù…°°‘à¤€ôøì4(€€€€€€€¥˜€ …Ù…°¤É•ÑÕÉ¸ì4(€€€€€€€½¹ÍÐ¹ä€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹ä€¬‘äì4(€€€€€€€½¹ÍÐ¹à€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹à€¬‘àì4(€€€€€€€¥˜€¡¹ä€ð€Àñð¹ä€øôI=]Lñð¹à€ð€Àñð¹à€øô=1L¤ì4(€€€€€€€€€¥¹Ù…±¥‘A±…•µ•¹Ð€ôÑÉÕ”ì4(€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€ô4(€€€€€€€¥˜€¡Ñ¡¥Ì¹‰½…É‘m¹åum¹át€„ôô€´Ä¤ì4(€€€€€€€€€¥¹Ù…±¥‘A±…•µ•¹Ð€ôÑÉÕ”ì4(€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€ô4(€€€€€€€Á±…•µ•¹ÑÌ¹ÁÕÍ ¡ìàè¹à°äè¹äô¤ì4(€€€€€ô¤ì4(€€€ô¤ì4(4(€€€¥˜€¡¥¹Ù…±¥‘A±…•µ•¹Ð¤ì4(€€€€€½¹Í½±”¹•ÉÉ½È m9Qt½±¥Í§Í¸Í¥µÕ±…‘„¼™Õ•É„‘”³µµ¥Ñ•Ì…°‰±½ÅÕ•…ÈÁ¥•é„¸œ¤ì4(€€€€€Ñ¡¥Ì¹ÑÉ¥•É…µ•=Ù•È ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€Á±…•µ•¹ÑÌ¹™½É…  ¡ìà°äô¤€ôøì4(€€€€€Ñ¡¥Ì¹‰½…É‘måumát€ôÑ¡¥Ì¹ÕÉÉ•¹Ð¹ÑåÁ•%ì4(€€€ô¤ì4(4(€€€½¹ÍÐÉ½ÝÍQ½±•…È€ômtì4(€€€™½È€¡±•ÐÈ€ô€ÀìÈ€ðI=]LìÈ¬¬¤ì4(€€€€€¥˜€¡Ñ¡¥Ì¹‰½…É‘mÉt¹•Ù•Éä¡•±°€ôø•±°€„ôô€´Ä¤¤ì4(€€€€€€€É½ÝÍQ½±•…È¹ÁÕÍ ¡È¤ì4(€€€€€ô4(€€€ô4(4(€€€¥˜€¡É½ÝÍQ½±•…È¹±•¹Ñ €ø€À¤ì4(€€€€€Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€ôÑÉÕ”ì4(€€€€€Ñ¡¥Ì¹É½ÝÍQ½±•…È€ôÉ½ÝÍQ½±•…Èì4(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð€ô¹Õ±°ì4(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(4(€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì4(€€€€€€€Ñ¡¥Ì¹‰½…É€ôÑ¡¥Ì¹‰½…É¹™¥±Ñ•È¡É½Ü€ôøÉ½Ü¹Í½µ”¡•±°€ôø•±°€ôôô€´Ä¤¤ì4(€€€€€€€½¹ÍÐ±¥¹•Í±•…É•€ôÉ½ÝÍQ½±•…È¹±•¹Ñ ì4(€€€€€€€Ñ¡¥Ì¹Í½É”€¬ô±¥¹•Í±•…É•€¨€ÄÀÀì4(€€€€€€€Ñ¡¥Ì¹±¥¹•Ì€¬ô±¥¹•Í±•…É•ì4(4(€€€€€€€Ý¡¥±”€¡Ñ¡¥Ì¹‰½…É¹±•¹Ñ €ðI=]L¤ì4(€€€€€€€€€Ñ¡¥Ì¹‰½…É¹Õ¹Í¡¥™Ð¡ÉÉ…ä¡=1L¤¹™¥±° ´Ä¤¤ì4(€€€€€€€ô4(4(€€€€€€€Ñ¡¥Ì¹™¥¹¥Í¡QÕÉ¸¡±¥¹•Í±•…É•¤ì4(€€€€€ô°€ÐÀÀ¤ì4(€€€ô•±Í”ì4(€€€€€Ñ¡¥Ì¹™¥¹¥Í¡QÕÉ¸ À¤ì4(€€€ô4(€ô4(4(€™¥¹¥Í¡QÕÉ¸¡±¥¹•Í±•…É•¤ì4(€€€Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€ô™…±Í”ì4(€€€Ñ¡¥Ì¹É½ÝÍQ½±•…È€ô¹Õ±°ì4(4(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¤Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¹Ñ•áÑ½¹Ñ•¹Ð€ôÑ¡¥Ì¹±¥¹•Ìì4(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹Í½É”¤Ñ¡¥Ì¹•±Ì¹Í½É”¹Ñ•áÑ½¹Ñ•¹Ð€ôÑ¡¥Ì¹Í½É”ì4(4(€€€Ñ¡¥Ì¹¡½ÍÐ€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹‰½ÑA±…¸€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹EÕ•Õ”€ômtì4(€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹Q¥µ•È€ô€Àì4(€€€Ñ¡¥Ì¹É•¹‘•É9•áÐ ¤ì4(4(€€€Ñ¡¥Ì¹ÕÉÉ•¹Ð€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹…É•Q¥µ•È€ôÑ¡¥Ì¹I}1dì4(€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€ô€Àì4(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(€ô4(4(€€¼¼€´´´9UYMU9%5=YH€´´´4(€ÑÉ¥•É…µ•=Ù•È ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì4(€€€Ñ¡¥Ì¹…µ•=Ù•È€ôÑÉÕ”ì4(€€€Ñ¡¥Ì¹Á…ÕÍ•€ôÑÉÕ”ì4(€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ôÑÉÕ”ì4(€€€Ñ¡¥Ì¹ÍÑ½ÁQ¥µ•È ¤ì4(€€€Ñ¡¥Ì¹¡¥‘•Ñ¥Ù•	±½­Ì ¤ì4(€€€½¹ÍÐ‰Ñ¸€ôÑ¡¥Ì¹•±Ì¹Á±…å	Ñ¸ì4(€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ŸŠZØA±…äœì4(4(€€€Ñ¡¥Ì¹ÉÕ¹…µ•=Ù•É•ÍÑÉÕÑ¥½¸ ¤ì4(€ô4(4(€ÉÕ¹…µ•=Ù•É•ÍÑÉÕÑ¥½¸ ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì4(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ¡¥Ì¹‰½…É¤¤ì4(€€€€€½¹Í½±”¹•ÉÉ½È m9Qum…µ•=Ù•ÉtQ…‰±•É¼¥¹Û…±¥‘¼°…‰½ÉÑ…¹‘¼‘•ÍÑÉÕ§Í¸¸œ¤ì4(€€€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ô™…±Í”ì4(€€€€€Ñ¡¥Ì¹Í¡½Ý…µ•=Ù•ÉMÉ••¸ ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€½¹ÍÐ½ÕÁ¥•€ômtì4(€€€™½È€¡±•Ðä€ô€Àìä€ðI=]Lìä¬¬¤ì4(€€€€€™½È€¡±•Ðà€ô€Àìà€ð=1Lìà¬¬¤ì4(€€€€€€€¥˜€¡Ñ¡¥Ì¹‰½…É‘måumát€„ôô€´Ä€˜˜Ñ¡¥Ì¹‰½…É‘måumát€„ôô€´È¤ì4(€€€€€€€€€½ÕÁ¥•¹ÁÕÍ ¡ìà°äô¤ì4(€€€€€€€ô4(€€€€€ô4(€€€ô4(4(€€€¥˜€¡½ÕÁ¥•¹±•¹Ñ €ôôô€À¤ì4(€€€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ô™…±Í”ì4(€€€€€Ñ¡¥Ì¹Í¡½Ý…µ•=Ù•ÉMÉ••¸ ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€½¹ÍÐ¥‘à€ô5…Ñ ¹™±½½È¡5…Ñ ¹É…¹‘½´ ¤€¨½ÕÁ¥•¹±•¹Ñ ¤ì4(€€€½¹ÍÐÑ…É•Ð€ô½ÕÁ¥•‘m¥‘átì4(€€€Ñ¡¥Ì¹‰½…É‘mÑ…É•Ð¹åumÑ…É•Ð¹át€ô€´Èì4(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(4(€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì4(€€€€€¥˜€ …Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì4(€€€€€Ñ¡¥Ì¹‰½…É‘mÑ…É•Ð¹åumÑ…É•Ð¹át€ô€´Äì4(€€€€€Ñ¡¥Ì¹ÉÕ¹…µ•=Ù•É•ÍÑÉÕÑ¥½¸ ¤ì4(€€€ô°€ÈÀ¤ì4(€ô4(4(€Ñ½±•A…ÕÍ” ¤ì(€€€Ñ¡¥Ì¹Í•ÑA…ÕÍ• …Ñ¡¥Ì¹Á…ÕÍ•¤ì(€ô((€Í•ÑA…ÕÍ•¡Á…ÕÍ•¤ì(€€€¥˜€¡Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¹Á…ÕÍ•€ô	½½±•…¸¡Á…ÕÍ•¤ì(€€€½¹ÍÐ‰Ñ¸€ôÑ¡¥Ì¹•±Ì¹Á±…å	Ñ¸ì(4(€€€¥˜€¡Ñ¡¥Ì¹Á…ÕÍ•¤ì4(€€€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€‰±½¬œ¤ì4(€€€€€Ñ¡¥Ì¹Á…ÕÍ•Q¥µ•È ¤ì4(€€€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ŸŠZØA±…äœì€¼¼…µ‰¥¼Ù¥ÍÕ…°„A±…ä4(€€€ô•±Í”¥˜€ …Ñ¡¥Ì¹…µ•=Ù•È¤ì(€€€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€¹½¹”œ¤ì(€€€€€Ñ¡¥Ì¹É•ÍÕµ•Q¥µ•È ¤ì(€€€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ŸŠ>àA…ÕÍ”œì€¼¼…µ‰¥¼Ù¥ÍÕ…°„A…ÕÍ”(€€€ô4(€ô4(4(€Í¡½Ý…µ•=Ù•ÉMÉ••¸ ¤ì4(€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€‰±½¬œ¤ì4(€€€½¹ÍÐ•°€ôÑ¡¥Ì¹•±Ì¹…µ•=Ù•Èì4(€€€¥˜€ …•°¤É•ÑÕÉ¸ì4(4(€€€•°¹¥¹¹•É!Q50€ô€4(€€€€€€€€ñ Èù5=YHð½ Èø4(€€€€€€€€ñÀùM=I%90ð½Àø4(€€€€€€€€ñ‘¥Ø±…ÍÌô‰™¥¹…°µÍ½É”ˆø‘íÑ¡¥Ì¹Í½É•ôð½‘¥Øø4(€€€€€€€€ñÀù1¥¹•Ìè€‘íÑ¡¥Ì¹±¥¹•Íôð½Àø4(€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÌô‰‰Ñ¸µÁÉ¥µ…ÉäÉ•ÑÉå	Ñ¸ˆùQId%8ð½‰ÕÑÑ½¸ø4(€€€€ì4(€€€€4(€€€€¼¼Ñ¥Ù…È‰½ÓÍ¸‘”É•¥¹Ñ•¹Ñ¼4(€€€½¹ÍÐÉ•ÑÉå	Ñ¸€ô•°¹ÅÕ•ÉåM•±•Ñ½È œ¹É•ÑÉå	Ñ¸œ¤ì4(€€€É•ÑÉå	Ñ¸¹½¹±¥¬€ô€ ¤€ôøÑ¡¥Ì¹É•Í•Ð ¤ì4(4(€€€•°¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€™±•àœì4(€ô4(4(€É•Í•Ð ¤ì4(€€€½¹ÍÐ½MÉ••¸€ôÑ¡¥Ì¹•±Ì¹…µ•=Ù•Èì4(€€€¥˜€¡½MÉ••¸¤½MÉ••¸¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€¹½¹”œì4(€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€‰±½¬œ¤ì4(€€€Ñ¡¥Ì¹…µ•=Ù•È€ô™…±Í”ì4(€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ô™…±Í”ì4(€€€Ñ¡¥Ì¹‰½…É€ôÉÉ…ä¹™É½´¡í±•¹Ñ èI=]Mô°€ ¤€ôøÉÉ…ä¡=1L¤¹™¥±° ´Ä¤¤ì4(€€€Ñ¡¥Ì¹‰…œ€ômtì4(€€€Ñ¡¥Ì¹¥¹¥Ñ	…œ ¤ì4(€€€Ñ¡¥Ì¹¹•áÐ€ôÑ¡¥Ì¹•Ñ9•áÑA¥••QåÁ” ¤ì4(€€€Ñ¡¥Ì¹ÍÁ…Ý¹9•ÝA¥•” ¤ì4(€€€Ñ¡¥Ì¹Á…ÕÍ•€ôÑÉÕ”ì4(€€€Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€ô™…±Í”ì4(€€€Ñ¡¥Ì¹É½ÝÍQ½±•…È€ô¹Õ±°ì4(€€€½¹ÍÐ‰Ñ¸€ôÑ¡¥Ì¹•±Ì¹Á±…å	Ñ¸ì4(€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ŸŠZØA±…äœì4(€€€Ñ¡¥Ì¹Í½É”€ô€Àì4(€€€Ñ¡¥Ì¹±¥¹•Ì€ô€Àì4(€€€Ñ¡¥Ì¹±…ÍÑQ¥µ”€ô€Àì4(€€€Ñ¡¥Ì¹…É•Q¥µ•È€ô€Àì4(€€€Ñ¡¥Ì¹‘…ÍQ¥µ•È€ô€Àì4(€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€ô€Àì4(€€€Ñ¡¥Ì¹‰½ÑA±…¸€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹­•åÌ€ôì±•™Ðè™…±Í”°É¥¡Ðè™…±Í”°‘½Ý¸è™…±Í”ôì4(€€€Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€ô€Àì4(€€€Ñ¡¥Ì¹¥Í	½ÑQ¡¥¹­¥¹œ€ô™…±Í”ì4(€€€Ñ¡¥Ì¹Á•¹‘¥¹	½ÑI•ÅÕ•ÍÑ%€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹¡½ÍÐ€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹Q¥µ•È€ô€Àì4(€€€Ñ¡¥Ì¹‰½Ñ5½‘”€ô¹Õ±°ì4(€€€Ñ¡¥Ì¹ÍÑ½ÁQ¥µ•È ¤ì4(€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹Í½É”¤Ñ¡¥Ì¹•±Ì¹Í½É”¹Ñ•áÑ½¹Ñ•¹Ð€ôÑ¡¥Ì¹Í½É”ì4(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¤Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¹Ñ•áÑ½¹Ñ•¹Ð€ôÑ¡¥Ì¹±¥¹•Ìì4(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì4(€€€Ñ¡¥Ì¹É•¹‘•É9•áÐ ¤ì4(€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•%¹‘¥…Ñ½È ¤ì4(€ô4(4(€±½½À¡Ñ¥µ”€ô€À¤ì4(€€€½¹ÍÐ‘•±Ñ…Q¥µ”€ôÑ¡¥Ì¹±…ÍÑQ¥µ”€üÑ¥µ”€´Ñ¡¥Ì¹±…ÍÑQ¥µ”€è€Àì4(€€€Ñ¡¥Ì¹±…ÍÑQ¥µ”€ôÑ¥µ”ì4(4(€€€¥˜€ …Ñ¡¥Ì¹Á…ÕÍ•€˜˜€…Ñ¡¥Ì¹…µ•=Ù•È€˜˜€…Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤ì4(€€€€€¥˜€¡Ñ¡¥Ì¹…É•Q¥µ•È€ø€À¤ì4(€€€€€€€Ñ¡¥Ì¹…É•Q¥µ•È€ô5…Ñ ¹µ…à À°Ñ¡¥Ì¹…É•Q¥µ•È€´‘•±Ñ…Q¥µ”¤ì4(€€€€€ô•±Í”ì4(€€€€€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹Ð€˜˜€…Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€˜˜€…Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤ì4(€€€€€€€€€Ñ¡¥Ì¹ÍÁ…Ý¹9•ÝA¥•” ¤ì4(€€€€€€€ô4(4(€€€€€€€¥˜€¡Ñ¡¥Ì¹ÕÉÉ•¹Ð€˜˜€…Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€˜˜€…Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤ì4(€€€€€€€€€¥˜€¡Ñ¡¥Ì¹¥…ÍÍ¥ÍÐ¤ì4(€€€€€€€€€€€Ñ¡¥Ì¹…ÁÁ±å	½Ñ½¹ÑÉ½°¡‘•±Ñ…Q¥µ”¤ì4(€€€€€€€€€ô4(€€€€€€€€€Ñ¡¥Ì¹¡…¹‘±•!½É¥é½¹Ñ…±%¹ÁÕÐ¡‘•±Ñ…Q¥µ”¤ì4(€€€€€€€€€Ñ¡¥Ì¹¡…¹‘±•É…Ù¥Ñä¡‘•±Ñ…Q¥µ”¤ì4(€€€€€€€ô4(€€€€€ô4(€€€ô4(€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ” ¡Ð¤€ôøÑ¡¥Ì¹±½½À¡Ð¤¤ì4(€ô4(4(€ÍÑ…ÉÑQ¥µ•È ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤É•ÑÕÉ¸ì4(€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì4(€€€Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøÑ¡¥Ì¹Ñ¥­Q¥µ•È ¤°€ÈÔÀ¤ì4(€ô4(4(€É•ÍÕµ•Q¥µ•È ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤Ñ¡¥Ì¹ÍÑ…ÉÑQ¥µ•È ¤ì4(€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì4(€ô4(4(€Á…ÕÍ•Q¥µ•È ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€„ôô¹Õ±°¤ì4(€€€€€Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€¬ôÁ•É™½Éµ…¹”¹¹½Ü ¤€´Ñ¡¥Ì¹Ñ¥µ•É¹¡½Èì4(€€€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ô¹Õ±°ì4(€€€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì4(€€€ô4(€ô4(4(€ÍÑ½ÁQ¥µ•È ¤ì4(€€€Ñ¡¥Ì¹Á…ÕÍ•Q¥µ•È ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤ì4(€€€€€±•…É%¹Ñ•ÉÙ…°¡Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤ì4(€€€€€Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°€ô¹Õ±°ì4(€€€ô4(€ô4(4(€Ñ¥­Q¥µ•È ¤ì4(€€€¥˜€¡Ñ¡¥Ì¹Á…ÕÍ•ñðÑ¡¥Ì¹…µ•=Ù•ÈñðÑ¡¥Ì¹Ñ¥µ•É¹¡½È€ôôô¹Õ±°¤É•ÑÕÉ¸ì4(€€€½¹ÍÐ¹½Ü€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì4(€€€Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€¬ô¹½Ü€´Ñ¡¥Ì¹Ñ¥µ•É¹¡½Èì4(€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ô¹½Üì4(€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì4(€ô4(4(€ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì4(€€€¥˜€ …Ñ¡¥Ì¹Ñ¥µ•É¥ÍÁ±…ä¤É•ÑÕÉ¸ì4(€€€½¹ÍÐÑ½Ñ…±M•½¹‘Ì€ô5…Ñ ¹™±½½È¡Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€¼€ÄÀÀÀ¤ì4(€€€½¹ÍÐµ¥¹ÕÑ•Ì€ô5…Ñ ¹™±½½È¡Ñ½Ñ…±M•½¹‘Ì€¼€ØÀ¤ì4(€€€½¹ÍÐÍ•½¹‘Ì€ôÑ½Ñ…±M•½¹‘Ì€”€ØÀì4(€€€Ñ¡¥Ì¹Ñ¥µ•É¥ÍÁ±…ä¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘íµ¥¹ÕÑ•Íôè‘íÍ•½¹‘Ì¹Ñ½MÑÉ¥¹œ ¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥õ€ì4(€ô4(4(€€4)ô()±…ÍÌY•ÉÍÕÍ½¹ÑÉ½±±•Èì(€½¹ÍÑÉÕÑ½È¡¡Õµ…¸°ÁÔ¤ì(€€€¥˜€ „¡¡Õµ…¸¥¹ÍÑ…¹•½˜Q•ÑÉ¥Í…µ”¤ñð€„¡ÁÔ¥¹ÍÑ…¹•½˜Q•ÑÉ¥Í…µ”¤¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È m9QumÙ•ÉÍÕÍtM”É•ÅÕ¥•É•¸¥¹ÍÑ…¹¥…Ì¡Õµ…¹„äATÙ…±¥‘…Ì¸œ¤ì(€€€ô(€€€Ñ¡¥Ì¹¡Õµ…¸€ô¡Õµ…¸ì(€€€Ñ¡¥Ì¹ÁÔ€ôÁÔì(€€€Ñ¡¥Ì¹•¹…‰±•AT ¤ì((€€€¥˜€¡Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹Á±…å	Ñ¸¤ì(€€€€€Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹Á±…å	Ñ¸¹½¹±¥¬€ô€ ¤€ôøÑ¡¥Ì¹Ñ½±•A…ÕÍ” ¤ì(€€€ô(€€€¥˜€¡Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹¹•Ý…µ•	Ñ¸¤ì(€€€€€Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹¹•Ý…µ•	Ñ¸¹½¹±¥¬€ô€ ¤€ôøÑ¡¥Ì¹É•Í•Ð ¤ì(€€€ô(€ô((€•¹…‰±•AT ¤ì(€€€Ñ¡¥Ì¹ÁÔ¹¥…ÍÍ¥ÍÐ€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹ÁÔ¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°Ñ¡¥Ì¹ÁÔ¹Á…ÕÍ•€ü€‰±½¬œ€è€¹½¹”œ¤ì(€€€¥˜€¡Ñ¡¥Ì¹ÁÔ¹•±Ì¹ÍÑ…ÑÕÌ¤Ñ¡¥Ì¹ÁÔ¹•±Ì¹ÍÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ð€ô€5=<èATœì(€€€Ñ¡¥Ì¹ÁÔ¹ÕÁ‘…Ñ•%¹‘¥…Ñ½È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹ÁÔ¹ÕÉÉ•¹Ð€˜˜€…Ñ¡¥Ì¹ÁÔ¹…µ•=Ù•È€˜˜€…Ñ¡¥Ì¹ÁÔ¹¥Í¹¥µ…Ñ¥¹œ¤ì(€€€€€Ñ¡¥Ì¹ÁÔ¹É•ÅÕ•ÍÑ	½Ñ5½Ù” ¤ì(€€€ô(€ô((€Ñ½±•A…ÕÍ” ¤ì(€€€½¹ÍÐÍ¡½Õ±‘A…ÕÍ”€ô€…Ñ¡¥Ì¹¡Õµ…¸¹Á…ÕÍ•ñð€…Ñ¡¥Ì¹ÁÔ¹Á…ÕÍ•ì(€€€Ñ¡¥Ì¹¡Õµ…¸¹Í•ÑA…ÕÍ•¡Í¡½Õ±‘A…ÕÍ”¤ì(€€€Ñ¡¥Ì¹ÁÔ¹Í•ÑA…ÕÍ•¡Í¡½Õ±‘A…ÕÍ”¤ì(€ô((€É•Í•Ð ¤ì(€€€Ñ¡¥Ì¹¡Õµ…¸¹É•Í•Ð ¤ì(€€€Ñ¡¥Ì¹ÁÔ¹É•Í•Ð ¤ì(€€€Ñ¡¥Ì¹•¹…‰±•AT ¤ì(€ô)ô()Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±½…œ°€ ¤€ôøì(€½¹ÍÐ¡Õµ…¹I½½Ð€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹¡Õµ…¸µÍ¥‘”œ¤ì(€½¹ÍÐÁÕI½½Ð€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹ÁÔµÍ¥‘”œ¤ì(€½¹ÍÐ¡Õµ…¹U$€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹¡Õµ…¸µÕ¤œ¤ì(€½¹ÍÐÁÕU$€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹ÁÔµÕ¤œ¤ì(€½¹ÍÐÍ¡…É•‘½¹ÑÉ½±Ì€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹Í¡…É•µ½¹ÑÉ½±Ìœ¤ì(€¥˜€ …¡Õµ…¹I½½Ðñð€…ÁÕI½½Ðñð€…¡Õµ…¹U$ñð€…ÁÕU$ñð€…Í¡…É•‘½¹ÑÉ½±Ì¤ì(€€€½¹Í½±”¹•ÉÉ½È m9Qum‰½½ÑÍÑÉ…Át…ÍÐµ…¥°è±…å½ÕÐÙ•ÉÍÕÌ¥¹½µÁ±•Ñ¼¸œ¤ì(€€€É•ÑÕÉ¸ì(€ô((€½¹ÍÐ¡Õµ…¸€ô¹•ÜQ•ÑÉ¥Í…µ”¡¡Õµ…¹I½½Ð°ì(€€€Á±…å•É9…µ”è€@Äœ°(€€€Õ¥I½½Ðè¡Õµ…¹U$°(€€€½¹ÑÉ½±ÍI½½ÐèÍ¡…É•‘½¹ÑÉ½±Ì(€ô¤ì(€½¹ÍÐÁÔ€ô¹•ÜQ•ÑÉ¥Í…µ”¡ÁÕI½½Ð°ì(€€€Á±…å•É9…µ”è€ATœ°(€€€¥ÍATèÑÉÕ”°(€€€Õ¥I½½ÐèÁÕU$(€ô¤ì(€½¹ÍÐÙ•ÉÍÕÌ€ô¹•ÜY•ÉÍÕÍ½¹ÑÉ½±±•È¡¡Õµ…¸°ÁÔ¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°€¡•Ù•¹Ð¤€ôøì(€€€¥˜€¡•Ù•¹Ð¹­•ä¹Ñ½UÁÁ•É…Í” ¤€ôôô€@œ¤ì(€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€Ù•ÉÍÕÌ¹Ñ½±•A…ÕÍ” ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Ù•ÉÍÕÌ¹¡Õµ…¸¹¡…¹‘±•-•å½Ý¸¡•Ù•¹Ð¤ì(€ô¤ì(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•åÕÀœ°€¡•Ù•¹Ð¤€ôøÙ•ÉÍÕÌ¹¡Õµ…¸¹¡…¹‘±•-•åUÀ¡•Ù•¹Ð¤¤ì((€½¹ÍÐÍå¹Y•ÉÍÕÍ	½…É‘Ì€ô€ ¤€ôøì(€€€Íå¹	½…É‘M…±”¡Ù•ÉÍÕÌ¹ÁÔ°€À¸Ü¤ì(€€€Íå¹	½…É‘M…±”¡Ù•ÉÍÕÌ¹¡Õµ…¸¤ì(€ôì(€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Íå¹Y•ÉÍÕÍ	½…É‘Ì¤ì((€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È É•Í¥é”œ°€ ¤€ôøì(€€€±•…ÉQ¥µ•½ÕÐ¡Ý¥¹‘½Ü¹É•Í¥é•Q¥µ•È¤ì(€€€Ý¥¹‘½Ü¹É•Í¥é•Q¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ¡Íå¹Y•ÉÍÕÍ	½…É‘Ì°€ÔÀ¤ì(€ô¤ì((€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ½É¥•¹Ñ…Ñ¥½¹¡…¹”œ°Íå¹Y•ÉÍÕÍ	½…É‘Ì¤ì(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ™Õ±±ÍÉ••¹¡…¹”œ°Íå¹Y•ÉÍÕÍ	½…É‘Ì¤ì)ô¤ì