/*
 * PROJECT:  JsTetris
 * VERSION:  1.30
 * LICENSE:  BSD (revised)
 * AUTHOR:   (c) 2004 Czarek Tomczak
 * WEBSITE:  https://github.com/cztomczak/jstetris
 *
 * This game can be used freely as long as all
 * copyright messages are intact.
 */

/**
 * Tetris Game
 * Initializes the buttons automatically, no additional actions required
 *
 * Score:
 * 1) puzzle speed = 80+700/level
 * 2) if puzzles created in current level >= 10+level*2 then increase level
 * 3) after puzzle falling score is increased by 1000*level*linesRemoved
 * 4) each down action increases score by 5+level
 *
 * API:
 *
 * public - method can be called outside of the object
 * event - method is used as event, "this" refers to html object, "self" refers to javascript object
 *
 * class Tetris
 * ------------
 * public event void start()
 * public event void reset()
 * public event void pause()
 * public event void gameOver()
 * public event void up()
 * public event void down()
 * public event void left()
 * public event void right()
 * public event void space()
 *
 * class Window
 * ------------
 * event void activate()
 * event void close()
 * public bool isActive()
 *
 * class Keyboard
 * --------------
 * public void set(int key, function func)
 * event void event(object e)
 *
 * class Stats
 * -----------
 * public void start()
 * public void stop()
 * public void reset()
 * public event void incTime()
 * public void setScore(int i)
 * public void setLevel(int i)
 * public void setLines(int i)
 * public void setPuzzles(int i)
 * public void setActions(int i)
 * public int getScore()
 * public int getLevel()
 * public int getLines()
 * public int getPuzzles()
 * public int getActions()
 *
 * class Area
 * ----------
 * public Constructor(int unit, int x, int y, string id)
 * public void destroy()
 * public int removeFullLines()
 * public bool isLineFull(int y)
 * public void removeLine(int y)
 * public mixed getBlock(int y, int x)
 * public void addElement(htmlObject el)
 *
 * class Puzzle
 * ------------
 * public Constructor(object area)
 * public void reset()
 * public bool isRunning()
 * public bool isStopped()
 * public int getX()
 * public int getY()
 * public bool mayPlace()
 * public void place()
 * public void destroy()
 * private array createEmptyPuzzle(int y, int x)
 * event void fallDown()
 * public event void forceMoveDown()
 * public void stop()
 * public bool mayRotate()
 * public void rotate()
 * public bool mayMoveDown()
 * public void moveDown()
 * public bool mayMoveLeft()
 * public void moveLeft()
 * public bool mayMoveRight()
 * public void moveRight()
 *
 * class Highscores
 * ----------------
 * public Constructor(maxscores)
 * public void load()
 * public void save()
 * public bool mayAdd(int score)
 * public void add(string name, int score)
 * public array getScores()
 * public string toHtml()
 * private void sort()
 *
 * class Cookie
 * ------------
 * public string get(string name)
 * public void set(string name, string value, int seconds, string path, string domain, bool secure)
 * public void del(string name)
 *
 * TODO:
 * document.getElementById("tetris-nextpuzzle") cache ?
 *
 */
