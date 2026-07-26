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
      case 'Arroçú¶‰Ëkºwµçu”¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì((€€€½¹ÍĞ‰½Ñ%ÍM½™ÑÉ½ÁÁ¥¹œ€ô(€€€€€Ñ¡¥Ì¹¥…ÍÍ¥ÍĞ€˜˜(€€€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹EÕ•Õ”€˜˜(€€€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹EÕ•Õ”¹±•¹Ñ €ø€À€˜˜(€€€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹EÕ•Õ•lÁt€ôôô€M=Q}I=@œì((€€€¥˜€¡‰½Ñ%ÍM½™ÑÉ½ÁÁ¥¹œ¤É•ÑÕÉ¸ì((€€€½¹ÍĞÉ…Ù¥ÑåMÁ••€ô5…Ñ ¹µ…à ÔÀ°€ÄÀÀÀ€´€¡Ñ¡¥Ì¹±•Ù•°€¨€ÔÀ¤¤ì(€€€€(€€€€¼¼€´´´5	%<EW4€´´´(€€€€¼¼M¤Í”ÁÉ•Í¥½¹„…‰…©¼°ÕÍ…µ½ÌM=Q}I=A}1d¸(€€€€¼¼UÍ…µ½Ì5…Ñ ¹µ¥¸Á…É„…Í•ÕÉ…ÈÅÕ”•°M½™ĞÉ½À¹Õ¹„Í•„€(€€€€¼¼·…Ì±•¹Ñ¼ÅÕ”±„É…Ù•‘…¹…ÑÕÉ…°€¡•¸¹¥Ù•±•ÌµÕä…±Ñ½Ì¤¸(€€€½¹ÍĞÕÉÉ•¹ÑMÁ••€ôÑ¡¥Ì¹­•åÌ¹‘½İ¸€(€€€€€€€€ü5…Ñ ¹µ¥¸¡Ñ¡¥Ì¹M=Q}I=A}1d°É…Ù¥ÑåMÁ••¤€(€€€€€€€€èÉ…Ù¥ÑåMÁ••ì(€€€€¼¼€´´´´´´´´´´´´´´´´´´´((€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€¬ô‘•±Ñ…Q¥µ”ì(€€€İ¡¥±”€¡Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€øôÕÉÉ•¹ÑMÁ••¤ì(€€€€€Ñ¡¥Ì¹…ÁÁ±åÉ…Ù¥Ñä ¤ì(€€€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€´ôÕÉÉ•¹ÑMÁ••ì(€€€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤‰É•…¬ì(€€€ô(€ô((€µ½Ù”¡‘¥È¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì(€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹à€¬‘¥È°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä¤¤ì(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹à€¬ô‘¥Èì(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì€(€€€ô(€ô((€É½Ñ…Ñ” ¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì(€€€€¼¼…±Õ±…ÈÍ¥Õ¥•¹Ñ”ƒµ¹‘¥”‘”É½Ñ…§Í¸(€€€½¹ÍĞ¹•áÑI½Ñ…Ñ¥½¸€ô€¡Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹É½Ñ…Ñ¥½¸€¬€Ä¤€”Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹Í¡…Á•Ì¹±•¹Ñ ì(€€€½¹ÍĞ¹•áÑ5…ÑÉ¥à€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹Í¡…Á•Ím¹•áÑI½Ñ…Ñ¥½¹tì((€€€€¼¼Y•É¥™¥…ÈÍ¤±„É½Ñ…§Í¸•ÌÛ…±¥‘„€¡½±¥Í§Í¸‹…Í¥„¤(€€€€¼¼9½Ñ„èÅ×´Í”Á½‘Ëµ…¸…É•…È€‰]…±°-¥­Ìˆ€¡¥¹Ñ•¹Ñ…Èµ½Ù•Èà´Ä°à¬Ä¤Í¤™…±±„(€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡¹•áÑ5…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹à°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä¤¤ì(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹É½Ñ…Ñ¥½¸€ô¹•áÑI½Ñ…Ñ¥½¸ì(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à€ô¹•áÑ5…ÑÉ¥àì(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì(€€€ô(€ô((€…ÑÑ•µÁÑ	½ÑI½Ñ…Ñ•]¥Ñ¡]…±±-¥¬ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸™…±Í”ì((€€€½¹ÍĞ¹•áÑI½Ñ…Ñ¥½¸€ô€¡Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹É½Ñ…Ñ¥½¸€¬€Ä¤€”Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹Í¡…Á•Ì¹±•¹Ñ ì(€€€½¹ÍĞ¹•áÑ5…ÑÉ¥à€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹Í¡…Á•Ím¹•áÑI½Ñ…Ñ¥½¹tì(€€€½¹ÍĞ½™™Í•ÑÌ€ôlÀ°€Ä°€´Ä°€È°€´Étì((€€€™½È€¡½¹ÍĞ½™™Í•Ğ½˜½™™Í•ÑÌ¤ì(€€€€€½¹ÍĞ…¹‘¥‘…Ñ•`€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹à€¬½™™Í•Ğì(€€€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡¹•áÑ5…ÑÉ¥à°…¹‘¥‘…Ñ•`°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä¤¤ì(€€€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹à€ô…¹‘¥‘…Ñ•`ì(€€€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹É½Ñ…Ñ¥½¸€ô¹•áÑI½Ñ…Ñ¥½¸ì(€€€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à€ô¹•áÑ5…ÑÉ¥àì(€€€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ô(€€€ô((€€€É•ÑÕÉ¸™…±Í”ì(€ô((€¡…É‘É½À ¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì(€€€€¼¼I•ÕÑ¥±¥é…µ½Ì•ÑÉ½Ád ¤ÅÕ”å„Ñ•»µ…ÌÁ…É„•°¡½ÍĞ(€€€½¹ÍĞä€ôÑ¡¥Ì¹•ÑÉ½Ád ¤ì(€€€Ñ¡¥Ì¹Í½É”€¬ô€¡ä€´Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä¤€¨€Èì€¼¼AÕ¹Ñ½Ì•áÑÉ„(€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä€ôäì(€€€Ñ¡¥Ì¹±½­A¥•” ¤ì€¼¼¥©…È¥¹µ•‘¥…Ñ…µ•¹Ñ”(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì(€ô((€¡½±‘A¥•” ¤ì(€€€½¹Í½±”¹İ…É¸ m9Qt!½±‘”Á¥•é„¹¼¥µÁ±•µ•¹Ñ…‘¼¸œ¤ì(€ô((€€¼¼!•±Á•È¹••Í…É¥¼Á…É„ÅÕ”•°•Ù…±Õ…‘½ÈÙ•„•°™ÕÑÕÉ¼½¸³µ¹•…Ì±¥µÁ¥…‘…Ì(€•ÑM¥µÕ±…Ñ•‘	½…É‘]¥Ñ¡1¥¹•Ì¡µ…ÑÉ¥à°Áà°Áä¤ì(€€€¥˜€ …µ…ÑÉ¥àñğ€…ÉÉ…ä¹¥ÍÉÉ…ä¡µ…ÑÉ¥à¤ñğ€…ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ¡¥Ì¹‰½…É¤¤ì(€€€€€½¹Í½±”¹İ…É¸ m9Qum‰½ÑQ¡¥¹­t…ÍĞµ…¥°è‘…Ñ½Ì¥¹Û…±¥‘½ÌÁ…É„Í¥µÕ±…ÈÑ…‰±•É¼¸œ¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô((€€€½¹ÍĞ±½¹”€ôÑ¡¥Ì¹‰½…É¹µ…À¡É½Ü€ôøl¸¸¹É½İt¤ì(€€€±•Ğ¥¹Ù…±¥‘AÉ½©•Ñ¥½¸€ô™…±Í”ì((€€€™½È€¡±•Ğ‘ä€ô€Àì‘ä€ğµ…ÑÉ¥à¹±•¹Ñ ì‘ä¬¬¤ì(€€€€€™½È€¡±•Ğ‘à€ô€Àì‘à€ğµ…ÑÉ¥ám‘åt¹±•¹Ñ ì‘à¬¬¤ì(€€€€€€€¥˜€ …µ…ÑÉ¥ám‘åum‘át¤½¹Ñ¥¹Õ”ì(€€€€€€€½¹ÍĞ¹ä€ôÁä€¬‘äì(€€€€€€€½¹ÍĞ¹à€ôÁà€¬‘àì(€€€€€€€¥˜€¡¹ä€ğ€Àñğ¹ä€øôI=]Lñğ¹à€ğ€Àñğ¹à€øô=1L¤ì(€€€€€€€€€¥¹Ù…±¥‘AÉ½©•Ñ¥½¸€ôÑÉÕ”ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€±½¹•m¹åum¹át€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹ÑåÁ•%ì(€€€€€ô(€€€€€¥˜€¡¥¹Ù…±¥‘AÉ½©•Ñ¥½¸¤‰É•…¬ì(€€€ô((€€€¥˜€¡¥¹Ù…±¥‘AÉ½©•Ñ¥½¸¤ì(€€€€€½¹Í½±”¹İ…É¸ m9Qum‰½ÑQ¡¥¹­t…ÍĞµ…¥°èÁÉ½å•§Í¸™Õ•É„‘”±½Ì³µµ¥Ñ•Ì‘•°Ñ…‰±•É¼¸œ¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô((€€€±•Ğ™¥±Ñ•É•€ô±½¹”¹™¥±Ñ•È¡É½Ü€ôøÉ½Ü¹Í½µ”¡•±°€ôø•±°€ôôô€´Ä¤¤ì(€€€½¹ÍĞ±¥¹•Í±•…É•€ôI=]L€´™¥±Ñ•É•¹±•¹Ñ ì(€€€İ¡¥±”€¡™¥±Ñ•É•¹±•¹Ñ €ğI=]L¤ì(€€€€€™¥±Ñ•É•¹Õ¹Í¡¥™Ğ¡ÉÉ…ä¡=1L¤¹™¥±° ´Ä¤¤ì(€€€ô((€€€É•ÑÕÉ¸í‰½…Éè™¥±Ñ•É•°±¥¹•Í±•…É•‘ôì(€ô((€•ÑÉ½Ád ¤ì(€€€±•Ğä€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹äì(€€€İ¡¥±”€ …Ñ¡¥Ì¹½±±¥‘•Ì¡Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹à°ä€¬€Ä¤¤ì(€€€€€ä¬¬ì(€€€ô(€€€É•ÑÕÉ¸äì(€ô((€…ÁÁ±åÉ…Ù¥Ñä ¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹ĞñğÑ¡¥Ì¹…É•Q¥µ•È€ø€À¤É•ÑÕÉ¸ì(€€€¥˜€ …Ñ¡¥Ì¹½±±¥‘•Ì¡Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹à°Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä€¬€Ä¤¤ì(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹ä¬¬ì(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì(€€€ô•±Í”ì(€€€€€Ñ¡¥Ì¹±½­A¥•” ¤ì(€€€ô(€ô((€±½­A¥•” ¤ì(€€€¥˜€¡Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œñğÑ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹Ğñğ€…Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à¤ì(€€€€€½¹Í½±”¹•ÉÉ½È m9QtA¥•é„¹¼‘¥ÍÁ½¹¥‰±”Á…É„‰±½ÅÕ•…È¸œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ¡¥Ì¹‰½…É¤¤ì(€€€€€½¹Í½±”¹•ÉÉ½È m9QtQ…‰±•É¼¥¹Û…±¥‘¼°…‰½ÉÑ…¹‘¼‰±½ÅÕ•¼¸œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍĞÁ±…•µ•¹ÑÌ€ômtì(€€€±•Ğ¥¹Ù…±¥‘A±…•µ•¹Ğ€ô™…±Í”ì((€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ¹µ…ÑÉ¥à¹™½É…  ¡É½Ü°‘ä¤€ôøì(€€€€€É½Ü¹™½É…  ¡Ù…°°‘à¤€ôøì(€€€€€€€¥˜€ …Ù…°¤É•ÑÕÉ¸ì(€€€€€€€½¹ÍĞ¹ä€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹ä€¬‘äì(€€€€€€€½¹ÍĞ¹à€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹à€¬‘àì(€€€€€€€¥˜€¡¹ä€ğ€Àñğ¹ä€øôI=]Lñğ¹à€ğ€Àñğ¹à€øô=1L¤ì(€€€€€€€€€¥¹Ù…±¥‘A±…•µ•¹Ğ€ôÑÉÕ”ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€¥˜€¡Ñ¡¥Ì¹‰½…É‘m¹åum¹át€„ôô€´Ä¤ì(€€€€€€€€€¥¹Ù…±¥‘A±…•µ•¹Ğ€ôÑÉÕ”ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€Á±…•µ•¹ÑÌ¹ÁÕÍ ¡ìàè¹à°äè¹äô¤ì(€€€€€ô¤ì(€€€ô¤ì((€€€¥˜€¡¥¹Ù…±¥‘A±…•µ•¹Ğ¤ì(€€€€€½¹Í½±”¹•ÉÉ½È m9Qt½±¥Í§Í¸Í¥µÕ±…‘„¼™Õ•É„‘”³µµ¥Ñ•Ì…°‰±½ÅÕ•…ÈÁ¥•é„¸œ¤ì(€€€€€Ñ¡¥Ì¹ÑÉ¥•É…µ•=Ù•È ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€Á±…•µ•¹ÑÌ¹™½É…  ¡ìà°äô¤€ôøì(€€€€€Ñ¡¥Ì¹‰½…É‘måumát€ôÑ¡¥Ì¹ÕÉÉ•¹Ğ¹ÑåÁ•%ì(€€€ô¤ì((€€€½¹ÍĞÉ½İÍQ½±•…È€ômtì(€€€™½È€¡±•ĞÈ€ô€ÀìÈ€ğI=]LìÈ¬¬¤ì(€€€€€¥˜€¡Ñ¡¥Ì¹‰½…É‘mÉt¹•Ù•Éä¡•±°€ôø•±°€„ôô€´Ä¤¤ì(€€€€€€€É½İÍQ½±•…È¹ÁÕÍ ¡È¤ì(€€€€€ô(€€€ô((€€€¥˜€¡É½İÍQ½±•…È¹±•¹Ñ €ø€À¤ì(€€€€€Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€ôÑÉÕ”ì(€€€€€Ñ¡¥Ì¹É½İÍQ½±•…È€ôÉ½İÍQ½±•…Èì(€€€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ€ô¹Õ±°ì(€€€€€Ñ¡¥Ì¹É•¹‘•È ¤ì((€€€€€Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€€€€€Ñ¡¥Ì¹‰½…É€ôÑ¡¥Ì¹‰½…É¹™¥±Ñ•È¡É½Ü€ôøÉ½Ü¹Í½µ”¡•±°€ôø•±°€ôôô€´Ä¤¤ì(€€€€€€€½¹ÍĞ±¥¹•Í±•…É•€ôÉ½İÍQ½±•…È¹±•¹Ñ ì(€€€€€€€Ñ¡¥Ì¹Í½É”€¬ô±¥¹•Í±•…É•€¨€ÄÀÀì(€€€€€€€Ñ¡¥Ì¹±¥¹•Ì€¬ô±¥¹•Í±•…É•ì((€€€€€€€İ¡¥±”€¡Ñ¡¥Ì¹‰½…É¹±•¹Ñ €ğI=]L¤ì(€€€€€€€€€Ñ¡¥Ì¹‰½…É¹Õ¹Í¡¥™Ğ¡ÉÉ…ä¡=1L¤¹™¥±° ´Ä¤¤ì(€€€€€€€ô((€€€€€€€Ñ¡¥Ì¹™¥¹¥Í¡QÕÉ¸¡±¥¹•Í±•…É•¤ì(€€€€€ô°€ĞÀÀ¤ì(€€€ô•±Í”ì(€€€€€Ñ¡¥Ì¹™¥¹¥Í¡QÕÉ¸ À¤ì(€€€ô(€ô((€™¥¹¥Í¡QÕÉ¸¡±¥¹•Í±•…É•¤ì(€€€Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€ô™…±Í”ì(€€€Ñ¡¥Ì¹É½İÍQ½±•…È€ô¹Õ±°ì((€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¤Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¹Ñ•áÑ½¹Ñ•¹Ğ€ôÑ¡¥Ì¹±¥¹•Ìì(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹Í½É”¤Ñ¡¥Ì¹•±Ì¹Í½É”¹Ñ•áÑ½¹Ñ•¹Ğ€ôÑ¡¥Ì¹Í½É”ì((€€€Ñ¡¥Ì¹¡½ÍĞ€ô¹Õ±°ì(€€€Ñ¡¥Ì¹‰½ÑA±…¸€ô¹Õ±°ì(€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹EÕ•Õ”€ômtì(€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹Q¥µ•È€ô€Àì(€€€Ñ¡¥Ì¹É•¹‘•É9•áĞ ¤ì((€€€Ñ¡¥Ì¹ÕÉÉ•¹Ğ€ô¹Õ±°ì(€€€Ñ¡¥Ì¹…É•Q¥µ•È€ôÑ¡¥Ì¹I}1dì(€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€ô€Àì(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì(€ô((€€¼¼€´´´9UYMU9%5=YH€´´´(€ÑÉ¥•É…µ•=Ù•È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¹…µ•=Ù•È€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹Á…ÕÍ•€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹ÍÑ½ÁQ¥µ•È ¤ì(€€€Ñ¡¥Ì¹¡¥‘•Ñ¥Ù•	±½­Ì ¤ì(€€€½¹ÍĞ‰Ñ¸€ôÑ¡¥Ì¹•±Ì¹Á±…å	Ñ¸ì(€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ğ€ô€ŸŠZØA±…äœì((€€€Ñ¡¥Ì¹ÉÕ¹…µ•=Ù•É•ÍÑÉÕÑ¥½¸ ¤ì(€ô((€ÉÕ¹…µ•=Ù•É•ÍÑÉÕÑ¥½¸ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ¡¥Ì¹‰½…É¤¤ì(€€€€€½¹Í½±”¹•ÉÉ½È m9Qum…µ•=Ù•ÉtQ…‰±•É¼¥¹Û…±¥‘¼°…‰½ÉÑ…¹‘¼‘•ÍÑÉÕ§Í¸¸œ¤ì(€€€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ô™…±Í”ì(€€€€€Ñ¡¥Ì¹Í¡½İ…µ•=Ù•ÉMÉ••¸ ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍĞ½ÕÁ¥•€ômtì(€€€™½È€¡±•Ğä€ô€Àìä€ğI=]Lìä¬¬¤ì(€€€€€™½È€¡±•Ğà€ô€Àìà€ğ=1Lìà¬¬¤ì(€€€€€€€¥˜€¡Ñ¡¥Ì¹‰½…É‘måumát€„ôô€´Ä€˜˜Ñ¡¥Ì¹‰½…É‘måumát€„ôô€´È¤ì(€€€€€€€€€½ÕÁ¥•¹ÁÕÍ ¡ìà°äô¤ì(€€€€€€€ô(€€€€€ô(€€€ô((€€€¥˜€¡½ÕÁ¥•¹±•¹Ñ €ôôô€À¤ì(€€€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ô™…±Í”ì(€€€€€Ñ¡¥Ì¹Í¡½İ…µ•=Ù•ÉMÉ••¸ ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍĞ¥‘à€ô5…Ñ ¹™±½½È¡5…Ñ ¹É…¹‘½´ ¤€¨½ÕÁ¥•¹±•¹Ñ ¤ì(€€€½¹ÍĞÑ…É•Ğ€ô½ÕÁ¥•‘m¥‘átì(€€€Ñ¡¥Ì¹‰½…É‘mÑ…É•Ğ¹åumÑ…É•Ğ¹át€ô€´Èì(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì((€€€Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€€€¥˜€ …Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€€€Ñ¡¥Ì¹‰½…É‘mÑ…É•Ğ¹åumÑ…É•Ğ¹át€ô€´Äì(€€€€€Ñ¡¥Ì¹ÉÕ¹…µ•=Ù•É•ÍÑÉÕÑ¥½¸ ¤ì(€€€ô°€ÈÀ¤ì(€ô((€Ñ½±•A…ÕÍ” ¤ì(€€€Ñ¡¥Ì¹Í•ÑA…ÕÍ• …Ñ¡¥Ì¹Á…ÕÍ•¤ì(€ô((€Í•ÑA…ÕÍ•¡Á…ÕÍ•¤ì(€€€¥˜€¡Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¹Á…ÕÍ•€ô	½½±•…¸¡Á…ÕÍ•¤ì(€€€½¹ÍĞ‰Ñ¸€ôÑ¡¥Ì¹•±Ì¹Á±…å	Ñ¸ì((€€€¥˜€¡Ñ¡¥Ì¹Á…ÕÍ•¤ì(€€€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€‰±½¬œ¤ì(€€€€€Ñ¡¥Ì¹Á…ÕÍ•Q¥µ•È ¤ì(€€€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ğ€ô€ŸŠZØA±…äœì€¼¼…µ‰¥¼Ù¥ÍÕ…°„A±…ä(€€€ô•±Í”¥˜€ …Ñ¡¥Ì¹…µ•=Ù•È¤ì(€€€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€¹½¹”œ¤ì(€€€€€Ñ¡¥Ì¹É•ÍÕµ•Q¥µ•È ¤ì(€€€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ğ€ô€ŸŠ>àA…ÕÍ”œì€¼¼…µ‰¥¼Ù¥ÍÕ…°„A…ÕÍ”(€€€ô(€ô((€Í¡½İ…µ•=Ù•ÉMÉ••¸ ¤ì(€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€‰±½¬œ¤ì(€€€½¹ÍĞ•°€ôÑ¡¥Ì¹•±Ì¹…µ•=Ù•Èì(€€€¥˜€ …•°¤É•ÑÕÉ¸ì((€€€•°¹¥¹¹•É!Q50€ô€(€€€€€€€€ñ Èù5=YHğ½ Èø(€€€€€€€€ñÀùM=I%90ğ½Àø(€€€€€€€€ñ‘¥Ø±…ÍÌô‰™¥¹…°µÍ½É”ˆø‘íÑ¡¥Ì¹Í½É•ôğ½‘¥Øø(€€€€€€€€ñÀù1¥¹•Ìè€‘íÑ¡¥Ì¹±¥¹•Íôğ½Àø(€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÌô‰‰Ñ¸µÁÉ¥µ…ÉäÉ•ÑÉå	Ñ¸ˆùQId%8ğ½‰ÕÑÑ½¸ø(€€€€ì(€€€€(€€€€¼¼Ñ¥Ù…È‰½ÓÍ¸‘”É•¥¹Ñ•¹Ñ¼(€€€½¹ÍĞÉ•ÑÉå	Ñ¸€ô•°¹ÅÕ•ÉåM•±•Ñ½È œ¹É•ÑÉå	Ñ¸œ¤ì(€€€É•ÑÉå	Ñ¸¹½¹±¥¬€ô€ ¤€ôøÑ¡¥Ì¹É•Í•Ğ ¤ì((€€€•°¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€™±•àœì(€ô((€É•Í•Ğ ¤ì(€€€½¹ÍĞ½MÉ••¸€ôÑ¡¥Ì¹•±Ì¹…µ•=Ù•Èì(€€€¥˜€¡½MÉ••¸¤½MÉ••¸¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€¹½¹”œì(€€€Ñ¡¥Ì¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°€‰±½¬œ¤ì(€€€Ñ¡¥Ì¹…µ•=Ù•È€ô™…±Í”ì(€€€Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ€ô™…±Í”ì(€€€Ñ¡¥Ì¹‰½…É€ôÉÉ…ä¹™É½´¡í±•¹Ñ èI=]Mô°€ ¤€ôøÉÉ…ä¡=1L¤¹™¥±° ´Ä¤¤ì(€€€Ñ¡¥Ì¹‰…œ€ômtì(€€€Ñ¡¥Ì¹¥¹¥Ñ	…œ ¤ì(€€€Ñ¡¥Ì¹¹•áĞ€ôÑ¡¥Ì¹•Ñ9•áÑA¥••QåÁ” ¤ì(€€€Ñ¡¥Ì¹ÍÁ…İ¹9•İA¥•” ¤ì(€€€Ñ¡¥Ì¹Á…ÕÍ•€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€ô™…±Í”ì(€€€Ñ¡¥Ì¹É½İÍQ½±•…È€ô¹Õ±°ì(€€€½¹ÍĞ‰Ñ¸€ôÑ¡¥Ì¹•±Ì¹Á±…å	Ñ¸ì(€€€¥˜€¡‰Ñ¸¤‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ğ€ô€ŸŠZØA±…äœì(€€€Ñ¡¥Ì¹Í½É”€ô€Àì(€€€Ñ¡¥Ì¹±¥¹•Ì€ô€Àì(€€€Ñ¡¥Ì¹±…ÍÑQ¥µ”€ô€Àì(€€€Ñ¡¥Ì¹…É•Q¥µ•È€ô€Àì(€€€Ñ¡¥Ì¹‘…ÍQ¥µ•È€ô€Àì(€€€Ñ¡¥Ì¹™…±±ÕµÕ±…Ñ½È€ô€Àì(€€€Ñ¡¥Ì¹‰½ÑA±…¸€ô¹Õ±°ì(€€€Ñ¡¥Ì¹­•åÌ€ôì±•™Ğè™…±Í”°É¥¡Ğè™…±Í”°‘½İ¸è™…±Í”ôì(€€€Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€ô€Àì(€€€Ñ¡¥Ì¹¥Í	½ÑQ¡¥¹­¥¹œ€ô™…±Í”ì(€€€Ñ¡¥Ì¹Á•¹‘¥¹	½ÑI•ÅÕ•ÍÑ%€ô¹Õ±°ì(€€€Ñ¡¥Ì¹¡½ÍĞ€ô¹Õ±°ì(€€€Ñ¡¥Ì¹‰½ÑÑ¥½¹Q¥µ•È€ô€Àì(€€€Ñ¡¥Ì¹‰½Ñ5½‘”€ô¹Õ±°ì(€€€Ñ¡¥Ì¹ÍÑ½ÁQ¥µ•È ¤ì(€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹Í½É”¤Ñ¡¥Ì¹•±Ì¹Í½É”¹Ñ•áÑ½¹Ñ•¹Ğ€ôÑ¡¥Ì¹Í½É”ì(€€€¥˜€¡Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¤Ñ¡¥Ì¹•±Ì¹±¥¹•Ì¹Ñ•áÑ½¹Ñ•¹Ğ€ôÑ¡¥Ì¹±¥¹•Ìì(€€€Ñ¡¥Ì¹É•¹‘•È ¤ì(€€€Ñ¡¥Ì¹É•¹‘•É9•áĞ ¤ì(€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•%¹‘¥…Ñ½È ¤ì(€ô((€±½½À¡Ñ¥µ”€ô€À¤ì(€€€½¹ÍĞ‘•±Ñ…Q¥µ”€ôÑ¡¥Ì¹±…ÍÑQ¥µ”€üÑ¥µ”€´Ñ¡¥Ì¹±…ÍÑQ¥µ”€è€Àì(€€€Ñ¡¥Ì¹±…ÍÑQ¥µ”€ôÑ¥µ”ì((€€€¥˜€ …Ñ¡¥Ì¹Á…ÕÍ•€˜˜€…Ñ¡¥Ì¹…µ•=Ù•È€˜˜€…Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤ì(€€€€€¥˜€¡Ñ¡¥Ì¹…É•Q¥µ•È€ø€À¤ì(€€€€€€€Ñ¡¥Ì¹…É•Q¥µ•È€ô5…Ñ ¹µ…à À°Ñ¡¥Ì¹…É•Q¥µ•È€´‘•±Ñ…Q¥µ”¤ì(€€€€€ô•±Í”ì(€€€€€€€¥˜€ …Ñ¡¥Ì¹ÕÉÉ•¹Ğ€˜˜€…Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€˜˜€…Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤ì(€€€€€€€€€Ñ¡¥Ì¹ÍÁ…İ¹9•İA¥•” ¤ì(€€€€€€€ô((€€€€€€€¥˜€¡Ñ¡¥Ì¹ÕÉÉ•¹Ğ€˜˜€…Ñ¡¥Ì¹¥Í¹¥µ…Ñ¥¹œ€˜˜€…Ñ¡¥Ì¹¥Í…µ•=Ù•É¹¥µ…Ñ¥¹œ¤ì(€€€€€€€€€¥˜€¡Ñ¡¥Ì¹¥…ÍÍ¥ÍĞ¤ì(€€€€€€€€€€€Ñ¡¥Ì¹…ÁÁ±å	½Ñ½¹ÑÉ½°¡‘•±Ñ…Q¥µ”¤ì(€€€€€€€€€ô(€€€€€€€€€Ñ¡¥Ì¹¡…¹‘±•!½É¥é½¹Ñ…±%¹ÁÕĞ¡‘•±Ñ…Q¥µ”¤ì(€€€€€€€€€Ñ¡¥Ì¹¡…¹‘±•É…Ù¥Ñä¡‘•±Ñ…Q¥µ”¤ì(€€€€€€€ô(€€€€€ô(€€€ô(€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ” ¡Ğ¤€ôøÑ¡¥Ì¹±½½À¡Ğ¤¤ì(€ô((€ÍÑ…ÉÑQ¥µ•È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøÑ¡¥Ì¹Ñ¥­Q¥µ•È ¤°€ÈÔÀ¤ì(€ô((€É•ÍÕµ•Q¥µ•È ¤ì(€€€¥˜€ …Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤Ñ¡¥Ì¹ÍÑ…ÉÑQ¥µ•È ¤ì(€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€ô((€Á…ÕÍ•Q¥µ•È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€„ôô¹Õ±°¤ì(€€€€€Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€¬ôÁ•É™½Éµ…¹”¹¹½Ü ¤€´Ñ¡¥Ì¹Ñ¥µ•É¹¡½Èì(€€€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ô¹Õ±°ì(€€€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì(€€€ô(€ô((€ÍÑ½ÁQ¥µ•È ¤ì(€€€Ñ¡¥Ì¹Á…ÕÍ•Q¥µ•È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤ì(€€€€€±•…É%¹Ñ•ÉÙ…°¡Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°¤ì(€€€€€Ñ¡¥Ì¹Ñ¥µ•É%¹Ñ•ÉÙ…°€ô¹Õ±°ì(€€€ô(€ô((€Ñ¥­Q¥µ•È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹Á…ÕÍ•ñğÑ¡¥Ì¹…µ•=Ù•ÈñğÑ¡¥Ì¹Ñ¥µ•É¹¡½È€ôôô¹Õ±°¤É•ÑÕÉ¸ì(€€€½¹ÍĞ¹½Ü€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€¬ô¹½Ü€´Ñ¡¥Ì¹Ñ¥µ•É¹¡½Èì(€€€Ñ¡¥Ì¹Ñ¥µ•É¹¡½È€ô¹½Üì(€€€Ñ¡¥Ì¹ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì(€ô((€ÕÁ‘…Ñ•Q¥µ•É¥ÍÁ±…ä ¤ì(€€€¥˜€ …Ñ¡¥Ì¹Ñ¥µ•É¥ÍÁ±…ä¤É•ÑÕÉ¸ì(€€€½¹ÍĞÑ½Ñ…±M•½¹‘Ì€ô5…Ñ ¹™±½½È¡Ñ¡¥Ì¹•±…ÁÍ•‘5Ì€¼€ÄÀÀÀ¤ì(€€€½¹ÍĞµ¥¹ÕÑ•Ì€ô5…Ñ ¹™±½½È¡Ñ½Ñ…±M•½¹‘Ì€¼€ØÀ¤ì(€€€½¹ÍĞÍ•½¹‘Ì€ôÑ½Ñ…±M•½¹‘Ì€”€ØÀì(€€€Ñ¡¥Ì¹Ñ¥µ•É¥ÍÁ±…ä¹Ñ•áÑ½¹Ñ•¹Ğ€ô€‘íµ¥¹ÕÑ•Íôè‘íÍ•½¹‘Ì¹Ñ½MÑÉ¥¹œ ¤¹Á…‘MÑ…ÉĞ È°€œÀœ¥õ€ì(€ô((€€)ô()±…ÍÌY•ÉÍÕÍ½¹ÑÉ½±±•Èì(€½¹ÍÑÉÕÑ½È¡¡Õµ…¸°ÁÔ¤ì(€€€¥˜€ „¡¡Õµ…¸¥¹ÍÑ…¹•½˜Q•ÑÉ¥Í…µ”¤ñğ€„¡ÁÔ¥¹ÍÑ…¹•½˜Q•ÑÉ¥Í…µ”¤¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È m9QumÙ•ÉÍÕÍtM”É•ÅÕ¥•É•¸¥¹ÍÑ…¹¥…Ì¡Õµ…¹„äATÙ…±¥‘…Ì¸œ¤ì(€€€ô(€€€Ñ¡¥Ì¹¡Õµ…¸€ô¡Õµ…¸ì(€€€Ñ¡¥Ì¹ÁÔ€ôÁÔì(€€€Ñ¡¥Ì¹•¹…‰±•AT ¤ì((€€€¥˜€¡Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹Á±…å	Ñ¸¤ì(€€€€€Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹Á±…å	Ñ¸¹½¹±¥¬€ô€ ¤€ôøÑ¡¥Ì¹Ñ½±•A…ÕÍ” ¤ì(€€€ô(€€€¥˜€¡Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹¹•İ…µ•	Ñ¸¤ì(€€€€€Ñ¡¥Ì¹¡Õµ…¸¹•±Ì¹¹•İ…µ•	Ñ¸¹½¹±¥¬€ô€ ¤€ôøÑ¡¥Ì¹É•Í•Ğ ¤ì(€€€ô(€ô((€•¹…‰±•AT ¤ì(€€€Ñ¡¥Ì¹ÁÔ¹¥…ÍÍ¥ÍĞ€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹ÁÔ¹•±Ì¹…µ•5•ÍÍ…”ü¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä ‘¥ÍÁ±…äœ°Ñ¡¥Ì¹ÁÔ¹Á…ÕÍ•€ü€‰±½¬œ€è€¹½¹”œ¤ì(€€€¥˜€¡Ñ¡¥Ì¹ÁÔ¹•±Ì¹ÍÑ…ÑÕÌ¤Ñ¡¥Ì¹ÁÔ¹•±Ì¹ÍÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ô€5=<èATœì(€€€Ñ¡¥Ì¹ÁÔ¹ÕÁ‘…Ñ•%¹‘¥…Ñ½È ¤ì(€€€¥˜€¡Ñ¡¥Ì¹ÁÔ¹ÕÉÉ•¹Ğ€˜˜€…Ñ¡¥Ì¹ÁÔ¹…µ•=Ù•È€˜˜€…Ñ¡¥Ì¹ÁÔ¹¥Í¹¥µ…Ñ¥¹œ¤ì(€€€€€Ñ¡¥Ì¹ÁÔ¹É•ÅÕ•ÍÑ	½Ñ5½Ù” ¤ì(€€€ô(€ô((€Ñ½±•A…ÕÍ” ¤ì(€€€½¹ÍĞÍ¡½Õ±‘A…ÕÍ”€ô€…Ñ¡¥Ì¹¡Õµ…¸¹Á…ÕÍ•ñğ€…Ñ¡¥Ì¹ÁÔ¹Á…ÕÍ•ì(€€€Ñ¡¥Ì¹¡Õµ…¸¹Í•ÑA…ÕÍ•¡Í¡½Õ±‘A…ÕÍ”¤ì(€€€Ñ¡¥Ì¹ÁÔ¹Í•ÑA…ÕÍ•¡Í¡½Õ±‘A…ÕÍ”¤ì(€ô((€É•Í•Ğ ¤ì(€€€Ñ¡¥Ì¹¡Õµ…¸¹É•Í•Ğ ¤ì(€€€Ñ¡¥Ì¹ÁÔ¹É•Í•Ğ ¤ì(€€€Ñ¡¥Ì¹•¹…‰±•AT ¤ì(€ô)ô()İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±½…œ°€ ¤€ôøì(€½¹ÍĞ¡Õµ…¹I½½Ğ€ô‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½È œ¹¡Õµ…¸µÍ¥‘”œ¤ì(€½¹ÍĞÁÕI½½Ğ€ô‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½È œ¹ÁÔµÍ¥‘”œ¤ì(€½¹ÍĞ¡Õµ…¹U$€ô‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½È œ¹¡Õµ…¸µÕ¤œ¤ì(€½¹ÍĞÁÕU$€ô‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½È œ¹ÁÔµÕ¤œ¤ì(€½¹ÍĞÍ¡…É•‘½¹ÑÉ½±Ì€ô‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½È œ¹Í¡…É•µ½¹ÑÉ½±Ìœ¤ì(€¥˜€ …¡Õµ…¹I½½Ğñğ€…ÁÕI½½Ğñğ€…¡Õµ…¹U$ñğ€…ÁÕU$ñğ€…Í¡…É•‘½¹ÑÉ½±Ì¤ì(€€€½¹Í½±”¹•ÉÉ½È m9Qum‰½½ÑÍÑÉ…Át…ÍĞµ…¥°è±…å½ÕĞÙ•ÉÍÕÌ¥¹½µÁ±•Ñ¼¸œ¤ì(€€€É•ÑÕÉ¸ì(€ô((€½¹ÍĞ¡Õµ…¸€ô¹•ÜQ•ÑÉ¥Í…µ”¡¡Õµ…¹I½½Ğ°ì(€€€Á±…å•É9…µ”è€@Äœ°(€€€Õ¥I½½Ğè¡Õµ…¹U$°(€€€½¹ÑÉ½±ÍI½½ĞèÍ¡…É•‘½¹ÑÉ½±Ì(€ô¤ì(€½¹ÍĞÁÔ€ô¹•ÜQ•ÑÉ¥Í…µ”¡ÁÕI½½Ğ°ì(€€€Á±…å•É9…µ”è€ATœ°(€€€¥ÍATèÑÉÕ”°(€€€Õ¥I½½ĞèÁÕU$(€ô¤ì(€½¹ÍĞÙ•ÉÍÕÌ€ô¹•ÜY•ÉÍÕÍ½¹ÑÉ½±±•È¡¡Õµ…¸°ÁÔ¤ì((€‘½Õµ•¹Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½İ¸œ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡•Ù•¹Ğ¹­•ä¹Ñ½UÁÁ•É…Í” ¤€ôôô€@œ¤ì(€€€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€€€Ù•ÉÍÕÌ¹Ñ½±•A…ÕÍ” ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Ù•ÉÍÕÌ¹¡Õµ…¸¹¡…¹‘±•-•å½İ¸¡•Ù•¹Ğ¤ì(€ô¤ì(€‘½Õµ•¹Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•åÕÀœ°€¡•Ù•¹Ğ¤€ôøÙ•ÉÍÕÌ¹¡Õµ…¸¹¡…¹‘±•-•åUÀ¡•Ù•¹Ğ¤¤ì((€½¹ÍĞÍå¹Y•ÉÍÕÍ	½…É‘Ì€ô€ ¤€ôøì(€€€Íå¹	½…É‘M…±”¡Ù•ÉÍÕÌ¹ÁÔ°€À¸Ü¤ì(€€€Íå¹	½…É‘M…±”¡Ù•ÉÍÕÌ¹¡Õµ…¸¤ì(€ôì(€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Íå¹Y•ÉÍÕÍ	½…É‘Ì¤ì((€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È É•Í¥é”œ°€ ¤€ôøì(€€€±•…ÉQ¥µ•½ÕĞ¡İ¥¹‘½Ü¹É•Í¥é•Q¥µ•È¤ì(€€€İ¥¹‘½Ü¹É•Í¥é•Q¥µ•È€ôÍ•ÑQ¥µ•½ÕĞ¡Íå¹Y•ÉÍÕÍ	½…É‘Ì°€ÔÀ¤ì(€ô¤ì((€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ½É¥•¹Ñ…Ñ¥½¹¡…¹”œ°Íå¹Y•ÉÍÕÍ	½…É‘Ì¤ì(€‘½Õµ•¹Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ™Õ±±ÍÉ••¹¡…¹”œ°Íå¹Y•ÉÍÕÍ	½…É‘Ì¤ì)ô¤ì