function Tetris()
{
	var self = this;

        this.stats = new Stats();
        this.humanPuzzle = null;
        this.botPuzzle = null;
        this.area = null;
        // Dual-state: mantener referencias separadas para la pieza humana y la pieza del bot.

        this.unit  = 20;
        this.areaX = 12;
        this.areaY = 22;
        this.isCoopMode = false; // Estado explícito del modo de juego
        this.isIAAssist = false; // Flag interno para IA-ASSIST
        this.iaPending = false; // Estado intermedio mientras se habilita el bot
        this.inputLocked = false; // Bloquea los comandos mientras se recalculan los modos

        this.highscores = new Highscores(10);
        this.paused = false;
        this.zenMode = false; // Modo ZEN desactivado por defecto

        var SIDEBAR_UNITS = 9.5;
	this.sidebarUnits = SIDEBAR_UNITS;

	/**
	 * Actualiza las variables de estilo CSS basadas en la unidad actual.
	 * @return void
	 * @access private
	 */
	this.updateCssScale = function()
	{
		var rootStyle = document.documentElement.style;
		rootStyle.setProperty('--unit', self.unit + 'px');
		rootStyle.setProperty('--area-x', self.areaX);
		rootStyle.setProperty('--area-y', self.areaY);
		rootStyle.setProperty('--sidebar-units', SIDEBAR_UNITS);

		var areaEl = document.getElementById('tetris-area');
		if (areaEl) {
			var areaWidth = (self.unit * self.areaX) - 1;
			var areaHeight = (self.unit * self.areaY) - 1;
			areaEl.style.width = areaWidth + 'px';
			areaEl.style.height = areaHeight + 'px';
			areaEl.style.left = (self.unit * SIDEBAR_UNITS + 1) + 'px';
			areaEl.style.top = '1px';
		}

		var tetrisEl = document.getElementById('tetris');
		if (tetrisEl) {
			var tetrisWidth = Math.ceil(self.unit * (self.areaX + SIDEBAR_UNITS)) + 1;
			var tetrisHeight = (self.unit * self.areaY) + 1;
			tetrisEl.style.width = tetrisWidth + 'px';
			tetrisEl.style.height = tetrisHeight + 'px';
		}

		var sidebar = document.querySelector('#tetris .left');
		if (sidebar) {
			sidebar.style.width = Math.ceil(self.unit * SIDEBAR_UNITS) + 'px';
		}

		var border = document.querySelector('#tetris .left-border');
		if (border) {
			border.style.left = Math.ceil(self.unit * SIDEBAR_UNITS) + 'px';
		}

		var keys = document.getElementById('tetris-keys');
		if (keys) {
			keys.style.left = Math.round(self.unit * 1.8) + 'px';
			keys.style.top = Math.round(self.unit * 9.6) + 'px';
		}

		var stats = document.querySelector('#tetris .left .stats');
		if (stats) {
			stats.style.left = Math.round(self.unit * 1.8) + 'px';
			stats.style.bottom = Math.round(self.unit * 0.35) + 'px';
		}

		var next = document.getElementById('tetris-nextpuzzle');
		if (next) {
			next.style.width = Math.round(self.unit * 5) + 'px';
			next.style.height = Math.round(self.unit * 4) + 'px';
		}
	};

	/**
	 * Reescala los elementos del tablero y de la siguiente pieza.
	 * @return void
	 * @access private
	 */
	this.rescaleBoard = function()
	{
		if (self.area) {
			self.area.unit = self.unit;
			for (var y = 0; y < self.area.board.length; y++) {
				for (var x = 0; x < self.area.board[y].length; x++) {
					if (self.area.board[y][x]) {
						self.area.board[y][x].style.left = (x * self.area.unit) + 'px';
						self.area.board[y][x].style.top = (y * self.area.unit) + 'px';
					}
				}
			}
		}

                var puzzlesToRescale = [self.humanPuzzle, self.botPuzzle];
                for (var index = 0; index < puzzlesToRescale.length; index++) {
                        var activePuzzle = puzzlesToRescale[index];
                        if (!activePuzzle || !activePuzzle.board || !activePuzzle.board.length) {
                                continue;
                        }

                        for (var y2 = 0; y2 < activePuzzle.board.length; y2++) {
                                for (var x2 = 0; x2 < activePuzzle.board[y2].length; x2++) {
                                        if (activePuzzle.board[y2][x2]) {
                                                activePuzzle.board[y2][x2].style.left = (activePuzzle.getX() + x2) * self.area.unit + 'px';
                                                activePuzzle.board[y2][x2].style.top = (activePuzzle.getY() + y2) * self.area.unit + 'px';
                                        }
                                }
                        }
                }

                if (self.humanPuzzle) {
                        var nextContainer = document.getElementById('tetris-nextpuzzle');
                        if (nextContainer) {
                                nextContainer.innerHTML = '';
                                self.humanPuzzle.nextElements = [];
                                var nextPuzzle = self.humanPuzzle.puzzles[self.humanPuzzle.nextType];
                                for (var ny = 0; ny < nextPuzzle.length; ny++) {
                                        for (var nx = 0; nx < nextPuzzle[ny].length; nx++) {
                                                if (nextPuzzle[ny][nx]) {
                                                        var nextEl = document.createElement('div');
                                                        nextEl.className = 'block' + self.humanPuzzle.nextType;
                                                        nextEl.style.left = (nx * self.area.unit) + 'px';
                                                        nextEl.style.top = (ny * self.area.unit) + 'px';
                                                        nextContainer.appendChild(nextEl);
                                                        self.humanPuzzle.nextElements.push(nextEl);
                                                }
                                        }
                                }
                        }
                }
        };

	/**
	 * Calcula el tamaño de la unidad en función del espacio disponible.
	 * @return void
	 * @access public
	 */
        this.updateResponsiveUnit = function()
        {
                var availableWidth = window.innerWidth * 0.9;
                var availableHeight = window.innerHeight * 0.9;
                var unitFromWidth = (availableWidth - 1) / (self.areaX + SIDEBAR_UNITS);
                var unitFromHeight = (availableHeight - 1) / self.areaY;
                var calculated = Math.max(10, Math.floor(Math.min(unitFromWidth, unitFromHeight)));

		if (!calculated || calculated == self.unit) {
			self.updateCssScale();
			return;
		}

                self.unit = calculated;
                self.updateCssScale();
                self.rescaleBoard();
        };

        /**
         * Cambia el modo de juego con hot-swap perfecto.
         * Soporta activar/desactivar Co-op en cualquier momento sin perder la partida.
         * Sincronización completa del 7-bag entre humano y bot.
         * @param {boolean} coopEnabled
         */
        this.setGameMode = function(coopEnabled)
        {
                self.updateGameMode({ coop: !!coopEnabled, ia: self.isIAAssist, zen: self.zenMode });
        };

        /**
         * Bloquea temporalmente la entrada para evitar carreras durante el swap de modos.
         */
        this.pauseInput = function()
        {
                self.inputLocked = true;
        };

        /**
         * Desbloquea la entrada después de un cambio de modo seguro.
         */
        this.unlockInput = function()
        {
                self.inputLocked = false;
        };

        /**
         * Congela el tablero: detiene cualquier caída en curso sin destruir el estado.
         */
        this.freezeBoard = function()
        {
                if (self.humanPuzzle && self.humanPuzzle.isRunning()) { self.humanPuzzle.clearTimers(); }
                if (self.botPuzzle && self.botPuzzle.isRunning()) { self.botPuzzle.clearTimers(); }
        };

        /**
         * Limpia todos los timers activos de las piezas humanas y del bot.
         */
        this.clearAllTimers = function()
        {
                if (self.humanPuzzle && typeof self.humanPuzzle.clearTimers === 'function') {
                        self.humanPuzzle.clearTimers();
                }

                if (self.botPuzzle && typeof self.botPuzzle.clearTimers === 'function') {
                        self.botPuzzle.clearTimers();
                }
        };

        /**
         * Restablece cualquier planificación en curso del bot.
         */
        this.resetBotPlanning = function()
        {
                if (!window.bot) { return; }

                if (typeof window.bot.cancelPlanning === 'function') {
                        window.bot.cancelPlanning();
                        return;
                }

                window.bot.bestBotMove = null;
                window.bot.predictedBoard = null;
                window.bot.isThinking = false;
                if (typeof window.bot.clearGhostPreview === 'function') {
                        window.bot.clearGhostPreview();
                }
        };

        this.updateControlStyles = function(actor)
        {
                if (!actor || !actor.elements || typeof actor.elements.forEach !== 'function') { return; }

                var shouldMarkBot = !actor.isHumanControlled;
                var toggleVisual = function(el) {
                        if (!el || !el.classList) { return; }
                        if (shouldMarkBot) {
                                el.classList.add('bot-controlled');
                        } else {
                                el.classList.remove('bot-controlled');
                        }
                };

                actor.elements.forEach(toggleVisual);
                if (actor.nextElements && typeof actor.nextElements.forEach === 'function') {
                        actor.nextElements.forEach(toggleVisual);
                }
        };

        this.updateModeStatus = function()
        {
                var el = document.getElementById('mode-status');
                if (!el) { return; }

                if (self.isIAAssist) {
                        el.textContent = 'MODO: IA-ASSIST (Bot en control)';
                        el.style.color = '#00e5ff';
                } else if (self.isCoopMode) {
                        el.textContent = 'MODO: CO-OP (Humano+Bot)';
                        el.style.color = '#00cc44';
                } else if (self.zenMode) {
                        el.textContent = 'MODO: ZEN (Lento Control Humano)';
                        el.style.color = '#ffaa00';
                } else {
                        el.textContent = 'MODO: CLÁSICO';
                        el.style.color = '#ffffff';
                }
        };

        /**
         * Establece la autoridad del dueño de la pieza activa y reinicia la caída segura.
         */
        this.applyOwnerRules = function()
        {
                // Fast-fail: no alterar dueños mientras IA esté pendiente de habilitación
                if (self.iaPending) { return; }

                if (self.isIAAssist) {
                        self.humanPuzzle = null;
                        if (self.botPuzzle) {
                                self.botPuzzle.isHumanControlled = false;
                                self.botPuzzle.running = true;
                                self.botPuzzle.stopped = false;
                        }
                } else if (self.isCoopMode) {
                        if (self.humanPuzzle) {
                                self.humanPuzzle.isHumanControlled = true;
                                self.humanPuzzle.running = true;
                                self.humanPuzzle.stopped = false;
                        }
                        if (self.botPuzzle) {
                                self.botPuzzle.isHumanControlled = false; // no gravedad del bot
                                self.botPuzzle.running = false;
                        }
                } else {
                        if (self.botPuzzle && typeof self.botPuzzle.clearTimers === 'function') {
                                self.botPuzzle.clearTimers();
                        }
                        self.botPuzzle = null;
                        if (self.humanPuzzle) {
                                self.humanPuzzle.isHumanControlled = true;
                                self.humanPuzzle.running = true;
                                self.humanPuzzle.stopped = false;
                        }
                }

                self.updateControlStyles(self.humanPuzzle);
                self.updateControlStyles(self.botPuzzle);

                console.info('[SWAP] Autoridad aplicada', {
                        modo: self.isIAAssist ? 'ia-assist' : (self.isCoopMode ? 'coop' : 'solo'),
                        humanoActivo: !!(self.humanPuzzle && self.humanPuzzle.isRunning && self.humanPuzzle.isRunning()),
                        botActivo: !!(self.botPuzzle && self.botPuzzle.isRunning && self.botPuzzle.isRunning())
                });

                if (self.humanPuzzle && self.humanPuzzle.isRunning && self.humanPuzzle.isRunning()) {
                        self.humanPuzzle.fallDown();
                }

                // Asegurar reanudación inmediata del ciclo de caída
                if (self.humanPuzzle && !self.humanPuzzle.fallDownID && self.humanPuzzle.isRunning()) {
                        self.humanPuzzle.fallDown();
                }
        };

        /**
         * Centraliza el estado del modo de juego para evitar condiciones de carrera.
         * Aplica reglas de exclusión entre Co-op y IA-ASSIST y sincroniza la UI.
         * @param {{coop:boolean, ia:boolean, zen:boolean}} modeState
         */
        this.updateGameMode = function(modeState)
        {
                console.info('[SWAP] Inicio de hot-swap de modo', {
                        coop: !!(modeState && modeState.coop),
                        ia: !!(modeState && modeState.ia),
                        zen: !!(modeState && modeState.zen)
                });

                self.pauseInput();
                self.freezeBoard();
                self.clearAllTimers();
                self.resetBotPlanning();
                self.applyModeRules(modeState);

                setTimeout(function() {
                        self.unlockInput();
                }, 150);
        };

        /**
         * Aplica las reglas específicas de modo y sincroniza UI y estado.
         * @param {{coop:boolean, ia:boolean, zen:boolean}} modeState
         */
        this.applyModeRules = function(modeState)
        {
                var requestedCoop = !!(modeState && modeState.coop);
                var requestedIA = !!(modeState && modeState.ia);
                var requestedZen = !!(modeState && modeState.zen);
                var botIsReady = !!(window.bot && window.bot.enabled === true);

                console.info('[SWAP] Aplicando reglas de modo', {
                        coop: requestedCoop,
                        ia: requestedIA,
                        zen: requestedZen
                });

                // Fast fail: IA-ASSIST no puede coexistir con Co-op.
                if (requestedCoop && requestedIA) {
                        requestedIA = false;
                }

                // Resetear estado pendiente de IA cuando no se solicita
                self.iaPending = false;

                if (requestedIA && window.bot) {
                        // Habilitar el bot antes de cualquier transferencia
                        window.bot.enabled = true;
                        botIsReady = window.bot.enabled === true;
                }

                if (requestedIA && !botIsReady) {
                        self.iaPending = true;
                }

                var wasCoop = self.isCoopMode;
                self.isCoopMode = requestedCoop;
                self.isIAAssist = requestedIA && botIsReady;
                self.zenMode = requestedZen;
                self.areaX = 12;
                self.areaY = 22;

                var coopCheckbox = document.getElementById('tetris-coop-mode');
                if (coopCheckbox) {
                        coopCheckbox.checked = self.isCoopMode;
                }

                var zenCheckbox = document.getElementById('tetris-zen-mode');
                if (zenCheckbox) {
                        zenCheckbox.checked = self.zenMode;
                }

                var indicator = document.getElementById('mode-indicator');
                if (indicator) {
                        indicator.innerHTML = self.isCoopMode ? 'Modo Co-op Bot (12x22)' : 'Modo Clásico (12x22)';
                }

                var syncPanelToggle = function(id, isActive) {
                        var toggle = document.getElementById(id);
                        if (!toggle) { return; }
                        toggle.classList.toggle('active', !!isActive);
                };

                syncPanelToggle('coopToggle', self.isCoopMode);
                syncPanelToggle('iaAssistToggle', self.isIAAssist);
                syncPanelToggle('zenToggle', self.zenMode);

                var isGameRunning =
                        (self.humanPuzzle && self.humanPuzzle.isRunning && self.humanPuzzle.isRunning()) ||
                        (self.botPuzzle && self.botPuzzle.isRunning && self.botPuzzle.isRunning());

                if (!isGameRunning) {
                        if (self.area && wasCoop !== requestedCoop) {
                                self.reset();
                        }
                        self.updateResponsiveUnit();
                } else {
                        if (self.isCoopMode) {
                                if (self.botPuzzle) {
                                        self.botPuzzle.clearTimers();
                                }
                                if (self.humanPuzzle && typeof self.humanPuzzle.lockNow === 'function' && !self.humanPuzzle.locked) {
                                        self.humanPuzzle.lockNow();
                                }

                                if (!self.botPuzzle) {
                                        self.botPuzzle = new Puzzle(self, self.area, false);
                                }

                                if (self.humanPuzzle && self.botPuzzle) {
                                        var nextType = (typeof self.humanPuzzle.nextType === 'number') ? self.humanPuzzle.nextType : random(self.humanPuzzle.puzzles.length);
                                        self.botPuzzle.type = self.humanPuzzle.type;
                                        self.botPuzzle.nextType = nextType;

                                        if (self.humanPuzzle.history) {
                                                self.botPuzzle.history = self.humanPuzzle.history.slice();
                                        }
                                }

                                if (self.botPuzzle && !self.botPuzzle.isRunning()) {
                                        self.botPuzzle.place();
                                }

                                if (window.bot && typeof window.bot.clearGhostPreview === 'function') {
                                        window.bot.clearGhostPreview();
                                }
                        } else {
                                if (self.botPuzzle) {
                                        self.botPuzzle.destroy();
                                        self.botPuzzle = null;
                                }

                                if (window.bot && typeof window.bot.clearGhostPreview === 'function') {
                                        window.bot.clearGhostPreview();
                                }
                        }

                        if (window.bot) {
                                window.bot.bestBotMove = null;
                                window.bot.predictedBoard = null;
                                if (!self.isCoopMode && typeof window.bot.clearGhostPreview === 'function') {
                                        window.bot.clearGhostPreview();
                                }
                                if (typeof self.updateBotToggleLabel === 'function') {
                                        self.updateBotToggleLabel();
                                }
                        }

                        self.updateResponsiveUnit();
                }

                if (window.bot) {
                        window.bot.enabled = (self.isCoopMode || self.isIAAssist || self.iaPending);
                        if (typeof self.updateBotToggleLabel === 'function') {
                                self.updateBotToggleLabel();
                        }
                }

                if (self.isIAAssist) {
                        self.enableIAAssist();
                } else if (!self.iaPending) {
                        self.disableIAAssist();
                }

                if (self.iaPending && window.bot && window.bot.enabled === true) {
                        self.enableIAAssist();
                }

                self.applyOwnerRules();

                if (self.humanPuzzle && self.humanPuzzle.isRunning() && self.humanPuzzle.fallDownID) {
                        self.humanPuzzle.speed = self.zenMode ? 1000 : (80 + (700 / self.stats.getLevel()));
                        clearTimeout(self.humanPuzzle.fallDownID);
                        self.humanPuzzle.fallDownID = setTimeout(self.humanPuzzle.fallDown, self.humanPuzzle.speed);
                }

                self.updateModeStatus();
        };

        /**
         * IA-ASSIST activado: el bot toma control TOTAL de la partida
         */
        this.enableIAAssist = function()
        {
                if (!self.humanPuzzle || self.humanPuzzle.isStopped()) { return; }

                if (!window.bot || window.bot.enabled !== true) {
                        console.warn('[IA-ASSIST] Bloqueado: bot no habilitado.');
                        self.iaPending = true;
                        return;
                }

                self.iaPending = false;

                self.botPuzzle = self.humanPuzzle;
                self.humanPuzzle = null;
                console.log("[IA-ASSIST] Transfer complete.",
                   "botPuzzle exists=", !!self.botPuzzle,
                   "x=", self.botPuzzle.getX(),
                   "y=", self.botPuzzle.getY(),
                   "running=", self.botPuzzle.running);
                self.isIAAssist = true;
                self.botPuzzle.isHumanControlled = false;
                self.botPuzzle.stopped = false;
                if (typeof self.botPuzzle.suspendGravity === 'function') { self.botPuzzle.suspendGravity(); }
                // Desactivar gravedad temporalmente para que el bot anime la jugada sin interferencias
                if (self.botPuzzle.fallDownID) {
                        clearTimeout(self.botPuzzle.fallDownID);
                        self.botPuzzle.fallDownID = null;
                }
                // Log de transferencia de control al bot
                try {
                        // Silenciar logs en producción: no saturar la consola
                        var _ = (typeof self.botPuzzle.type !== 'undefined');
                } catch (e) {}

                if (window.bot) {
                        window.bot.enabled = true;
                        window.bot.currentPuzzle = self.botPuzzle;
                        window.bot.isThinking = false;

                        if (typeof window.bot.makeMove === 'function') {
                                console.log("[IA-ASSIST] Calling makeMove()...");
                                window.bot.makeMove();
                        }

                        // 🔥 NUEVO: ejecutar inmediatamente la jugada encontrada por el bot
                        setTimeout(function () {
                                console.log("[IA-ASSIST] Checking for bestBotMove AFTER makeMove:", window.bot.bestBotMove);

                                if (window.bot.bestBotMove) {
                                        console.log("[IA-ASSIST] Executing bot move immediately...");
                                        window.bot.executeStoredMove();
                                } else {
                                        console.warn("[IA-ASSIST] Bot has no best move to execute!");
                                }
                        }, 20);
                }

                if (self.botPuzzle && self.botPuzzle.isRunning()) {
                        self.botPuzzle.fallDown();
                }
        };

        /**
         * IA-ASSIST desactivado: control vuelve al jugador humano exactamente donde estaba
         */
        this.disableIAAssist = function()
        {
                if (!self.botPuzzle) { return; }

                self.iaPending = false;
                self.botPuzzle.isHumanControlled = true;
                self.humanPuzzle = self.botPuzzle;
                self.botPuzzle = null;
                self.isIAAssist = false;

                if (self.humanPuzzle && typeof self.humanPuzzle.resumeGravity === 'function') {
                        self.humanPuzzle.resumeGravity(true);
                }

                if (window.bot) {
                        if (!self.isCoopMode) {
                                window.bot.enabled = false;
                        }
                        window.bot.currentPuzzle = null;
                        if (typeof window.bot.clearGhostPreview === 'function') {
                                window.bot.clearGhostPreview();
                        }
                }
        };

        /**
         * Sincroniza el estado visible del botón de IA con el estado interno.
         * Prioriza el fast fail si el bot no está instanciado.
         */
        this.updateBotToggleLabel = function()
        {
                var botLabel = document.getElementById("tetris-menu-ai");
                if (!botLabel) { return; }

                if (!window.bot) { return; }

                var scope = self.isCoopMode ? "Co-op" : "Clásico";
                var status = window.bot.enabled ? "ON" : "OFF";
                botLabel.innerHTML = "IA " + scope + ": " + status;
        };

	/**
	 * @return void
	 * @access public event
	 */
        this.start = function()
        {
                if ((self.humanPuzzle || self.botPuzzle) && !confirm('Are you sure you want to start a new game ?')) return;
                self.updateResponsiveUnit();
                self.reset();

                // Establecer explícitamente el estado del bot al inicio para evitar toggles accidentales.
                if (window.bot) {
                        // Respetar el estado manual si la UI ya lo estableció (window.bot.enabled existente)
                        // Caso contrario, usar modo por defecto para coop.
                        if (typeof window.bot.enabled === 'undefined') {
                                window.bot.enabled = !!self.isCoopMode;
                        }
                        window.bot.isThinking = false;
                        window.bot.bestBotMove = null;
                        window.bot.predictedBoard = null;

                        if (typeof window.bot.clearGhostPreview === 'function') {
                                window.bot.clearGhostPreview();
                        }

                        self.updateBotToggleLabel();
                }

                self.stats.start();
                document.getElementById("tetris-nextpuzzle").style.display = "block";
                document.getElementById("tetris-keys").style.display = "none";
                self.area = new Area(self.unit, self.areaX, self.areaY, "tetris-area");
                self.humanPuzzle = new Puzzle(self, self.area, true);
                self.botPuzzle = self.isCoopMode ? new Puzzle(self, self.area, false) : null;
                if (self.humanPuzzle.mayPlace()) {
                        self.humanPuzzle.place();
                } else {
                        self.gameOver();
                }
        };

	/**
	 * @return void
	 * @access public event
	 */
        this.reset = function()
        {
                if (self.humanPuzzle) {
                        self.humanPuzzle.destroy();
                        self.humanPuzzle = null;
                }
                if (self.botPuzzle) {
                        self.botPuzzle.destroy();
                        self.botPuzzle = null;
                }
                if (self.area) {
                        self.area.destroy();
                        self.area = null;
                }
		document.getElementById("tetris-gameover").style.display = "none";
		document.getElementById("tetris-nextpuzzle").style.display = "none";
		document.getElementById("tetris-keys").style.display = "block";
		self.stats.reset();
		self.paused = false;
		document.getElementById('tetris-pause').style.display = 'block';
		document.getElementById('tetris-resume').style.display = 'none';
	};

	/**
	 * Pause / Resume.
	 * @return void
	 * @access public event
	 */
        this.pause = function()
        {
                if (self.humanPuzzle == null) return;
                if (self.paused) {
                        self.humanPuzzle.running = true;
                        self.humanPuzzle.fallDownID = setTimeout(self.humanPuzzle.fallDown, self.humanPuzzle.speed);
                        document.getElementById('tetris-pause').style.display = 'block';
                        document.getElementById('tetris-resume').style.display = 'none';
                        self.stats.timerId = setInterval(self.stats.incTime, 1000);
                        self.paused = false;
                } else {
                        if (!self.humanPuzzle.isRunning()) return;
                        if (self.humanPuzzle.fallDownID) clearTimeout(self.humanPuzzle.fallDownID);
                        document.getElementById('tetris-pause').style.display = 'none';
                        document.getElementById('tetris-resume').style.display = 'block';
                        clearTimeout(self.stats.timerId);
                        self.paused = true;
                        self.humanPuzzle.running = false;
                }
        };

	/**
	 * End game.
	 * Stop stats, ...
	 * @return void
	 * @access public event
	 */
        this.gameOver = function()
        {
                self.stats.stop();
                if (self.humanPuzzle) {
                        self.humanPuzzle.stop();
                }
                if (self.botPuzzle) {
                        self.botPuzzle.stop();
                }
                document.getElementById("tetris-nextpuzzle").style.display = "none";
                document.getElementById("tetris-gameover").style.display = "block";
                if (this.highscores.mayAdd(this.stats.getScore())) {
			var name = prompt("Game Over !\nEnter your name:", "");
			if (name && name.trim().length) {
				this.highscores.add(name, this.stats.getScore());
			}
		}
	};

	/**
	 * @return void
	 * @access public event
	 */
        this.up = function(targetPuzzle)
        {
                if (self.inputLocked) { return; }

                var actor = targetPuzzle || self.humanPuzzle;

                // Protección total: ignorar entradas cuando el bot está al mando
                if (!actor || !actor.isHumanControlled) { return; }

                // Fast-fail: sin actor activo no hay nada que rotar.
                if (!actor.isRunning() || actor.isStopped()) { return; }

                if (actor.mayRotate()) {
                        actor.rotate();

                        if (actor.isHumanControlled) {
                                self.stats.setActions(self.stats.getActions() + 1);
                                actor.notifyBotAfterHumanMove();
                        }
                }
        };

	/**
	 * @return void
	 * @access public event
	 */
        this.down = function(targetPuzzle)
        {
                if (self.inputLocked) { return; }

                var actor = targetPuzzle || self.humanPuzzle;

                // Nunca operar sobre botPuzzle controlado por IA
                if (!actor || !actor.isHumanControlled) { return; }

                if (!actor.isRunning() || actor.isStopped()) { return; }

                if (actor.mayMoveDown()) {
                        if (actor.isHumanControlled) {
                                self.stats.setScore(self.stats.getScore() + 5 + self.stats.getLevel());
                                self.stats.setActions(self.stats.getActions() + 1);
                        }

                        actor.moveDown();

                        if (actor.isHumanControlled) {
                                actor.notifyBotAfterHumanMove();
                        }
                }
        };

	/**
	 * @return void
	 * @access public event
	 */
        this.left = function(targetPuzzle)
        {
                if (self.inputLocked) { return; }

                var actor = targetPuzzle || self.humanPuzzle;

                // Nunca operar sobre botPuzzle controlado por IA
                if (!actor || !actor.isHumanControlled) { return; }

                if (!actor.isRunning() || actor.isStopped()) { return; }

                if (actor.mayMoveLeft()) {
                        actor.moveLeft();

                        if (actor.isHumanControlled) {
                                self.stats.setActions(self.stats.getActions() + 1);
                                actor.notifyBotAfterHumanMove();
                        }
                }
        };

	/**
	 * @return void
	 * @access public event
	 */
        this.right = function(targetPuzzle)
        {
                if (self.inputLocked) { return; }

                var actor = targetPuzzle || self.humanPuzzle;

                // Nunca operar sobre botPuzzle controlado por IA
                if (!actor || !actor.isHumanControlled) { return; }

                if (!actor.isRunning() || actor.isStopped()) { return; }

                if (actor.mayMoveRight()) {
                        actor.moveRight();

                        if (actor.isHumanControlled) {
                                self.stats.setActions(self.stats.getActions() + 1);
                                actor.notifyBotAfterHumanMove();
                        }
                }
        };

	/**
	 * @return void
	 * @access public event
	 */
        this.space = function(targetPuzzle)
        {
                if (self.inputLocked) { return; }

                var actor = targetPuzzle || self.humanPuzzle;

                // Nunca operar sobre botPuzzle controlado por IA
                if (!actor || !actor.isHumanControlled) { return; }

                if (!actor.isRunning() || actor.isStopped()) { return; }

                actor.stop();
                actor.forceMoveDown();

                if (actor.isHumanControlled) {
                        actor.notifyBotAfterHumanMove();
                }
        };

        /**
         * Callback de consolidación humana: asegura el orden secuencial y dispara la jugada del bot.
         * @return void
         * @access public
         */
        this.onHumanPieceLocked = function()
        {
                if (!self.humanPuzzle) { return; }

                self.humanPuzzle.reset();

                if (self.humanPuzzle.mayPlace()) {
                        self.humanPuzzle.place();
                } else {
                        self.gameOver();
                        return;
                }

                if (window.bot && typeof window.bot.executeStoredMove === "function") {
                        window.bot.executeStoredMove();
                }
        };

        // windows
        var helpwindow = new Window("tetris-help");
        var highscores = new Window("tetris-highscores");

	// game menu
	document.getElementById("tetris-menu-start").onclick = function() { helpwindow.close(); highscores.close(); self.start(); this.blur(); };

	// document.getElementById("tetris-menu-reset").onclick = function() { helpwindow.close(); highscores.close(); self.reset(); this.blur(); };

	document.getElementById("tetris-menu-pause").onclick = function() { self.pause(); this.blur(); };
	document.getElementById("tetris-menu-resume").onclick = function() { self.pause(); this.blur(); };

	// help
	document.getElementById("tetris-menu-help").onclick = function() { highscores.close(); helpwindow.activate(); this.blur(); };
	document.getElementById("tetris-help-close").onclick = helpwindow.close;

	// highscores
	document.getElementById("tetris-menu-highscores").onclick = function()
	{
		helpwindow.close();
		document.getElementById("tetris-highscores-content").innerHTML = self.highscores.toHtml();
		highscores.activate();
		this.blur();
	};
	document.getElementById("tetris-highscores-close").onclick = highscores.close;

	// keyboard - buttons
	//document.getElementById("tetris-keyboard-up").onclick = function() { self.up(); this.blur(); };
	//document.getElementById("tetris-keyboard-down").onclick = function() { self.down(); this.blur(); };
	//document.getElementById("tetris-keyboard-left").onclick = function () { self.left(); this.blur(); };
	//document.getElementById("tetris-keyboard-right").onclick = function() { self.right(); this.blur(); };

        // keyboard
        var keyboard = new Keyboard();
        keyboard.set(keyboard.n, this.start);
        //keyboard.set(keyboard.r, this.reset);
        keyboard.set(keyboard.p, this.pause);
        keyboard.set(keyboard.up, this.up);
        keyboard.set(keyboard.down, this.down);
        keyboard.set(keyboard.left, this.left);
        keyboard.set(keyboard.right, this.right);
        keyboard.set(keyboard.space, this.space);
        document.onkeydown = keyboard.event;

        // Modo Co-op: cuadro de selección alineado al selector ZEN.
        var coopCheckbox = document.getElementById("tetris-coop-mode");
        if (coopCheckbox) {
                coopCheckbox.onchange = function()
                {
                        self.setGameMode(this.checked);
                };
        }

        // Modo ZEN: controla la velocidad fija de caída
        var zenCheckbox = document.getElementById("tetris-zen-mode");
        if (zenCheckbox) {
                zenCheckbox.onchange = function()
                {
                        self.zenMode = this.checked;

                        // Aplicar la nueva velocidad inmediatamente si el juego está corriendo
                        if (self.humanPuzzle && self.humanPuzzle.isRunning() && self.humanPuzzle.fallDownID) {
                                self.humanPuzzle.speed = self.zenMode ? 1000 : (80 + (700 / self.stats.getLevel()));
                                clearTimeout(self.humanPuzzle.fallDownID);
                                self.humanPuzzle.fallDownID = setTimeout(self.humanPuzzle.fallDown, self.humanPuzzle.speed);
                        }
                };
        }

        /**
         * Window replaces game area, for example help window
         * @param string id
         */
        function Window(id)
	{
		this.id = id;
		this.el = document.getElementById(this.id);
		var self = this;

		/**
		 * Activate or deactivate a window - update html
		 * @return void
		 * @access event
		 */
		this.activate = function()
		{
			self.el.style.display = (self.el.style.display == "block" ? "none" : "block");
		};

		/**
		 * Close window - update html
		 * @return void
		 * @access event
		 */
		this.close = function()
		{
			self.el.style.display = "none";
		};

		/**
		 * @return bool
		 * @access public
		 */
		this.isActive = function()
		{
			return (self.el.style.display == "block");
		};
	}

	/**
	 * Assigning functions to keyboard events
	 * When key is pressed, searching in a table if any function has been assigned to this key, execute the function.
	 */
	function Keyboard()
	{
		this.up = 38;
		this.down = 40;
		this.left = 37;
		this.right = 39;
		this.n = 78;
		this.p = 80;
		this.r = 82;
		this.space = 32;
		this.f12 = 123;
		this.escape = 27;

		this.keys = [];
		this.funcs = [];

                var self = this;
                var UI_FOCUS_SELECTORS = ".control-panel, input, select, textarea, button, .switch, .toggle-btn";
                var ALLOWED_GAME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]); // Compatibilidad con navegadores modernos.
                var LEGACY_GAME_KEYS = new Set([self.left, self.right, self.up, self.down, self.space]);
                var KEY_NAME_TO_CODE = {
                        "ArrowUp": self.up,
                        "ArrowDown": self.down,
                        "ArrowLeft": self.left,
                        "ArrowRight": self.right,
                        " ": self.space
                };

                /**
                 * Detecta si el evento ocurre con la UI en foco. Fast-fail para evitar que
                 * el motor procese entradas cuando el jugador interactúa con botones u opciones.
                 */
                var isUIFocused = function(event) {
                        var targetMatch = event && event.target && typeof event.target.closest === "function"
                                ? event.target.closest(UI_FOCUS_SELECTORS)
                                : null;

                        if (targetMatch) {
                                return true;
                        }

                        var activeElement = document.activeElement;
                        return !!(activeElement && activeElement !== document.body && typeof activeElement.closest === "function" && activeElement.closest(UI_FOCUS_SELECTORS));
                };

		/**
		 * @param int key
		 * @param function func
		 * @return void
		 * @access public
		 */
		this.set = function(key, func)
		{
			this.keys.push(key);
			this.funcs.push(func);
		};

		/**
		 * @param object e
		 * @return void
		 * @access event
		 */
		this.event = function(e)
		{
			var event = e || window.event;

                        // Fast-fail: si un elemento interactivo tiene el foco, no procesar atajos de juego.
                        if (isUIFocused(event)) {
                                if (typeof event.stopImmediatePropagation === "function") {
                                        event.stopImmediatePropagation();
                                }
                                event.preventDefault();
                                return;
                        }

                        var keyName = event && typeof event.key === "string" ? event.key : "";
                        var keyCode = event && typeof event.keyCode === "number" ? event.keyCode : KEY_NAME_TO_CODE[keyName];

                        if ((ALLOWED_GAME_KEYS.has(keyName) || LEGACY_GAME_KEYS.has(keyCode)) && event) {
                                event.preventDefault();
                                if (typeof event.stopImmediatePropagation === "function") {
                                        event.stopImmediatePropagation();
				}
			}

			for (var i = 0; i < self.keys.length; i++) {
				if (keyCode == self.keys[i]) {
					self.funcs[i]();
					break;
				}
			}
		};
	}

	/**
	 * Live game statistics
	 * Updating html
	 */
	function Stats()
	{
		this.level;
		this.time;
		this.apm;
		this.lines;
		this.score;
		this.puzzles; // number of puzzles created on current level

		this.actions;

		this.el = {
			"level": document.getElementById("tetris-stats-level"),
			"time":  document.getElementById("tetris-stats-time"),
			"apm":  document.getElementById("tetris-stats-apm"),
			"lines": document.getElementById("tetris-stats-lines"),
			"score": document.getElementById("tetris-stats-score")
		}

		this.timerId = null;
		var self = this;

		/**
		 * Start counting statistics, reset stats, turn on the timer
		 * @return void
		 * @access public
		 */
		this.start = function()
		{
			this.reset();
			this.timerId = setInterval(this.incTime, 1000);
		};

		/**
		 * Stop counting statistics, turn off the timer
		 * @return void
		 * @access public
		 */
		this.stop = function()
		{
			if (this.timerId) {
				clearInterval(this.timerId);
			}
		};

		/**
		 * Reset statistics - update html
		 * @return void
		 * @access public
		 */
		this.reset = function()
		{
			this.stop();
			this.level = 1;
			this.time  = 0;
			this.apm   = 0;
			this.lines = 0;
			this.score = 0;
			this.puzzles = 0;
			this.actions = 0;
			this.el.level.innerHTML = this.level;
			this.el.time.innerHTML = this.time;
			this.el.apm.innerHTML = this.apm;
			this.el.lines.innerHTML = this.lines;
			this.el.score.innerHTML = this.score;
		};

		/**
		 * Increase time, update apm - update html
		 * This func is called by setInterval()
		 * @return void
		 * @access public event
		 */
		this.incTime = function()
		{
			self.time++;
			self.el.time.innerHTML = self.time;
			self.apm = parseInt((self.actions / self.time) * 60);
			self.el.apm.innerHTML = self.apm;
		};

		/**
		 * Set score - update html
		 * @param int i
		 * @return void
		 * @access public
		 */
		this.setScore = function(i)
		{
			this.score = i;
			this.el.score.innerHTML = this.score;
		};

		/**
		 * Set level - update html
		 * @param int i
		 * @return void
		 * @access public
		 */
		this.setLevel = function(i)
		{
			this.level = i;
			this.el.level.innerHTML = this.level;
		};

		/**
		 * Set lines - update html
		 * @param int i
		 * @return void
		 * @access public
		 */
		this.setLines = function(i)
		{
			this.lines = i;
			this.el.lines.innerHTML = this.lines;
		};

		/**
		 * Number of puzzles created on current level
		 * @param int i
		 * @return void
		 * @access public
		 */
		this.setPuzzles = function(i)
		{
			this.puzzles = i;
		};

		/**
		 * @param int i
		 * @return void
		 * @access public
		 */
		this.setActions = function(i)
		{
			this.actions = i;
		};

		/**
		 * @return int
		 * @access public
		 */
		this.getScore = function()
		{
			return this.score;
		};

		/**
		 * @return int
		 * @access public
		 */
		this.getLevel = function()
		{
			return this.level;
		};

		/**
		 * @return int
		 * @access public
		 */
		this.getLines = function()
		{
			return this.lines;
		};

		/**
		 * Number of puzzles created on current level
		 * @return int
		 * @access public
		 */
		this.getPuzzles = function()
		{
			return this.puzzles;
		};

		/**
		 * @return int
		 * @access public
		 */
		this.getActions = function()
		{
			return this.actions;
		};
	}

	/**
	 * Area consists of blocks (2 dimensional board).
	 * Block contains "0" (if empty) or Html Object.
	 * @param int x
	 * @param int y
	 * @param string id
	 */
	function Area(unit, x, y, id)
	{
		this.unit = unit;
		this.x = x;
		this.y = y;
		this.el = document.getElementById(id);

		this.board = [];

		// create 2-dimensional board
		for (var y = 0; y < this.y; y++) {
			this.board.push(new Array());
			for (var x = 0; x < this.x; x++) {
				this.board[y].push(0);
			}
		}

		/**
		 * Removing html elements from area.
		 * @return void
		 * @access public
		 */
		this.destroy = function()
		{
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						this.el.removeChild(this.board[y][x]);
						this.board[y][x] = 0;
					}
				}
			}
		};

		/**
		 * Searching for full lines.
		 * Must go from the bottom of area to the top.
		 * Returns the number of lines removed - needed for Stats.score.
		 * @see isLineFull() removeLine()
		 * @return void
		 * @access public
		 */
		this.removeFullLines = function()
		{
			var lines = 0;
			for (var y = this.y - 1; y > 0; y--) {
				if (this.isLineFull(y)) {
					this.removeLine(y);
					lines++;
					y++;
				}
			}
			return lines;
		};

		/**
		 * @param int y
		 * @return bool
		 * @access public
		 */
		this.isLineFull = function(y)
		{
			for (var x = 0; x < this.x; x++) {
				if (!this.board[y][x]) { return false; }
			}
			return true;
		};

		/**
		 * Remove given line
		 * Remove html objects
		 * All lines that are above given line move down by 1 unit
		 * @param int y
		 * @return void
		 * @access public
		 */
		this.removeLine = function(y)
		{
			for (var x = 0; x < this.x; x++) {
				this.el.removeChild(this.board[y][x]);
				this.board[y][x] = 0;
			}
			y--;
			for (; y > 0; y--) {
				for (var x = 0; x < this.x; x++) {
					if (this.board[y][x]) {
						var el = this.board[y][x];
						el.style.top = el.offsetTop + this.unit + "px";
						this.board[y+1][x] = el;
						this.board[y][x] = 0;
					}
				}
			}
		};

		/**
		 * @param int y
		 * @param int x
		 * @return mixed 0 or Html Object
		 * @access public
		 */
		this.getBlock = function(y, x)
		{
			if (y < 0) { return 0; }
			if (y < this.y && x < this.x) {
				return this.board[y][x];
			} else {
				throw "Area.getBlock("+y+", "+x+") failed";
			}
		};

		/**
		 * Add Html Element to the area.
		 * Find (x,y) position using offsetTop and offsetLeft
		 * @param object el
		 * @return void
		 * @access public
		 */
		this.addElement = function(el)
		{
			var x = parseInt(el.offsetLeft / this.unit);
			var y = parseInt(el.offsetTop / this.unit);
			if (y >= 0 && y < this.y && x >= 0 && x < this.x) {
				this.board[y][x] = el;
			} else {
				// not always an error ..
			}
		};
	}

	/**
	 * Puzzle consists of blocks.
	 * Each puzzle after rotating 4 times, returns to its primitive position.
	 */
        function Puzzle(tetris, area, isHumanControlled)
        {
                var self = this;
                this.tetris = tetris;
                this.area = area;
                this.isHumanControlled = !!isHumanControlled; // true si la pieza es controlada por el jugador humano

                // timeout ids
                this.fallDownID = null;
                this.forceMoveDownID = null;
                this.forceMoveDownDelay = 30;

                // Bandera de consolidación inmediata para evitar piezas flotantes al cambiar de modo.
                this.locked = false;

                // Suspensión de gravedad para piezas bajo control del bot.
                this.gravitySuspended = !this.isHumanControlled;

                // Indicador para habilitar la planificación del bot solo cuando el humano haya actuado.
                this.botReadyTriggered = false;

                this.type = null; // 0..6
                this.nextType = null; // next puzzle
                this.position = null; // 0..3
		this.speed = null;
		this.running = null;
		this.stopped = null;

		this.board = []; // filled with html elements after placing on area
		this.elements = [];
		this.nextElements = []; // next board elements

		// (x,y) position of the puzzle (top-left)
		this.x = null;
		this.y = null;

		// width & height must be the same
		this.puzzles = [
			[
				[0,0,1],
				[1,1,1],
				[0,0,0]
			],
			[
				[1,0,0],
				[1,1,1],
				[0,0,0]
			],
			[
				[0,1,1],
				[1,1,0],
				[0,0,0]
			],
			[
				[1,1,0],
				[0,1,1],
				[0,0,0]
			],
			[
				[0,1,0],
				[1,1,1],
				[0,0,0]
			],
			[
				[1,1],
				[1,1]
			],
			[
				[0,0,0,0],
				[1,1,1,1],
				[0,0,0,0],
				[0,0,0,0]
			]
                ];

                /**
                 * Limpia todos los temporizadores asociados a la pieza actual.
                 * @return void
                 * @access private
                 */
                this.clearTimers = function()
                {
                        if (this.fallDownID) { clearTimeout(this.fallDownID); this.fallDownID = null; }
                        if (this.forceMoveDownID) { clearTimeout(this.forceMoveDownID); this.forceMoveDownID = null; }
                };

                /**
                 * Pausa la gravedad de la pieza y limpia cualquier timer activo.
                 * @return void
                 * @access public
                 */
                this.suspendGravity = function()
                {
                        this.gravitySuspended = true;
                        if (this.fallDownID) { clearTimeout(this.fallDownID); this.fallDownID = null; }
                };

                /**
                 * Reanuda la gravedad cuando la pieza vuelve a control humano.
                 * @param bool restartTimer
                 * @return void
                 * @access public
                 */
                this.resumeGravity = function(restartTimer)
                {
                        this.gravitySuspended = false;

                        if (restartTimer && this.isRunning() && !this.isStopped()) {
                                if (this.fallDownID) { clearTimeout(this.fallDownID); }
                                this.fallDownID = setTimeout(this.fallDown, this.speed);
                        }
                };

                /**
                 * Elimina la representación visual actual (pieza activa) del DOM.
                 * @return void
                 * @access private
                 */
                this.clearElements = function()
                {
                        for (var i = 0; i < this.elements.length; i++) {
                                if (this.elements[i] && this.elements[i].parentNode === this.area.el) {
                                        this.area.el.removeChild(this.elements[i]);
                                }
                        }
                        this.elements = [];
                        this.board = [];
                };

                /**
                 * Limpia la previsualización de la siguiente pieza (solo humano).
                 * @return void
                 * @access private
                 */
                this.clearNextPreview = function()
                {
                        if (!this.isHumanControlled) { return; }

                        for (var i = 0; i < this.nextElements.length; i++) {
                                if (this.nextElements[i].parentNode) {
                                        this.nextElements[i].parentNode.removeChild(this.nextElements[i]);
                                }
                        }
                        this.nextElements = [];
                };

                /**
                 * Reset puzzle. It does not destroy html elements in this.board.
                 * @return void
                 * @access public
                 */
                this.reset = function(syncTypes)
                {
                        this.clearTimers();
                        this.locked = false;
                        this.gravitySuspended = !this.isHumanControlled;
                        this.forceMoveDownDelay = 30;

                        var humanNextType = (this.tetris && this.tetris.humanPuzzle) ? this.tetris.humanPuzzle.nextType : null;
                        // Permite forzar la semilla de la pieza para sincronizar con el bot.
                        if (syncTypes && typeof syncTypes.current === 'number') {
                                this.type = syncTypes.current;
                                this.nextType = (typeof syncTypes.next === 'number') ? syncTypes.next : random(this.puzzles.length);
                        } else if (!this.isHumanControlled && typeof humanNextType === 'number') {
                                // El bot debe respetar la pieza ya generada por el humano para mantener la sincronización.
                                this.type = (typeof this.nextType === 'number') ? this.nextType : humanNextType;
                                this.nextType = humanNextType;
                        } else {
                                this.type = this.nextType;
                                this.nextType = random(this.puzzles.length);
                        }
                        this.position = 0;
                        if (this.tetris.zenMode) {
                                this.speed = 1000;
                        } else {
                                this.speed = 80 + (700 / this.tetris.stats.getLevel());
                        }
                        this.running = false;
                        this.stopped = false;
                        this.board = [];
                        this.elements = [];
                        this.clearNextPreview();
                        this.x = null;
                        this.y = null;
                        this.botReadyTriggered = false;
                };

		this.nextType = random(this.puzzles.length);
		this.reset();

		/**
		 * Check whether puzzle is running.
		 * @return bool
		 * @access public
		 */
		this.isRunning = function()
		{
			return this.running;
		};

		/**
		 * Check whether puzzle has been stopped by user. It happens when user clicks
		 * "down" when puzzle is already at the bottom of area. The puzzle may still
		 * be running with event fallDown(). When puzzle is stopped, no actions will be
		 * performed when user press a key.
		 * @return bool
		 * @access public
		 */
		this.isStopped = function()
		{
			return this.stopped;
		};

		/**
		 * Get X position of puzzle (top-left)
		 * @return int
		 * @access public
		 */
		this.getX = function()
		{
			return this.x;
		};

		/**
		 * Get Y position of puzzle (top-left)
		 * @return int
		 * @access public
		 */
		this.getY = function()
		{
			return this.y;
		};

		/**
		 * Check whether new puzzle may be placed on the area.
		 * Find (x,y) in area where beginning of the puzzle will be placed.
		 * Check if first puzzle line (checking from the bottom) can be placed on the area.
		 * @return bool
		 * @access public
		 */
		this.mayPlace = function()
		{
			var puzzle = this.puzzles[this.type];
			var areaStartX = parseInt((this.area.x - puzzle[0].length) / 2);
			var areaStartY = 1;
			var lineFound = false;
			var lines = 0;
			for (var y = puzzle.length - 1; y >= 0; y--) {
				for (var x = 0; x < puzzle[y].length; x++) {
					if (puzzle[y][x]) {
						lineFound = true;
						if (this.area.getBlock(areaStartY, areaStartX + x)) { return false; }
					}
				}
				if (lineFound) {
					lines++;
				}
				if (areaStartY - lines < 0) {
					break;
				}
			}
			return true;
		};

		/**
		 * Create empty board, create blocks in area - html objects, update puzzle board.
		 * Check puzzles on current level, increase level if needed.
		 * @return void
		 * @access public
		 */
		this.place = function()
		{
                        // stats (solo humano para evitar contaminar el puntaje con el bot)
                        if (this.isHumanControlled) {
                                this.tetris.stats.setPuzzles(this.tetris.stats.getPuzzles() + 1);
                                if (this.tetris.stats.getPuzzles() >= (10 + this.tetris.stats.getLevel() * 2)) {
                                        this.tetris.stats.setLevel(this.tetris.stats.getLevel() + 1);
                                        this.tetris.stats.setPuzzles(0);
                                }
                        }
			// init
			var puzzle = this.puzzles[this.type];
			var areaStartX = parseInt((this.area.x - puzzle[0].length) / 2);
			var areaStartY = 1;
			var lineFound = false;
			var lines = 0;
                        this.x = areaStartX;
                        this.y = 1;
                        this.board = this.createEmptyPuzzle(puzzle.length, puzzle[0].length);
                        this.locked = false;
			// create puzzle
			for (var y = puzzle.length - 1; y >= 0; y--) {
				for (var x = 0; x < puzzle[y].length; x++) {
					if (puzzle[y][x]) {
						lineFound = true;
						var el = document.createElement("div");
						el.className = "block" + this.type;
						el.style.left = (areaStartX + x) * this.area.unit + "px";
						el.style.top = (areaStartY - lines) * this.area.unit + "px";
						this.area.el.appendChild(el);
						this.board[y][x] = el;
						this.elements.push(el);
					}
				}
				if (lines) {
					this.y--;
				}
				if (lineFound) {
					lines++;
				}
                        }
                        this.running = true;
                        // En modo cooperativo, la pieza del bot debe permanecer inerte hasta que se ejecute su jugada forzada.
                        var shouldAutoFall = !this.gravitySuspended && (this.isHumanControlled || !this.tetris.isCoopMode);
                        this.fallDownID = shouldAutoFall ? setTimeout(this.fallDown, this.speed) : null;
                        // Sincronizar creación de la siguiente pieza del bot y forzar su spawn inicial.
                        if (this.isHumanControlled && this.tetris.botPuzzle && !this.tetris.botPuzzle.isRunning()) {
                                var syncSeed = { current: this.type, next: this.nextType };
                                this.tetris.botPuzzle.reset(syncSeed);

                                if (this.tetris.botPuzzle.mayPlace()) {
                                        this.tetris.botPuzzle.place();
                                }
                        }

                        // next puzzle (solo humano para mantener la UI limpia)
                        if (this.isHumanControlled) {
                                this.clearNextPreview();

                                var nextPuzzle = this.puzzles[this.nextType];
                                for (var y = 0; y < nextPuzzle.length; y++) {
                                        for (var x = 0; x < nextPuzzle[y].length; x++) {
                                                if (nextPuzzle[y][x]) {
                                                        var el = document.createElement("div");
                                                        el.className = "block" + this.nextType;
                                                        el.style.left = (x * this.area.unit) + "px";
                                                        el.style.top = (y * this.area.unit) + "px";
                                                        document.getElementById("tetris-nextpuzzle").appendChild(el);
                                                        this.nextElements.push(el);
                                                }
                                        }
                                }
                        }

                        this.tetris.updateControlStyles(this);

                        // Activar el bot para la nueva pieza cuando corresponda
                        if (this.tetris && this.tetris.isIAAssist && window.bot && window.bot.enabled) {
                                var botActor = this.tetris.botPuzzle || this;

                                if (typeof botActor.suspendGravity === "function") {
                                        botActor.suspendGravity();
                                }

                                window.bot.currentPuzzle = botActor;
                                window.bot.isThinking = false;
                                window.bot.bestBotMove = null;
                                window.bot.predictedBoard = null;
                                window.bot.makeMove();
                        }
                };

                /**
                 * Dispara la planificación del bot solo después de que el humano haya realizado una acción.
                 * @return void
                 * @access public
                 */
                this.notifyBotAfterHumanMove = function()
                {
                        // Fast-fail: salir rápidamente si no aplica la notificación
                        if (!this.isHumanControlled) { return; }
                        if (!window.bot || !window.bot.enabled) { return; }
                        if (this.isStopped()) { return; }

                        // Obligar a recalcular la jugada en cada ajuste del jugador.
                        window.bot.bestBotMove = null;
                        window.bot.predictedBoard = null;
                        if (typeof window.bot.clearGhostPreview === 'function') {
                                window.bot.clearGhostPreview();
                        }

                        setTimeout(function() {
                                window.bot.isThinking = false;
                                window.bot.makeMove();
                        }, 100);
                };

                /**
                 * Consolida inmediatamente la pieza actual para evitar flotaciones al cambiar de modo.
                 * @return void
                 * @access public
                 */
                this.lockNow = function()
                {
                        if (!self.isRunning()) { return; }

                        self.clearTimers();
                        while (self.mayMoveDown()) {
                                self.moveDown();
                        }
                        self.locked = true;
                        self.fallDown();
                };

		/**
		 * Remove puzzle from the area.
		 * Clean some other stuff, see reset()
                 * @return void
                 * @access public
                 */
                this.destroy = function()
                {
                        this.clearTimers();
                        this.clearNextPreview();
                        this.clearElements();
                        this.running = false;
                        this.stopped = true;
                        this.locked = false;
                        this.type = null;
                        this.nextType = null;
                        this.position = 0;
                };

		/**
		 * @param int y
		 * @param int x
		 * @return array
		 * @access private
		 */
		this.createEmptyPuzzle = function(y, x)
		{
			var puzzle = [];
			for (var y2 = 0; y2 < y; y2++) {
				puzzle.push(new Array());
				for (var x2 = 0; x2 < x; x2++) {
					puzzle[y2].push(0);
				}
			}
			return puzzle;
		};

		/**
		 * Puzzle fall from the top to the bottom.
		 * After placing a puzzle, this event will be called as long as the puzzle is running.
		 * @see place() stop()
		 * @return void
		 * @access event
		 */
                this.fallDown = function()
                {
                        if (self.gravitySuspended) { return; }
                        if (!self.isHumanControlled && self.tetris.isCoopMode && !self.tetris.isIAAssist) { return; }

                        if (self.isRunning()) {
                                if (self.mayMoveDown()) {
                                        self.moveDown();
                                        self.fallDownID = setTimeout(self.fallDown, self.speed);
                                } else {
                                        // move blocks into area board
                                        self.locked = true;
                                        for (var i = 0; i < self.elements.length; i++) {
                                                self.area.addElement(self.elements[i]);
                                        }
                                        // stats
                                        var lines = self.area.removeFullLines();
                                        if (lines && self.isHumanControlled) {
                                                self.tetris.stats.setLines(self.tetris.stats.getLines() + lines);
                                                self.tetris.stats.setScore(self.tetris.stats.getScore() + (1000 * self.tetris.stats.getLevel() * lines));
                                        }
                                        // reset puzzle (humano) mediante callback o flujo original (bot)
                                        if (self.isHumanControlled) {
                                                if (self.tetris && typeof self.tetris.onHumanPieceLocked === 'function') {
                                                        self.tetris.onHumanPieceLocked();
                                                } else {
                                                        self.reset();
                                                        if (self.mayPlace()) {
                                                                self.place();
                                                        } else {
                                                                // Fast fail: cualquier imposibilidad de colocar termina la partida.
                                                                self.tetris.gameOver();
                                                        }
                                                }
                                        } else {
                                                self.reset();
                                                if (self.mayPlace()) {
                                                        self.place();
                                                } else {
                                                        // El bot comparte la derrota con el humano.
                                                        self.tetris.gameOver();
                                                }
                                        }
                                }
                        }
                };

		/**
		 * After clicking "space" the puzzle is forced to move down, no user action is performed after
		 * this event is called. this.running must be set to false. This func is similiar to fallDown()
		 * Also update score & actions - like Tetris.down()
		 * @see fallDown()
		 * @return void
		 * @access public event
		 */
		this.forceMoveDown = function()
		{
			if (!self.isRunning() && !self.isStopped()) {
                                if (self.mayMoveDown()) {
                                        // stats: score, actions
                                        self.tetris.stats.setScore(self.tetris.stats.getScore() + 5 + self.tetris.stats.getLevel());
                                        self.tetris.stats.setActions(self.tetris.stats.getActions() + 1);
                                        self.moveDown();
                                        var dropDelay = (typeof self.forceMoveDownDelay === 'number') ? self.forceMoveDownDelay : 30;
                                        self.forceMoveDownID = setTimeout(self.forceMoveDown, dropDelay);
                                } else {
                                        // move blocks into area board
                                        self.locked = true;
                                        for (var i = 0; i < self.elements.length; i++) {
                                                self.area.addElement(self.elements[i]);
                                        }
					// stats: lines
					var lines = self.area.removeFullLines();
					if (lines) {
						self.tetris.stats.setLines(self.tetris.stats.getLines() + lines);
						self.tetris.stats.setScore(self.tetris.stats.getScore() + (1000 * self.tetris.stats.getLevel() * lines));
					}
                                        // reset puzzle
                                        if (self.isHumanControlled) {
                                                if (self.tetris && typeof self.tetris.onHumanPieceLocked === 'function') {
                                                        self.tetris.onHumanPieceLocked();
                                                } else {
                                                        self.reset();
                                                        if (self.mayPlace()) {
                                                                self.place();
                                                        } else {
                                                                self.tetris.gameOver();
                                                        }
                                                }
                                        } else {
                                                self.reset();
                                                if (self.mayPlace()) {
                                                        self.place();
                                                } else {
                                                        self.tetris.gameOver();
                                                }
                                        }
                                }
                        }
                };

		/**
		 * Stop the puzzle falling
		 * @return void
		 * @access public
		 */
		this.stop = function()
		{
			this.running = false;
		};

		/**
		 * Check whether puzzle may be rotated.
		 * Check down, left, right, rotate
		 * @return bool
		 * @access public
		 */
		this.mayRotate = function()
		{
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						var newY = this.getY() + this.board.length - 1 - x;
						var newX = this.getX() + y;
						if (newY >= this.area.y) { return false; }
						if (newX < 0) { return false; }
						if (newX >= this.area.x) { return false; }
						if (this.area.getBlock(newY, newX)) { return false; }
					}
				}
			}
			return true;
		};

		/**
		 * Rotate the puzzle to the left.
		 * @return void
		 * @access public
		 */
		this.rotate = function()
		{
			var puzzle = this.createEmptyPuzzle(this.board.length, this.board[0].length);
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						var newY = puzzle.length - 1 - x;
						var newX = y;
						var el = this.board[y][x];
						var moveY = newY - y;
						var moveX = newX - x;
						el.style.left = el.offsetLeft + (moveX * this.area.unit) + "px";
						el.style.top = el.offsetTop + (moveY * this.area.unit) + "px";
						puzzle[newY][newX] = el;
					}
				}
			}
			this.board = puzzle;
		};

		/**
		 * Check whether puzzle may be moved down.
		 * - is any other puzzle on the way ?
		 * - is it end of the area ?
		 * If false, then true is assigned to variable this.stopped - no user actions will be performed to this puzzle,
		 * so this func should be used carefully, only in Tetris.down() and Tetris.puzzle.fallDown()
		 * @return bool
		 * @access public
		 */
		this.mayMoveDown = function()
		{
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						if (this.getY() + y + 1 >= this.area.y) { this.stopped = true; return false; }
						if (this.area.getBlock(this.getY() + y + 1, this.getX() + x)) { this.stopped = true; return false; }
					}
				}
			}
			return true;
		};

		/**
		 * Move the puzzle down by 1 unit.
		 * @return void
		 * @access public
		 */
		this.moveDown = function()
		{
			for (var i = 0; i < this.elements.length; i++) {
				this.elements[i].style.top = this.elements[i].offsetTop + this.area.unit + "px";
			}
			this.y++;
		};

		/**
		 * Check whether puzzle may be moved left.
		 * - is any other puzzle on the way ?
		 * - is the end of the area
		 * @return bool
		 * @access public
		 */
		this.mayMoveLeft = function()
		{
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						if (this.getX() + x - 1 < 0) { return false; }
						if (this.area.getBlock(this.getY() + y, this.getX() + x - 1)) { return false; }
					}
				}
			}
			return true;
		};

		/**
		 * Move the puzzle left by 1 unit
		 * @return void
		 * @access public
		 */
		this.moveLeft = function()
		{
			for (var i = 0; i < this.elements.length; i++) {
				this.elements[i].style.left = this.elements[i].offsetLeft - this.area.unit + "px";
			}
			this.x--;
		};

		/**
		 * Check whether puzle may be moved right.
		 * - is any other puzzle on the way ?
		 * - is the end of the area
		 * @return bool
		 * @access public
		 */
		this.mayMoveRight = function()
		{
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						if (this.getX() + x + 1 >= this.area.x) { return false; }
						if (this.area.getBlock(this.getY() + y, this.getX() + x + 1)) { return false; }
					}
				}
			}
			return true;
		};

		/**
		 * Move the puzzle right by 1 unit.
		 * @return void
		 * @access public
		 */
		this.moveRight = function()
		{
			for (var i = 0; i < this.elements.length; i++) {
				this.elements[i].style.left = this.elements[i].offsetLeft + this.area.unit + "px";
			}
			this.x++;
		};
	}

	/**
	 * Generates random number that is >= 0 and < i
	 * @return int
	 * @access private
	 */
	function random(i)
	{
		return Math.floor(Math.random() * i);
	}

	/**
	 * Store highscores in cookie.
	 */
	function Highscores(maxscores)
	{
		this.maxscores = maxscores;
		this.scores = [];

		/**
		 * Load scores from cookie.
		 * Note: it is automatically called when creating new instance of object Highscores.
		 * @return void
		 * @access public
		 */
		this.load = function()
		{
			var cookie = new Cookie();
			var s = cookie.get("tetris-highscores");
			this.scores = [];
			if (s.length) {
				var scores = s.split("|");
				for (var i = 0; i < scores.length; ++i) {
					var a = scores[i].split(":");
					this.scores.push(new Score(a[0], Number(a[1])));
				}
			}
		};

		/**
		 * Save scores to cookie.
		 * Note: it is automatically called after adding new score.
		 * @return void
		 * @access public
		 */
		this.save = function()
		{
			var cookie = new Cookie();
			var a = [];
			for (var i = 0; i < this.scores.length; ++i) {
				a.push(this.scores[i].name+":"+this.scores[i].score);
			}
			var s = a.join("|");
			cookie.set("tetris-highscores", s, 3600*24*1000);
		};

		/**
		 * Is the score high enough to be able to add ?
		 * @return bool
		 * @access public
		 */
		this.mayAdd = function(score)
		{
			if (this.scores.length < this.maxscores) { return true; }
			for (var i = this.scores.length - 1; i >= 0; --i) {
				if (this.scores[i].score < score) { return true; }
			}
			return false;
		};

		/**
		 * @param string name
		 * @param int score
		 * @return void
		 * @access public
		 */
		this.add = function(name, score)
		{
			name = name.replace(/[;=:|]/g, "?");
			name = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
			if (this.scores.length < this.maxscores) {
				this.scores.push(new Score(name, score));
			} else {
				for (var i = this.scores.length - 1; i >= 0; --i) {
					if (this.scores[i].score < score) {
						this.scores.removeByIndex(i);
						this.scores.push(new Score(name, score));
						break;
					}
				}
			}
			this.sort();
			this.save();
		};

		/**
		 * Get array of scores.
		 * @return array [Score, Score, ..]
		 * @access public
		 */
		this.getScores = function()
		{
			return this.scores;
		};

		/**
		 * All highscores returned in html friendly format.
		 * @return string
		 * @access public
		 */
		this.toHtml = function()
		{
			var s = '<table cellspacing="0" cellpadding="2"><tr><th></th><th>Name</th><th>Score</th></tr>';
			for (var i = 0; i < this.scores.length; ++i) {
				s += '<tr><td>?.</td><td>?</td><td>?</td></tr>'.format(i+1, this.scores[i].name, this.scores[i].score);
			}
			s += '</table>';
			return s;
		};

		/**
		 * Sort table with scores.
		 * @return void
		 * @access private
		 */
		this.sort = function()
		{
			var scores = this.scores;
			var len = scores.length;
			this.scores = [];
			for (var i = 0; i < len; ++i) {
				var el = null, index = null;
				for (var j = 0; j < scores.length; ++j) {
					if (!el || (scores[j].score > el.score)) {
						el = scores[j];
						index = j;
					}
				}
				scores.removeByIndex(index);
				this.scores.push(el);
			}
		};

		/* Simple score object. */
		function Score(name, score)
		{
			this.name = name;
			this.score = score;
		}

		this.load();
	}

	/**
	 * Managing cookies.
	 */
	function Cookie()
	{
		/**
		 * @param string name
		 * @return string
		 * @access public
		 */
		this.get = function(name)
		{
			var cookies = document.cookie.split(";");
			for (var i = 0; i < cookies.length; ++i) {
				var a = cookies[i].split("=");
				if (a.length == 2) {
					a[0] = a[0].trim();
					a[1] = a[1].trim();
					if (a[0] == name) {
						return unescape(a[1]);
					}
				}
			}
			return "";
		};

		/**
		 * @param string name
		 * @param string value (do not use special chars like ";" "=")
		 * @param int seconds
		 * @param string path
		 * @param string domain
		 * @param bool secure
		 * @return void
		 * @access public
		 */
		this.set = function(name, value, seconds, path, domain, secure)
		{
			this.del(name);
			if (!path) path = '/';

			var cookie = (name + "=" + escape(value));
			if (seconds) {
				var date = new Date(new Date().getTime()+seconds*1000);
				cookie += ("; expires="+date.toGMTString());
			}
			cookie += (path    ? "; path="+path : "");
			cookie += (domain  ? "; domain="+domain : "");
			cookie += (secure  ? "; secure" : "");
			document.cookie = cookie;
		};

		/**
		 * @param name
		 * @return void
		 * @access public
		 */
		this.del = function(name)
		{
			document.cookie = name + "=; expires=Thu, 01-Jan-70 00:00:01 GMT";
		};
	}
}

if (!String.prototype.trim) {
	String.prototype.trim = function() {
		return this.replace(/^\s*|\s*$/g, "");
	};
}

if (!Array.prototype.removeByIndex) {
	Array.prototype.removeByIndex = function(index) {
		this.splice(index, 1);
	};
}

if (!String.prototype.format) {
	String.prototype.format = function() {
		if (!arguments.length) { throw "String.format() failed, no arguments passed, this = "+this; }
		var tokens = this.split("?");
		if (arguments.length != (tokens.length - 1)) { throw "String.format() failed, tokens != arguments, this = "+this; }
		var s = tokens[0];
		for (var i = 0; i < arguments.length; ++i) {
			s += (arguments[i] + tokens[i + 1]);
		}
		return s;
	};
}

/**
* Agente Inteligente para Tetris
* Implementa búsqueda heurística con pesos ponderados.
*/
function TetrisBot(tetrisInstance) {
        this.tetris = tetrisInstance;
        this.enabled = false;
        this.isThinking = false;
        this.predictedBoard = null; // Tablero proyectado (dual-state)
        this.bestBotMove = null; // Movimiento óptimo pendiente de ejecutar
        this.ghostElements = []; // Previsualización de la jugada del bot

        // --- MODOS DE JUEGO (FAST-FAIL EN VALIDACIONES) ---
        const GamePlayMode = {
                SURVIVAL: 1,
                TETRIS_BUILDER: 2,
                PRO_ATTACK: 3,
                ZEN: 4,
                BALANCED: 5
        };

        var GAMEPLAY_MODE_NAMES = {};
        GAMEPLAY_MODE_NAMES[GamePlayMode.SURVIVAL] = "SURVIVAL";
        GAMEPLAY_MODE_NAMES[GamePlayMode.TETRIS_BUILDER] = "TETRIS_BUILDER";
        GAMEPLAY_MODE_NAMES[GamePlayMode.PRO_ATTACK] = "PRO_ATTACK";
        GAMEPLAY_MODE_NAMES[GamePlayMode.ZEN] = "ZEN";
        GAMEPLAY_MODE_NAMES[GamePlayMode.BALANCED] = "BALANCED";

        this.GamePlayMode = GamePlayMode;
        this.gameplayMode = GamePlayMode.ZEN;

        // Perfiles de pesos por modo (mantener BALANCED igual al comportamiento actual)
        this.modeProfiles = {};
        this.modeProfiles[GamePlayMode.SURVIVAL] = { holes: 1.35, roughness: 1.0, chimney: 0.8, maxHeight: 1.4, aggHeight: 1.2 };
        this.modeProfiles[GamePlayMode.TETRIS_BUILDER] = { holes: 0.95, roughness: 1.1, chimney: 1.3, maxHeight: 0.95, aggHeight: 1.0 };
        this.modeProfiles[GamePlayMode.PRO_ATTACK] = { holes: 1.1, roughness: 1.25, chimney: 1.1, maxHeight: 1.0, aggHeight: 0.9 };
        this.modeProfiles[GamePlayMode.ZEN] = { holes: 1.0, roughness: 1.0, chimney: 1.0, maxHeight: 1.0, aggHeight: 1.0 };
        this.modeProfiles[GamePlayMode.BALANCED] = { holes: 1.0, roughness: 1.0, chimney: 1.0, maxHeight: 1.0, aggHeight: 1.0 };

        // CONFIGURACIÓN DE HEURÍSTICA
        // Estos pesos definen la personalidad del bot.
        this.weights = {
                lines: 4.0, // Recompensa: prioriza limpiar líneas (Tetris = 16pts)
                holes: -1.0, // Penalidad: ponderación base para huecos por altura
                roughness: -0.1, // Penalidad: rugosidad ponderada por ocupación
                aggHeight: -0.5, // Penalidad: altura agregada ponderada por diferencia de borde
                maxHeight: -2.0 // Penalidad: seguridad contra picos altos
        };

var self = this;

// --- CONTROL DE MODO AUTOMÁTICO ---
// El modo automático permite que la IA seleccione el perfil de juego según la altura crítica del tablero.
let autoMode = true;         // IA decide modo dinámico
let manualModeOverride = false;  // Usuario cambia modo
let lastAutoMode = self.gameplayMode; // Persistencia para histeresis

var autoModeToggle = document.getElementById("auto-mode-toggle");
if (autoModeToggle) {
        autoModeToggle.checked = autoMode;
        autoModeToggle.addEventListener("change", function() {
                autoMode = this.checked;
                manualModeOverride = !this.checked;

                // Silenciado: logs informativos
        });
} else {
        // Silenciado
}

// --- UTILIDADES DE MODO ---

this.getModeName = function(mode) {
        return GAMEPLAY_MODE_NAMES[mode] || "DESCONOCIDO";
};

this.setGameplayMode = function(mode) {
        if (!GAMEPLAY_MODE_NAMES[mode]) {
                return;
        }

        self.gameplayMode = mode;
        lastAutoMode = mode;

        var indicator = document.getElementById("mode-indicator");
        if (indicator) {
                indicator.textContent = "Modo Bot: " + self.getModeName(mode);
        }

// Silenciado
};

// --- PREVISUALIZACIÓN DE LA JUGADA DEL BOT ---

this.clearGhostPreview = function() {
        if (!self.ghostElements.length) { return; }

        for (var i = 0; i < self.ghostElements.length; i++) {
                if (self.ghostElements[i].parentNode) {
                        self.ghostElements[i].parentNode.removeChild(self.ghostElements[i]);
                }
        }

        self.ghostElements = [];
};

this.renderGhostPreview = function(move) {
        // Fast-fail: evitar ghost en modos que no lo necesitan.
        self.clearGhostPreview();
        if (!self.tetris || !self.tetris.isCoopMode) { return; }
        if (!self.enabled) { return; }
        if (!move) { return; }
        if (!self.tetris.botPuzzle || !self.tetris.botPuzzle.isRunning()) { return; }
        if (!self.tetris.area || !self.tetris.area.el) { return; }

        var simulation = self.simulateDrop(move.rotation, move.x);
        if (!simulation.isValid || typeof simulation.finalX !== 'number' || typeof simulation.finalY !== 'number') { return; }
        if (!simulation.pieceGrid || !simulation.pieceGrid.length) { return; }

        var unit = self.tetris.unit;
        var pieceType = (typeof self.tetris.botPuzzle.type === 'number') ? self.tetris.botPuzzle.type : 0;

        for (var y = 0; y < simulation.pieceGrid.length; y++) {
                for (var x = 0; x < simulation.pieceGrid[y].length; x++) {
                        if (!simulation.pieceGrid[y][x]) { continue; }

                        var el = document.createElement('div');
                        el.className = 'bot-ghost block' + pieceType;
                        el.style.left = ((simulation.finalX + x) * unit) + 'px';
                        el.style.top = ((simulation.finalY + y) * unit) + 'px';
                        self.tetris.area.el.appendChild(el);
                        self.ghostElements.push(el);
                }
        }
};

function calculateMaxHeightRatio(grid) {
        if (!grid || !grid.length || !grid[0].length) {
                return 1;
        }

        var totalRows = grid.length;
        var totalCols = grid[0].length;
        var highest = 0;

        for (var x = 0; x < totalCols; x++) {
                var colHeight = 0;
                var found = false;

                for (var y = 0; y < totalRows; y++) {
                        if (grid[y][x] !== 0) {
                                colHeight = totalRows - y;
                                found = true;
                                break;
                        }
                }

                if (found && colHeight > highest) {
                        highest = colHeight;
                }
        }

        return highest / totalRows;
}

function getActiveMode(grid) {
        if (manualModeOverride || !autoMode) {
                return self.gameplayMode;
        }

        var maxHeightRatio = calculateMaxHeightRatio(grid);
        var thresholds = {
                PRO_ATTACK: 0.20,
                TETRIS_BUILDER: 0.45,
                SURVIVAL: 0.70
        };

        var candidate;

        if (maxHeightRatio <= thresholds.PRO_ATTACK) {
                candidate = GamePlayMode.PRO_ATTACK;
        } else if (maxHeightRatio <= thresholds.TETRIS_BUILDER) {
                candidate = GamePlayMode.TETRIS_BUILDER;
        } else if (maxHeightRatio <= thresholds.SURVIVAL) {
                candidate = GamePlayMode.SURVIVAL;
        } else {
                candidate = GamePlayMode.ZEN;
        }

        // --- HISTERESIS PARA EVITAR OSCILACIONES ---
        var hysteresisGap = 0.05;

        if (lastAutoMode === GamePlayMode.ZEN && candidate !== GamePlayMode.ZEN) {
                if (maxHeightRatio > (thresholds.SURVIVAL - hysteresisGap)) {
                        return lastAutoMode;
                }
        }

        if (lastAutoMode === GamePlayMode.SURVIVAL && candidate === GamePlayMode.TETRIS_BUILDER) {
                if (maxHeightRatio > (thresholds.TETRIS_BUILDER - hysteresisGap)) {
                        return lastAutoMode;
                }
        }

        if (lastAutoMode === GamePlayMode.TETRIS_BUILDER && candidate === GamePlayMode.PRO_ATTACK) {
                if (maxHeightRatio > (thresholds.PRO_ATTACK - hysteresisGap)) {
                        return lastAutoMode;
                }
        }

        lastAutoMode = candidate;
        return candidate;
}

// Inicializar indicador en el modo predeterminado
this.setGameplayMode(this.gameplayMode);

// --- CONTROL PÚBLICO ---

        this.toggle = function() {
                self.enabled = !self.enabled;
                if (self.tetris && typeof self.tetris.updateBotToggleLabel === "function") {
                        self.tetris.updateBotToggleLabel();
                } else {
                        var btn = document.getElementById("tetris-menu-ai");
                        if (btn) { btn.innerHTML = self.enabled ? "IA Co-op: ON" : "IA Co-op: OFF"; }
                }

                if (self.enabled) {
                        // Si hay un juego activo, tomar control inmediato
                        if (self.tetris && self.tetris.humanPuzzle && self.tetris.humanPuzzle.isRunning()) {
                                self.makeMove();
                        }
                } else {
                        self.isThinking = false; // Detener procesos pendientes
                        self.bestBotMove = null;
                }
        };

        // Cancela cualquier planificación pendiente o previsualización activa.
        this.cancelPlanning = function() {
                self.isThinking = false;
                self.bestBotMove = null;
                self.predictedBoard = null;
                self.clearGhostPreview();
        };

// --- BUCLE DE DECISIÓN (FAST-FAIL) ---

this.makeMove = function() {
        console.log("[BOT] makeMove() called. enabled=", self.enabled, "isThinking=", self.isThinking, "bestBotMove=", self.bestBotMove);
        if (!self.enabled) {
                console.warn("[BOT][ABORT] makeMove(): bot not enabled");
                return;
        }
        if (self.tetris.paused) { return; }
        var actorPuzzle = self.tetris.botPuzzle || self.tetris.humanPuzzle;
        if (!actorPuzzle || !actorPuzzle.isRunning()) { return; }
        if (self.isThinking) {
                console.warn("[BOT][ABORT] makeMove(): still thinking");
                return;
        }
        if (self.bestBotMove) {
                console.warn("[BOT][ABORT] makeMove(): move already pending");
                return;
        }

        self.isThinking = true;

        // Construir el tablero proyectado con la caída final del humano.
        self.predictedBoard = buildPredictedBoard();

        // 1. Calcular la mejor jugada posible
        // (Nota: Esto es intensivo, podría ir en un WebWorker en el futuro)
        var bestMove = self.calculateBestMove();

        // 2. Ejecutar la jugada visualmente
        if (bestMove) {
                self.bestBotMove = bestMove;
                self.renderGhostPreview(bestMove);
        } else {
                self.clearGhostPreview();
        }

        // Si no hay movimiento válido (game over inminente) o el cálculo terminó, liberar
        self.isThinking = false;
                        };

// --- EJECUCIÓN DIFERIDA TRAS EL LOCK HUMANO ---

this.executeStoredMove = function() {
        if (!self.bestBotMove) { return; }

        // Si el bot está apagado, limpiar la jugada pendiente para evitar bloqueos futuros.
        if (!self.enabled) {
                self.bestBotMove = null;
                return;
        }

        self.clearGhostPreview();
        self.isThinking = true;
        var moveToExecute = self.bestBotMove;
        self.bestBotMove = null;

        // Validar que la jugada sigue siendo legal con el tablero real.
        self.predictedBoard = null;
        var isStillValid = self.simulateDrop(moveToExecute.rotation, moveToExecute.x);
        if (!isStillValid.isValid) {
                self.isThinking = false;
                return;
        }

        self.executeMoveSmoothly(moveToExecute);
};

// --- EJECUCIÓN VISUAL (ANIMACIÓN) ---

this.executeMoveSmoothly = function(move) {
        console.log("[BOT] executeMoveSmoothly() called with move:", move);
        var actions = [];

        var actor = self.tetris.botPuzzle || self.tetris.humanPuzzle;
        if (!actor) { return; }

        if (typeof actor.suspendGravity === 'function') { actor.suspendGravity(); }

        var simulation = self.simulateDrop(move.rotation, move.x);
        if (!simulation.isValid) {
                self.isThinking = false;
                return;
        }

        // 1. Planificar rotaciones
        for (var i = 0; i < move.rotation; i++) { actions.push('up'); }

        // 2. Planificar movimiento lateral
        var currentX = actor.getX();
        var targetX = (typeof simulation.finalX === 'number') ? simulation.finalX : move.x;
        var dx = targetX - currentX;
        var dir = dx > 0 ? 'right' : 'left';

        for (var j = 0; j < Math.abs(dx); j++) { actions.push(dir); }

        var targetY = simulation.finalY;

        // 3. Ejecutar secuencia con retardo y caída visual
        var k = 0;
        function playStep() {
                if (!self.enabled || !actor || actor.isStopped()) {
                        self.isThinking = false;
                        return;
                }

                if (k < actions.length) {
                        var action = actions[k++];

                        console.log("[BOT][ACTION]", action, "currentX=", actor.getX());

                        if (action === 'up' && actor.mayRotate()) { actor.rotate(); }
                        else if (action === 'left' && actor.mayMoveLeft()) { actor.moveLeft(); }
                        else if (action === 'right' && actor.mayMoveRight()) { actor.moveRight(); }

                        setTimeout(playStep, 50);
                        return;
                }

                animateDrop();
        }

        function animateDrop() {
                if (!self.enabled || !actor || actor.isStopped()) {
                        self.isThinking = false;
                        return;
                }

                var atTargetY = (typeof targetY === 'number') && actor.getY() >= targetY;
                if (!atTargetY && actor.mayMoveDown()) {
                        actor.moveDown();
                        setTimeout(animateDrop, 50);
                        return;
                }

                actor.stop();
                actor.forceMoveDownDelay = 50;
                actor.forceMoveDown();
                self.isThinking = false;
        }

        playStep();
                        };

this.calculateBestMove = function() {
    var bestScore = Infinity;
    var bestMove = null;
    var centerX = self.tetris.areaX / 2;
    var zeroHoleMoves = [];

    var activePieceType = (self.tetris && self.tetris.botPuzzle) ? self.tetris.botPuzzle.type : 'unknown';
    console.log("[BOT] calculating best move for piece type:", activePieceType);

    // --- Deuda estructural inicial: evaluar el costo de agujeros del tablero actual ---
    var initialGrid = cloneAreaGrid(self.tetris.area.board);
    var initialEvaluation = self.evaluateGrid(initialGrid, 0);
    var initialHolesCost = initialEvaluation.holes;

    for (var r = 0; r < 4; r++) {
        for (var x = 0; x < self.tetris.areaX; x++) {
            var simulation = self.simulateDrop(r, x);
            if (!simulation.isValid) {
                console.warn("[BOT][SIM] invalid move for rotation=", r, "x=", x);
                continue;
            }

            var evaluation = self.evaluateGrid(simulation.grid, simulation.linesCleared);
            var score = evaluation.score;
            var holesCost = evaluation.holes;

            var move = {
                rotation: r,
                x: x,
                score: score,
                hasZeroNetDebt: holesCost <= initialHolesCost,
                maxHeight: getMaxHeight(simulation.grid)
            };

            if (move.hasZeroNetDebt) {
                zeroHoleMoves.push(move);
            }

            if (score < bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
    }

    var finalBestMove = null;

    if (zeroHoleMoves.length > 0) {
        var bestZeroHoleScore = Infinity;
        for (var i = 0; i < zeroHoleMoves.length; i++) {
            var candidate = zeroHoleMoves[i];

            // Fast fail: si la puntuación no mejora y la altura no es menor, saltar pronto.
            if (candidate.score > bestZeroHoleScore && (!finalBestMove || candidate.maxHeight >= finalBestMove.maxHeight)) {
                continue;
            }

            if (candidate.score < bestZeroHoleScore ||
                (candidate.score === bestZeroHoleScore && finalBestMove && candidate.maxHeight < finalBestMove.maxHeight)) {
                bestZeroHoleScore = candidate.score;
                finalBestMove = candidate;
            } else if (candidate.score === bestZeroHoleScore && !finalBestMove) {
                finalBestMove = candidate;
            }
        }
    } else {
        finalBestMove = bestMove;
    }

    function getMaxHeight(grid) {
        var maxH = 0;
        for (var col = 0; col < grid[0].length; col++) {
            for (var row = 0; row < grid.length; row++) {
                if (grid[row][col] !== 0) {
                    var height = self.tetris.areaY - row;
                    if (height > maxH) { maxH = height; }
                    break;
                }
            }
        }
        return maxH;
    }

    console.log("[BOT] bestMove result:", finalBestMove);

    return finalBestMove ? { rotation: finalBestMove.rotation, x: finalBestMove.x } : null;
};

this.evaluateGrid = function(grid, linesCleared, skipLookahead) {
    var TOTAL_ROWS = self.tetris.areaY; // 22
    var TOTAL_COLS = self.tetris.areaX; // 12
    var MAX_RISK_CELLS = TOTAL_ROWS * TOTAL_COLS; // 264

    var modeToUse = getActiveMode(grid);
    var maxHeightRatio = 0;

    var COMMON_SCALE = 10000;
    
    // --- PEORES CASOS ---
    var WORST_HOLES_COST = 36 * (TOTAL_ROWS * (TOTAL_ROWS + 1) / 2); // 9,108
    var WORST_ROUGHNESS_COST = (TOTAL_COLS - 1) * TOTAL_ROWS * MAX_RISK_CELLS; // 63,888
    
    // CHIMENEA ACTUALIZADA CON ALTURA DE BASE
    var MAX_CHIMNEYS = 4;
    var MAX_CHIMNEY_DEPTH = 4;
    var MAX_BASE_HEIGHT = TOTAL_ROWS; // 22
    var MAX_HOLES_PER_CHIMNEY = 20;
    var WORST_CHIMNEY_COST = MAX_CHIMNEYS * MAX_CHIMNEY_DEPTH * (MAX_BASE_HEIGHT + MAX_HOLES_PER_CHIMNEY);
    // = 4 × 4 × 42 = 672
    
    var WORST_MAX_HEIGHT = TOTAL_ROWS; // 22
    var WORST_AGG_HEIGHT = TOTAL_COLS * TOTAL_ROWS; // 264
    
    // --- COEFICIENTES DE PREFERENCIA (DINÁMICOS) ---
    var HOLES_PREFERENCE;
    var ROUGHNESS_PREFERENCE;
    var CHIMNEY_PREFERENCE;
    var MAX_HEIGHT_PREFERENCE;
    var AGG_HEIGHT_PREFERENCE;
    
    // --- ACUMULADORES ---
    var holesCostRaw = 0;
    var roughnessCostRaw = 0;
    var chimneyCostRaw = 0;
    var maxHeight = 0;
    var aggregateHeight = 0;
    var occupiedCells = 0;
    
    var heights = [];
    var holesInCol = [];
    var holesInRow = new Array(TOTAL_ROWS).fill(0);
    var highestClearedRow = TOTAL_ROWS;
    
    // --- ESCANEO DEL TABLERO ---
    for (var x = 0; x < TOTAL_COLS; x++) {
        var colHeight = 0;
        var colHoles = 0;
        var blockFound = false;
        
        for (var y = 0; y < TOTAL_ROWS; y++) {
            var hasBlock = (grid[y][x] !== 0);
            
            if (hasBlock) {
                occupiedCells++;
                if (!blockFound) {
                    colHeight = TOTAL_ROWS - y;
                    blockFound = true;
                    if (colHeight > maxHeight) {
                        maxHeight = colHeight;
                    }
                }
            } else if (blockFound) {
                colHoles++;
                holesInRow[y]++;
            }
        }
        
        heights.push(colHeight);
        holesInCol.push(colHoles);
        aggregateHeight += colHeight;
    }

    // --- CÁLCULO TEMPRANO DE RIESGO LOCAL ---
    // Riesgo principal basado en la altura máxima de columna (no en ocupación).
    maxHeightRatio = maxHeight / TOTAL_ROWS;
    var riskLocalBase = maxHeightRatio * 100;

    // --- AJUSTE DE PRIORIDADES SEGÚN RIESGO ---
    if (riskLocalBase < 50) {
        // Bajo riesgo: mayor énfasis en preparar setups (rugosidad/chimeneas)
        HOLES_PREFERENCE = 3.0;
        ROUGHNESS_PREFERENCE = 5.0;
        CHIMNEY_PREFERENCE = 4.5;
        MAX_HEIGHT_PREFERENCE = 2.5;
        AGG_HEIGHT_PREFERENCE = 2.0;
    } else if (riskLocalBase <= 70) {
        // Riesgo medio: distribución equilibrada
        HOLES_PREFERENCE = 4.5;
        ROUGHNESS_PREFERENCE = 4.0;
        CHIMNEY_PREFERENCE = 2.5;
        MAX_HEIGHT_PREFERENCE = 3.5;
        AGG_HEIGHT_PREFERENCE = 3.0;
    } else {
        // Alto riesgo: penalización fuerte a huecos y alturas
        HOLES_PREFERENCE = 6.5;
        ROUGHNESS_PREFERENCE = 3.0;
        CHIMNEY_PREFERENCE = 1.5;
        MAX_HEIGHT_PREFERENCE = 5.0;
        AGG_HEIGHT_PREFERENCE = 4.0;
    }

    // --- AJUSTE POR MODO DE JUEGO ---
    var modeProfile = self.modeProfiles[modeToUse] || self.modeProfiles[self.GamePlayMode.BALANCED];
    HOLES_PREFERENCE *= modeProfile.holes;
    ROUGHNESS_PREFERENCE *= modeProfile.roughness;
    CHIMNEY_PREFERENCE *= modeProfile.chimney;
    MAX_HEIGHT_PREFERENCE *= modeProfile.maxHeight;
    AGG_HEIGHT_PREFERENCE *= modeProfile.aggHeight;

    // --- COSTOS BRUTOS ---
    
    // A. AGUJEROS
    for (var y = 0; y < TOTAL_ROWS; y++) {
        if (holesInRow[y] > 0) {
            var rowHeightWeight = TOTAL_ROWS - y;
            holesCostRaw += (holesInRow[y] * holesInRow[y]) * rowHeightWeight;
            
            if (y < highestClearedRow) {
                highestClearedRow = y;
            }
        }
    }
    
    // B. RUGOSIDAD
    var roughnessSum = 0;
    for (var i = 0; i < TOTAL_COLS - 1; i++) {
        roughnessSum += Math.abs(heights[i] - heights[i + 1]);
    }
    roughnessCostRaw = roughnessSum * occupiedCells;
    
    // C. CHIMENEAS (CORREGIDO CON ALTURA DE BASE)
    for (var x = 0; x < TOTAL_COLS; x++) {
        var hLeft = (x === 0) ? TOTAL_ROWS : heights[x - 1];
        var hRight = (x === TOTAL_COLS - 1) ? TOTAL_ROWS : heights[x + 1];
        var minWallHeight = Math.min(hLeft, hRight);
        
        var chimneyDepth = minWallHeight - heights[x];
        
        if (chimneyDepth >= 4) {
            // Fórmula: profundidad × (altura_base + agujeros)
            var baseHeight = heights[x];
            chimneyCostRaw += chimneyDepth * (baseHeight + holesInCol[x]);
        }
    }
    
    // La jugada tiene agujeros si el costo bruto de agujeros es mayor a 0.
    // var hasHolesAfterMove = (holesCostRaw > 0); // Eliminada la variable de la restricción de recompensa.

    // --- NORMALIZACIÓN ---
    var holesCostNormalized = (holesCostRaw / WORST_HOLES_COST) * COMMON_SCALE * HOLES_PREFERENCE;
    var roughnessCostNormalized = (roughnessCostRaw / WORST_ROUGHNESS_COST) * COMMON_SCALE * ROUGHNESS_PREFERENCE;
    var chimneyCostNormalized = (chimneyCostRaw / WORST_CHIMNEY_COST) * COMMON_SCALE * CHIMNEY_PREFERENCE;
    var maxHeightCostNormalized = (maxHeight / WORST_MAX_HEIGHT) * COMMON_SCALE * MAX_HEIGHT_PREFERENCE;
    var aggHeightCostNormalized = (aggregateHeight / WORST_AGG_HEIGHT) * COMMON_SCALE * AGG_HEIGHT_PREFERENCE;
    
    var heuristicCost = holesCostNormalized + 
                       roughnessCostNormalized + 
                       chimneyCostNormalized + 
                       maxHeightCostNormalized + 
                       aggHeightCostNormalized;

    
    // --- RECOMPENSA POR LÍNEAS ---
    var linesReward = 0;
    
    // REGLA MODIFICADA: Recompensar por líneas, sin importar si quedan agujeros.
    // Se elimina la condición `&& !hasHolesAfterMove`
    if (linesCleared > 0) {
        var baseReward = linesCleared * 100;
        var bonusReward = linesCleared * linesCleared * 500;
        var heightBonus = (TOTAL_ROWS - highestClearedRow) * 100;
        linesReward = baseReward + bonusReward + heightBonus;
    }
    
    // --- CÁLCULO FINAL ---
    var S_SENSITIVITY = 5000;
    var totalRiskScore = riskLocalBase * (1 + (heuristicCost / S_SENSITIVITY)) - linesReward;

    var modeName = Object.keys(GamePlayMode).find(function(key) { return GamePlayMode[key] === modeToUse; }) || self.getModeName(modeToUse);

    var indicator = document.getElementById("mode-indicator");
    if (indicator) {
            indicator.innerText = "Modo Bot: " + modeName;
    }

    // --- LOOKAHEAD DINÁMICO ---
    var scoreCurrent = totalRiskScore;
    var scoreFuture = null;
    var finalScore = scoreCurrent;

    var isAutoLookaheadEnabled = !skipLookahead && autoMode && !manualModeOverride;
    var weightCurrent = 1;
    var weightFuture = 0;

    if (isAutoLookaheadEnabled) {
            weightCurrent = maxHeightRatio > 0.5 ? 0.70 : 0.40;
            weightFuture = maxHeightRatio > 0.5 ? 0.30 : 0.60;
    }

    if (isAutoLookaheadEnabled && self.tetris && self.tetris.humanPuzzle && self.tetris.humanPuzzle.puzzles) {
            var nextType = self.tetris.humanPuzzle.nextType;
            if (nextType !== null && nextType !== undefined) {
                    var nextPiece = self.tetris.humanPuzzle.puzzles[nextType];

                    // Simular la mejor colocación posible de la siguiente pieza.
                    scoreFuture = simulateNextPiece(grid, nextPiece);

                    if (scoreFuture !== null) {
                            finalScore = (scoreCurrent * weightCurrent) + (scoreFuture * weightFuture);
                    } else {
                            finalScore = scoreCurrent;
                    }
            }
    } else {
            finalScore = scoreCurrent;
    }

    // Silenciado: evitar logs de evaluación en consola

    return { score: finalScore, holes: holesCostRaw };
};

function simulateNextPiece(baseGrid, nextPiece) {
        if (!nextPiece || !nextPiece.length || !baseGrid || !baseGrid.length) {
                // Fast fail: sin pieza futura o tablero inválido, no hay lookahead.
                return null;
        }

        var candidateScore = null;
        var rotatedPiece = nextPiece;

        // Probar las 4 rotaciones posibles.
        for (var r = 0; r < 4; r++) {
                if (r > 0) {
                        rotatedPiece = rotateGrid(rotatedPiece);
                }

                var pieceWidth = rotatedPiece[0].length;
                var maxX = self.tetris.areaX - pieceWidth;

                for (var x = 0; x <= maxX; x++) {
                        // Si no cabe en la fila superior, intentar siguiente posición.
                        if (!isPositionValid(rotatedPiece, x, 0, baseGrid)) { continue; }

                        var dropY = 0;
                        while (isPositionValid(rotatedPiece, x, dropY + 1, baseGrid)) {
                                dropY++;
                        }

                        var merged = mergePiece(baseGrid, rotatedPiece, x, dropY);
                        var cleared = clearFullLines(merged);
                        var evaluation = self.evaluateGrid(cleared.grid, cleared.lines, true);

                        if (!evaluation) { continue; }

                        if (candidateScore === null || evaluation.score < candidateScore) {
                                candidateScore = evaluation.score;
                        }
                }
        }

        return candidateScore;
}

// --- SIMULACIÓN FÍSICA ---
this.simulateDrop = function(rotation, targetX) {
        console.log("[BOT][SIM-DROP] Testing rotation=", rotation, "x=", targetX);

        function logResult(result) {
                console.log("[BOT][SIM-DROP] Result: isValid=", result.isValid,
                        "finalX=", result.finalX, "finalY=", result.finalY);
                return result;
        }

        if (!self.tetris || !self.tetris.area) {
                return logResult({ isValid: false, grid: [], linesCleared: 0, finalX: null, finalY: null, pieceGrid: null });
        }

        var referenceBoard = self.predictedBoard || self.tetris.area.board;
        var areaGrid = cloneAreaGrid(referenceBoard);

        var activePuzzle = self.tetris.botPuzzle || self.tetris.humanPuzzle;
        if (!activePuzzle) {
                return logResult({ isValid: false, grid: [], linesCleared: 0, finalX: null, finalY: null, pieceGrid: null });
        }

        var pieceGrid = clonePieceGrid(activePuzzle.board);

        if (!pieceGrid.length) {
                return logResult({ isValid: false, grid: [], linesCleared: 0, finalX: null, finalY: null, pieceGrid: null });
        }

        for (var i = 0; i < rotation; i++) {
                pieceGrid = rotateGrid(pieceGrid);
        }

        var posX = activePuzzle.getX();
        var posY = activePuzzle.getY();

        if (!isPositionValid(pieceGrid, posX, posY, areaGrid)) {
                return logResult({ isValid: false, grid: [], linesCleared: 0, finalX: null, finalY: null, pieceGrid: null });
        }

        if (targetX < 0 || targetX >= self.tetris.areaX) {
                return logResult({ isValid: false, grid: [], linesCleared: 0, finalX: null, finalY: null, pieceGrid: null });
        }

        var dir = targetX > posX ? 1 : -1;
        while (posX !== targetX) {
                var nextX = posX + dir;
                if (!isPositionValid(pieceGrid, nextX, posY, areaGrid)) {
                        return logResult({ isValid: false, grid: [], linesCleared: 0, finalX: null, finalY: null, pieceGrid: null });
                }
                posX = nextX;
        }

        while (isPositionValid(pieceGrid, posX, posY + 1, areaGrid)) {
                posY++;
        }

        var mergedGrid = mergePiece(areaGrid, pieceGrid, posX, posY);
        var cleared = clearFullLines(mergedGrid);

        return logResult({ isValid: true, grid: cleared.grid, linesCleared: cleared.lines, finalX: posX, finalY: posY, pieceGrid: pieceGrid });
                        };

// Construye el tablero proyectado incluyendo la posición final de la pieza humana.
function buildPredictedBoard() {
        if (!self.tetris || !self.tetris.area) {
                return null;
        }

        if (!self.tetris.humanPuzzle || self.tetris.humanPuzzle.isStopped()) {
                return cloneAreaGrid(self.tetris.area.board);
        }

        var baseGrid = cloneAreaGrid(self.tetris.area.board);
        var humanPiece = clonePieceGrid(self.tetris.humanPuzzle.board);

        if (!humanPiece.length) {
                return baseGrid;
        }

        var posX = self.tetris.humanPuzzle.getX();
        var posY = self.tetris.humanPuzzle.getY();

        // Fast-fail: si la posición actual ya es inválida, devolvemos solo el tablero base.
        if (!isPositionValid(humanPiece, posX, posY, baseGrid)) {
                return baseGrid;
        }

        while (isPositionValid(humanPiece, posX, posY + 1, baseGrid)) {
                posY++;
        }

        return mergePiece(baseGrid, humanPiece, posX, posY);
}

function cloneAreaGrid(board) {
	var grid = [];
	for (var y = 0; y < board.length; y++) {
		grid.push([]);
		for (var x = 0; x < board[y].length; x++) {
			grid[y].push(board[y][x] ? 1 : 0);
		}
}
return grid;
}

function clonePieceGrid(board) {
	var grid = [];
	for (var y = 0; y < board.length; y++) {
		grid.push([]);
		for (var x = 0; x < board[y].length; x++) {
			grid[y].push(board[y][x] ? 1 : 0);
		}
}
return grid;
}

function rotateGrid(matrix) {
	var size = matrix.length;
	var rotated = [];
	for (var y = 0; y < size; y++) {
		rotated.push([]);
		for (var x = 0; x < size; x++) {
			rotated[y].push(0);
		}
}

for (var y2 = 0; y2 < size; y2++) {
	for (var x2 = 0; x2 < size; x2++) {
		if (matrix[y2][x2]) {
			var newY = size - 1 - x2;
			var newX = y2;
			rotated[newY][newX] = 1;
		}
}
}

return rotated;
}

function isPositionValid(piece, posX, posY, areaGrid) {
	for (var y = 0; y < piece.length; y++) {
		for (var x = 0; x < piece[y].length; x++) {
			if (piece[y][x]) {
				var boardY = posY + y;
				var boardX = posX + x;

				if (boardY >= self.tetris.areaY) { return false; }
				if (boardX < 0 || boardX >= self.tetris.areaX) { return false; }
				if (areaGrid[boardY][boardX]) { return false; }
			}
	}
}
return true;
}

function mergePiece(areaGrid, piece, posX, posY) {
	var grid = cloneAreaGrid(areaGrid);
	for (var y = 0; y < piece.length; y++) {
		for (var x = 0; x < piece[y].length; x++) {
			if (piece[y][x]) {
				grid[posY + y][posX + x] = 1;
			}
	}
}
return grid;
}

function clearFullLines(grid) {
	var cleared = 0;
	var newGrid = [];
	for (var y = grid.length - 1; y >= 0; y--) {
		var isFull = true;
		for (var x = 0; x < grid[y].length; x++) {
			if (!grid[y][x]) {
				isFull = false;
				break;
			}
	}

if (isFull) {
	cleared++;
} else {
newGrid.unshift(grid[y].slice());
}
}

while (newGrid.length < self.tetris.areaY) {
	var emptyRow = [];
	for (var i = 0; i < self.tetris.areaX; i++) {
		emptyRow.push(0);
	}
newGrid.unshift(emptyRow);
}

return { grid: newGrid, lines: cleared };
}
}

// Exponer el bot en el ámbito global para evitar referencias indefinidas
if (typeof window !== 'undefined') {
        window.TetrisBot = TetrisBot;
}
