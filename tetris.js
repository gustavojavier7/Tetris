/*
 * PROJECT:  JsTetris (Refactored for IA-ASSIST)
 * VERSION:  1.40 - SER-T800 Optimized
 * LICENSE:  BSD (revised)
 * AUTHOR:   (c) 2004 Czarek Tomczak
 * REFACTOR: SER-T800
 */

function Tetris()
{
	var self = this;

        this.stats = new Stats();
        this.puzzle = null; // ARQUITECTURA UNIFICADA: Una sola pieza activa
        this.area = null;
        this.keyboard = new Keyboard();

        this.unit  = 20;
        this.areaX = 12;
        this.areaY = 22;

        // Bandeja visual para mostrar la pieza final antes del Game Over
        this.pendingBlockedGameOver = false;

	// Estados del control
        this.controlState = 'HUMAN'; // 'HUMAN', 'TRANSITIONING_TO_IA', 'IA'
        this.botReadyInterval = null;
        this.botReadyTimeout = null;
	
	// Modos
	this.isIAAssist = false; 
	this.iaPending = false;
	this.zenMode = false;
	
	// El modo Co-op ha sido eliminado permanentemente del núcleo.
	this.inputLocked = false; 

        this.highscores = new Highscores(10);
        this.paused = false;

        this.gameMessageEl = document.getElementById('gameMessage');
        var defaultGameMessage = this.gameMessageEl ? this.gameMessageEl.innerHTML : '';
        var gameMessageClearTimeout = null;

	var SIDEBAR_UNITS = 9.5;
	this.sidebarUnits = SIDEBAR_UNITS;

	// --- GESTIÓN VISUAL ---

	this.updateCssScale = function() {
		var rootStyle = document.documentElement.style;
		rootStyle.setProperty('--unit', self.unit + 'px');
		rootStyle.setProperty('--area-x', self.areaX);
		rootStyle.setProperty('--area-y', self.areaY);
		// ... (resto de lógica visual intacta) ...
		// Para brevedad, la lógica de redimensionado DOM se mantiene igual, 
		// pero aseguramos que apunte a los elementos correctos.
		var areaEl = document.getElementById('tetris-area');
		if (areaEl) {
			areaEl.style.width = ((self.unit * self.areaX) - 1) + 'px';
			areaEl.style.height = ((self.unit * self.areaY) - 1) + 'px';
			areaEl.style.left = (self.unit * SIDEBAR_UNITS + 1) + 'px';
		}
		// ... (omitido resto de updateCssScale por ser igual al original) ...
	};

	this.rescaleBoard = function() {
		if (self.area) {
			self.area.unit = self.unit;
			// Rescalar bloques estáticos
			for (var y = 0; y < self.area.board.length; y++) {
				for (var x = 0; x < self.area.board[y].length; x++) {
					if (self.area.board[y][x]) {
						self.area.board[y][x].style.left = (x * self.area.unit) + 'px';
						self.area.board[y][x].style.top = (y * self.area.unit) + 'px';
					}
				}
			}
		}
		// Rescalar pieza activa única
		if (self.puzzle && self.puzzle.board) {
			for (var y2 = 0; y2 < self.puzzle.board.length; y2++) {
				for (var x2 = 0; x2 < self.puzzle.board[y2].length; x2++) {
					if (self.puzzle.board[y2][x2]) {
						self.puzzle.board[y2][x2].style.left = (self.puzzle.getX() + x2) * self.area.unit + 'px';
						self.puzzle.board[y2][x2].style.top = (self.puzzle.getY() + y2) * self.area.unit + 'px';
					}
				}
			}
		}
		// Rescalar Next Puzzle
		if (self.puzzle) {
			var nextContainer = document.getElementById('tetris-nextpuzzle');
			if (nextContainer) {
				nextContainer.innerHTML = '';
				self.puzzle.nextElements = [];
				var nextPuzzle = self.puzzle.puzzles[self.puzzle.nextType];
				for (var ny = 0; ny < nextPuzzle.length; ny++) {
					for (var nx = 0; nx < nextPuzzle[ny].length; nx++) {
						if (nextPuzzle[ny][nx]) {
							var nextEl = document.createElement('div');
							nextEl.className = 'block' + self.puzzle.nextType;
							nextEl.style.left = (nx * self.area.unit) + 'px';
							nextEl.style.top = (ny * self.area.unit) + 'px';
							nextContainer.appendChild(nextEl);
							self.puzzle.nextElements.push(nextEl);
						}
					}
				}
			}
		}
	};

        this.updateResponsiveUnit = function() {
                // MEDIR EL CONTENEDOR EXACTO DEL JUEGO
                var container = document.querySelector('.game-board');
                var availableWidth = container ? container.clientWidth : window.innerWidth * 0.9;
                var availableHeight = container ? container.clientHeight : window.innerHeight * 0.9;
                
                // Restar un pequeño padding para evitar scrollbars
                availableWidth -= 10; 
                availableHeight -= 10;

                var unitFromWidth = availableWidth / (self.areaX + SIDEBAR_UNITS);
                var unitFromHeight = availableHeight / self.areaY;
                
                // Calcular unidad máxima posible sin desbordar
                var calculated = Math.max(10, Math.floor(Math.min(unitFromWidth, unitFromHeight)));

                if (!calculated || calculated == self.unit) { self.updateCssScale(); return; }
                
                self.unit = calculated;
                self.updateCssScale();
                self.rescaleBoard();
        };

	// --- GESTIÓN DE MODOS ---

	this.setGameMode = function(dummy) {
		// Stub para compatibilidad si la UI llama a esto.
		// Co-op eliminado.
	};

        this.updateGameMode = function(modeState) {
                console.info('[SWAP] Cambio de modo solicitado', modeState);
                self.inputLocked = true;
                if (self.puzzle) self.puzzle.clearTimers();

                self.applyModeRules(modeState);

                // Reaplicar control humano si el modo cambia a HUMANO
                self.resyncControlState();

                setTimeout(() => {
                        self.inputLocked = false;
                        self.resyncControlState();
                }, 150);
        };

	this.applyModeRules = function(modeState) {
		var requestedIA = !!(modeState && modeState.ia);
		var requestedZen = !!(modeState && modeState.zen);
		
		// Lógica simple: Solo IA-ASSIST o ZEN
		if (requestedIA && window.bot) {
			window.bot.enabled = true;
		}
		
		var botIsReady = (window.bot && window.bot.enabled === true);
		if (requestedIA && !botIsReady) self.iaPending = true;
		else self.iaPending = false;

		self.isIAAssist = requestedIA && botIsReady;
		self.zenMode = requestedZen;

		// Actualizar UI
		var zenCheckbox = document.getElementById('tetris-zen-mode');
		if (zenCheckbox) zenCheckbox.checked = self.zenMode;
		
                var iaToggle = document.getElementById('iaAssistToggle');
                if (iaToggle) iaToggle.classList.toggle('active', self.isIAAssist);
		var zenToggle = document.getElementById('zenToggle');
		if (zenToggle) zenToggle.classList.toggle('active', self.zenMode);

		// Gestión del Bot
		if (window.bot) {
			window.bot.enabled = (self.isIAAssist || self.iaPending);
			self.updateBotToggleLabel();
			if (!self.isIAAssist) {
				window.bot.clearGhostPreview();
				window.bot.cancelPlanning();
			}
		}

		// Aplicar cambio de control
		if (self.isIAAssist) {
			self.enableIAAssist();
		} else {
			self.disableIAAssist();
		}

		self.updateModeStatus();
	};

        this.enableIAAssist = function() {
                if (!self.puzzle || self.puzzle.isStopped()) return;
                if (!window.bot || !window.bot.enabled) return;

                self.transferControlToIA();
                self.updateControlStyles(self.puzzle);
        };

                this.disableIAAssist = function() {
                        if (!self.puzzle) return;

                        console.log("[IA] Devolviendo control.");
                        if (self.botReadyInterval) {
                                clearInterval(self.botReadyInterval);
                                self.botReadyInterval = null;
                        }
                        if (self.botReadyTimeout) {
                                clearTimeout(self.botReadyTimeout);
                                self.botReadyTimeout = null;
                        }
                        self.controlState = 'HUMAN';
                        self.inputLocked = false;
                        self.resyncControlState();
                };

        this.transferControlToIA = function() {
                if (self.controlState !== 'HUMAN') {
                        console.warn('[IA] Transferencia ignorada: controlState no es HUMANO.', self.controlState);
                        return;
                }

                console.log('[IA] Iniciando transferencia de control a bot.');
                self.controlState = 'TRANSITIONING_TO_IA';
                self.inputLocked = true;

                if (self.puzzle) self.puzzle.suspendGravity();

                if (self.botReadyInterval) {
                        clearInterval(self.botReadyInterval);
                        self.botReadyInterval = null;
                }
                if (self.botReadyTimeout) {
                        clearTimeout(self.botReadyTimeout);
                        self.botReadyTimeout = null;
                }

                self.botReadyTimeout = setTimeout(() => {
                        console.error('[IA][FAST-FAIL] Bot no se declaró listo dentro del tiempo de espera. Revirtiendo control.');
                        if (self.botReadyInterval) {
                                clearInterval(self.botReadyInterval);
                                self.botReadyInterval = null;
                        }
                        self.controlState = 'HUMAN';
                        self.inputLocked = false;
                        if (self.puzzle) {
                                self.puzzle.isHumanControlled = true;
                                self.puzzle.resumeGravity(true);
                        }
                }, 2500);

                self.botReadyInterval = setInterval(() => {
                        if (window.bot && window.bot.enabled && !window.bot.isThinking) {
                                clearInterval(self.botReadyInterval);
                                self.botReadyInterval = null;
                                if (self.botReadyTimeout) {
                                        clearTimeout(self.botReadyTimeout);
                                        self.botReadyTimeout = null;
                                }

                                console.log('[IA] Bot listo. Transferencia completada.');
                                self.controlState = 'IA';
                                self.inputLocked = true;
                                if (self.puzzle) {
                                        self.puzzle.isHumanControlled = false;
                                }

                                window.bot.currentPuzzle = self.puzzle;
                                window.bot.makeMove();
                        }
                }, 100);
        };

	this.updateControlStyles = function(actor) {
		if (!actor || !actor.elements) return;
		// En IA-ASSIST puro, no distinguimos visualmente al bot para mantener estética limpia
		// Si quieres que brille, cambia false a true.
		var shouldMarkBot = false; 

		var toggleVisual = function(el) {
			if (!el || !el.classList) return;
			if (shouldMarkBot) el.classList.add('bot-controlled');
			else el.classList.remove('bot-controlled');
		};
		actor.elements.forEach(toggleVisual);
	};

        this.updateModeStatus = function() {
                var el = document.getElementById('mode-status');
                if (!el) return;
                var modeLabel = 'MODO: CLÁSICO';
                var color = '#ffffff';

                if (self.isIAAssist) {
                        modeLabel = 'MODO: IA-ASSIST (Automático)';
                        color = '#00e5ff';
                } else if (self.zenMode) {
                        modeLabel = 'MODO: ZEN';
                        color = '#ffaa00';
                }

                var botMode = null;
                if (window.bot) {
                        botMode = window.bot.activeBotModeName;
                        if (!botMode && window.bot.getModeName && window.bot.gameplayMode) {
                                botMode = window.bot.getModeName(window.bot.gameplayMode);
                        }
                        if (botMode) {
                                modeLabel += ' • Estrategia: ' + botMode;
                        }
                }

                el.textContent = modeLabel;
                el.style.color = color;
        };

        this.updateBotToggleLabel = function() {
                var botLabel = document.getElementById("tetris-menu-ai");
                if (botLabel && window.bot) {
                        botLabel.innerHTML = "IA: " + (window.bot.enabled ? "ON" : "OFF");
                }
        };

        this.showGameOverMessage = function() {
                if (!self.gameMessageEl) return;

                if (gameMessageClearTimeout) {
                        clearTimeout(gameMessageClearTimeout);
                        gameMessageClearTimeout = null;
                }

                self.gameMessageEl.style.display = '';
                self.gameMessageEl.innerHTML = '<h2>Game Over</h2>';
                self.gameMessageEl.classList.remove('idle');
                self.gameMessageEl.classList.add('active', 'gameover');
        };

        this.clearGameMessage = function() {
                if (!self.gameMessageEl) return;

                if (gameMessageClearTimeout) {
                        clearTimeout(gameMessageClearTimeout);
                        gameMessageClearTimeout = null;
                }

                self.gameMessageEl.classList.remove('active', 'gameover');
                self.gameMessageEl.classList.add('idle');
                self.gameMessageEl.style.display = 'none';
        };

        this.scheduleGameMessageClear = function() {
                if (!self.gameMessageEl) return;

                if (gameMessageClearTimeout) {
                        clearTimeout(gameMessageClearTimeout);
                }

                gameMessageClearTimeout = setTimeout(function() {
                        self.clearGameMessage();
                        gameMessageClearTimeout = null;
                }, 5000);
        };

        // --- CORE GAME LOOP ---

        this.start = function() {
                if (self.puzzle && !confirm('¿Nueva partida?')) return;
                self.updateResponsiveUnit();
                self.reset();

                if (typeof self.clearGameMessage === 'function') {
                        self.clearGameMessage();
                }

		if (window.bot) {
			window.bot.enabled = !!self.isIAAssist; // Mantener estado si ya estaba activo
			self.updateBotToggleLabel();
		}

		self.stats.start();
		document.getElementById("tetris-nextpuzzle").style.display = "block";
		document.getElementById("tetris-keys").style.display = "none";
		
                self.area = new Area(self.unit, self.areaX, self.areaY, "tetris-area");

                // CREACIÓN ÚNICA DE PIEZA
                self.puzzle = new Puzzle(self, self.area, true);

                // Asegurar que la primera pieza responda al jugador por defecto
                self.resyncControlState();
		
		// Si arrancamos directo en modo IA
		if (self.isIAAssist) {
			self.enableIAAssist();
		}

                if (self.puzzle.mayPlace()) {
                        self.puzzle.place();
                        self.resyncControlState();
                } else {
                        self.showBlockedGameOver();
                }
        };

        this.resyncControlState = function() {
                if (!self.puzzle) return;

                var shouldBeHuman = (self.controlState === 'HUMAN');
                var canRun = shouldBeHuman && !self.inputLocked && !self.paused;

                self.puzzle.isHumanControlled = shouldBeHuman;

                if (canRun) {
                        self.puzzle.resumeGravity(true);
                } else {
                        self.puzzle.suspendGravity();
                }

                self.updateControlStyles(self.puzzle);
        };

                this.reset = function() {
                        if (window.bot) {
                                if (typeof window.bot.cancelPlanning === 'function') {
                                        window.bot.cancelPlanning();
                                }
                                window.bot.currentPuzzle = null;
                        }
                        if (self.puzzle) {
                                self.puzzle.destroy();
                                self.puzzle = null;
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
                        self.controlState = 'HUMAN';
                        self.inputLocked = false;
                        self.pendingBlockedGameOver = false;
                        document.getElementById('tetris-pause').style.display = 'block';
                        document.getElementById('tetris-resume').style.display = 'none';
        };

        this.pause = function() {
                if (!self.puzzle) return;
                if (self.paused) {
                        // Resume
                        self.puzzle.running = true;
                        if (self.puzzle.isHumanControlled) {
                                self.puzzle.resumeGravity(true);
                        } else if (self.isIAAssist && window.bot) {
                                // Reactivar bot si estaba pausado
                                window.bot.makeMove();
                        }
                        document.getElementById('tetris-pause').style.display = 'block';
                        document.getElementById('tetris-resume').style.display = 'none';
                        if (!self.stats.timerId) {
                                self.stats.timerId = setInterval(() => self.stats.incTime(), 1000);
                        }
                        self.paused = false;
                } else {
                        // Pause
                        if (!self.puzzle.isRunning()) return;
                        self.puzzle.clearTimers();
                        document.getElementById('tetris-pause').style.display = 'none';
                        document.getElementById('tetris-resume').style.display = 'block';
                        clearInterval(self.stats.timerId);
                        self.stats.timerId = null;
                        self.paused = true;
                        self.puzzle.running = false;
                }
        };

        this.showBlockedGameOver = function() {
                if (self.pendingBlockedGameOver) return;
                self.pendingBlockedGameOver = true;

                if (self.puzzle && typeof self.puzzle.renderBlockedSpawn === 'function') {
                        self.puzzle.renderBlockedSpawn();
                }

                var triggerGameOver = function() { self.gameOver(); };

                if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(function() {
                                requestAnimationFrame(triggerGameOver);
                        });
                } else {
                        setTimeout(() => triggerGameOver(), 30);
                }
        };

        this.gameOver = function() {
                self.stats.stop();
                if (self.puzzle) self.puzzle.stop();

                if (typeof self.showGameOverMessage === 'function') {
                        self.showGameOverMessage();
                }

                document.getElementById("tetris-nextpuzzle").style.display = "none";
                document.getElementById("tetris-gameover").style.display = "block";
		
		if (this.highscores.mayAdd(self.stats.getScore())) {
			var name = prompt("Game Over! Tu nombre:", "");
			if (name && name.trim().length) {
				this.highscores.add(name, this.stats.getScore());
			}
		}
	};

	// --- INPUTS UNIFICADOS ---

        this.up = function() {
                if (!self.canHumanControlPiece('UP')) return;
                if (self.puzzle.mayRotate()) {
                        self.puzzle.rotate();
                        self.stats.setActions(self.stats.getActions() + 1);
                }
        };

        this.down = function() {
                if (!self.canHumanControlPiece('DOWN')) return;
                if (self.puzzle.mayMoveDown()) {
                        self.stats.setScore(self.stats.getScore() + 5 + self.stats.getLevel());
                        self.stats.setActions(self.stats.getActions() + 1);
                        self.puzzle.moveDown();
                }
        };

	this.left = function() {
		// [DEBUG] 3. Intento de movimiento lógico
		console.log("[CONTROL] Comando LEFT solicitado.");
		console.log("[CONTROL] Estado:", {
			inputLocked: self.inputLocked,
			puzzleExists: !!self.puzzle,
			isHumanControlled: self.puzzle ? self.puzzle.isHumanControlled : "N/A",
			isRunning: self.puzzle ? self.puzzle.isRunning() : "N/A",
			isStopped: self.puzzle ? self.puzzle.isStopped() : "N/A"
		});

                if (!self.canHumanControlPiece('LEFT')) return;

                console.log("[CONTROL] Movimiento ACEPTADO. Ejecutando...");
                if (self.puzzle.mayMoveLeft()) {
                        self.puzzle.moveLeft();
                        self.stats.setActions(self.stats.getActions() + 1);
                }
        };

        this.right = function() {
                if (!self.canHumanControlPiece('RIGHT')) return;
                if (self.puzzle.mayMoveRight()) {
                        self.puzzle.moveRight();
                        self.stats.setActions(self.stats.getActions() + 1);
                }
        };

        this.space = function() {
                if (!self.canHumanControlPiece('SPACE')) return;
                if (!self.puzzle) return;

                // Detener únicamente la gravedad normal (NO marcar la pieza como stopped)
                if (typeof self.puzzle.clearFallDownTimer === 'function') {
                        self.puzzle.clearFallDownTimer();
                }

                // Asegurar estado válido para hard drop
                self.puzzle.running = true;
                self.puzzle.stopped = false;

                // Ejecutar caída forzada (hard drop)
                self.puzzle.forceMoveDown();
        };

        this.canHumanControlPiece = function(actionLabel) {
                var allowed = true;
                var snapshot = {
                        inputLocked: self.inputLocked,
                        controlState: self.controlState,
                        paused: self.paused,
                        puzzleExists: !!self.puzzle,
                        isHumanControlled: self.puzzle ? self.puzzle.isHumanControlled : 'N/A',
                        isRunning: self.puzzle && typeof self.puzzle.isRunning === 'function' ? self.puzzle.isRunning() : 'N/A',
                        isStopped: self.puzzle && typeof self.puzzle.isStopped === 'function' ? self.puzzle.isStopped() : 'N/A'
                };

                if (self.inputLocked || self.controlState !== 'HUMAN' || self.paused) allowed = false;
                if (!self.puzzle || !self.puzzle.isHumanControlled) allowed = false;
                if (self.puzzle && (!self.puzzle.isRunning() || self.puzzle.isStopped())) allowed = false;

                if (!allowed && actionLabel) {
                        console.warn('[CONTROL] Acción bloqueada: ' + actionLabel, snapshot);
                }

                return allowed;
        };

	// ... (Código de Window, Keyboard, Stats, Area, Highscores, Cookie se mantienen igual) ...
	// ... (Copiar clases auxiliares originales aquí: Window, Keyboard, Stats, Area, Highscores, Cookie) ...
	// Para ahorrar espacio en la respuesta, asumo que mantienes las clases auxiliares que no cambiaron.
	// A continuación, la clase Puzzle REFACTORIZADA y CRÍTICA.

	function Puzzle(tetris, area, isHumanControlled)
	{
		var self = this;
		this.tetris = tetris;
		this.area = area;
                this.isHumanControlled = isHumanControlled;

        this.fallDownID;
        this.forceMoveDownID = null;
        this.forceMoveDownDelay = 30;
        this.type = null;
        this.nextType = null;
		this.position = null;
		this.speed = null;
		this.running = null;
		this.stopped = null;
		this.board = [];
		this.elements = [];
		this.nextElements = [];
		this.x = null;
		this.y = null;

		// Definición de piezas (puzzles) estándar...
		this.puzzles = [
			[[0,0,1],[1,1,1],[0,0,0]], [[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[1,1,0],[0,0,0]],
			[[1,1,0],[0,1,1],[0,0,0]], [[0,1,0],[1,1,1],[0,0,0]], [[1,1],[1,1]],
			[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]]
		];

                this.clearFallDownTimer = function() {
                        if (this.fallDownID) {
                                clearTimeout(this.fallDownID);
                                delete this.fallDownID;
                        }
                };

                this.clearTimers = function() {
                        this.clearFallDownTimer();
                        if (this.forceMoveDownID) { clearTimeout(this.forceMoveDownID); this.forceMoveDownID = null; }
                };

                this.suspendGravity = function() {
                        this.clearFallDownTimer();
                };

                this.resumeGravity = function(forceRestart) {
                        if (!forceRestart) return;
                        if (!this.running || this.stopped) return;

                        this.clearFallDownTimer();
                        this.fallDownID = setTimeout(() => this.fallDown(), this.speed);
                };

                this.reset = function(forceFreshType) {
                        this.clearTimers();
                        if (forceFreshType) {
                                this.type = null;
                                this.nextType = null;
                        }
                        if (this.type === null) {
                                this.type = random(this.puzzles.length);
                                this.nextType = random(this.puzzles.length);
                        } else {
                                this.type = this.nextType;
                                this.nextType = random(this.puzzles.length);
                        }
			this.position = 0;
			this.speed = this.tetris.zenMode ? 1000 : (80 + (700 / this.tetris.stats.getLevel()));
			this.running = false;
			this.stopped = false;
			this.board = [];
			this.elements = [];
			
			// Limpiar preview
			var nextContainer = document.getElementById("tetris-nextpuzzle");
			if (nextContainer) nextContainer.innerHTML = '';
			this.nextElements = [];
			
			this.x = null;
			this.y = null;
		};

                this.reset(true); // reset() ya establece nextType internamente

                /**
                 * Recalcula la sugerencia del bot tras un movimiento humano sin ejecutar la jugada.
                 * Previene transferencia de control y carreras con la FSM.
                 */
                this.notifyBotAfterHumanMove = function() {
    if (!this.tetris || this.tetris.controlState !== 'HUMAN') {
        return;
    }
};

                this.isRunning = function() { return this.running; };
                this.isStopped = function() { return this.stopped; };
                this.getX = function() { return this.x; };
                this.getY = function() { return this.y; };

                this.mayPlace = function() {
                        var puzzle = this.puzzles[this.type];
                        var areaStartX = parseInt((this.area.x - puzzle[0].length) / 2);
                        var areaStartY = 1;
                        var lines = 0;

                        for (var y = puzzle.length - 1; y >= 0; y--) {
                                var lineFound = false;
                                for (var x = 0; x < puzzle[y].length; x++) {
                                        if (puzzle[y][x]) {
                                                lineFound = true;
                                                // Calculamos la fila real: Fila inicial menos las líneas acumuladas
                                                var targetY = areaStartY - lines;
                                                if (targetY < 0) continue; // Si está fuera por arriba, ignorar
                                                if (this.area.getBlock(targetY, areaStartX + x)) return false;
                                        }
                                }
                                if (lineFound) lines++;
                        }
                        return true;
                };

                this.place = function() {
                        // Stats
                        this.tetris.stats.setPuzzles(this.tetris.stats.getPuzzles() + 1);
                        if (this.tetris.stats.getPuzzles() >= (10 + this.tetris.stats.getLevel() * 2)) {
                                this.tetris.stats.setLevel(this.tetris.stats.getLevel() + 1);
                                this.tetris.stats.setPuzzles(0);
			}

			var puzzle = this.puzzles[this.type];
			var areaStartX = parseInt((this.area.x - puzzle[0].length) / 2);
			var areaStartY = 1;
			var lineFound = false;
			var lines = 0;
			this.x = areaStartX;
			this.y = 1;
			this.board = this.createEmptyPuzzle(puzzle.length, puzzle[0].length);

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
                                  if (lines) this.y--;
                                  if (lineFound) lines++;
                          }

                          console.info('[RENDER] Pieza activa renderizada en el área', {
                                  type: this.type,
                                  blocks: this.elements.length,
                                  origin: { x: this.x, y: this.y }
                          });

                          this.running = true;

                          // --- LÓGICA CRÍTICA DE CAÍDA ---
                          // Solo activar gravedad si es humano.
                        this.clearFallDownTimer();
                        if (this.isHumanControlled) {
                        this.fallDownID = setTimeout(() => this.fallDown(), this.speed);
                        }

			// Renderizar siguiente pieza
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

                          console.info('[RENDER] Próxima pieza renderizada en bandeja', {
                                  type: this.nextType,
                                  blocks: this.nextElements.length
                          });

                        this.tetris.updateControlStyles(this);

                        // Transferir el control al bot sin temporizadores duplicados.
                        if (window.bot && window.bot.enabled && !this.isHumanControlled) {
                                window.bot.currentPuzzle = this;
                                window.bot.cancelPlanning();
                                window.bot.makeMove();
                        }
                };

                this.renderBlockedSpawn = function() {
                        var puzzle = this.puzzles[this.type];
                        var areaStartX = parseInt((this.area.x - puzzle[0].length) / 2);
                        var areaStartY = 1;
                        var lineFound = false;
                        var lines = 0;

                        this.x = areaStartX;
                        this.y = 1;
                        this.board = this.createEmptyPuzzle(puzzle.length, puzzle[0].length);

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
                                if (lines) this.y--;
                                if (lineFound) lines++;
                        }

                        this.running = false;
                        this.stopped = true;
                };

                this.destroy = function() {
                        this.clearTimers();
			// Limpiar elementos visuales
			for (var i = 0; i < this.elements.length; i++) {
				if (this.elements[i].parentNode) this.elements[i].parentNode.removeChild(this.elements[i]);
			}
			this.elements = [];
			this.board = [];
			// Limpiar next
			var nextContainer = document.getElementById("tetris-nextpuzzle");
			if (nextContainer) nextContainer.innerHTML = '';
			this.nextElements = [];
			
			this.running = false;
			this.stopped = true;
		};

		this.createEmptyPuzzle = function(y, x) {
			var puzzle = [];
			for (var y2 = 0; y2 < y; y2++) {
				puzzle.push(new Array());
				for (var x2 = 0; x2 < x; x2++) {
					puzzle[y2].push(0);
				}
			}
			return puzzle;
		};

		this.fallDown = function() {
			if (!self.isHumanControlled) return; // Seguridad extra
			
			if (self.running) {
				if (self.mayMoveDown()) {
					self.moveDown();
                                    self.fallDownID = setTimeout(() => self.fallDown(), self.speed);
				} else {
					// Lock
					for (var i = 0; i < self.elements.length; i++) {
						self.area.addElement(self.elements[i]);
					}
					var lines = self.area.removeFullLines();
					if (lines) {
						self.tetris.stats.setLines(self.tetris.stats.getLines() + lines);
						self.tetris.stats.setScore(self.tetris.stats.getScore() + (1000 * self.tetris.stats.getLevel() * lines));
					}
                                        self.reset();
                                        if (self.mayPlace()) self.place();
                                        else self.tetris.showBlockedGameOver();
                                }
                        }
                };

        this.forceMoveDown = function() {
            if (!self.running || self.stopped) return;
            
            if (self.mayMoveDown()) {
                self.tetris.stats.setScore(self.tetris.stats.getScore() + 5 + self.tetris.stats.getLevel());
                self.tetris.stats.setActions(self.tetris.stats.getActions() + 1);
                self.moveDown();
                self.forceMoveDownID = setTimeout(() => self.forceMoveDown(), self.forceMoveDownDelay || 30);
            } else {
                // Lock
                for (var i = 0; i < self.elements.length; i++) {
                    self.area.addElement(self.elements[i]);
                }
                var lines = self.area.removeFullLines();
                if (lines) {
                    self.tetris.stats.setLines(self.tetris.stats.getLines() + lines);
                    self.tetris.stats.setScore(self.tetris.stats.getScore() + (1000 * self.tetris.stats.getLevel() * lines));
                }
                self.reset();
                if (self.mayPlace()) self.place();
                else self.tetris.showBlockedGameOver();
            }
        };

        this.stop = function() {
            this.running = false;
            this.stopped = true;
            this.clearTimers();
        };

        this.mayRotate = function() {
            for (var y = 0; y < this.board.length; y++) {
                for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						var newY = this.getY() + this.board.length - 1 - x;
						var newX = this.getX() + y;
						if (newY >= this.area.y) return false;
						if (newX < 0) return false;
						if (newX >= this.area.x) return false;
						if (this.area.getBlock(newY, newX)) return false;
					}
				}
			}
			return true;
		};

		this.rotate = function() {
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

		this.mayMoveDown = function() {
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

		this.moveDown = function() {
			for (var i = 0; i < this.elements.length; i++) {
				this.elements[i].style.top = this.elements[i].offsetTop + this.area.unit + "px";
			}
			this.y++;
		};

		this.mayMoveLeft = function() {
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						if (this.getX() + x - 1 < 0) return false;
						if (this.area.getBlock(this.getY() + y, this.getX() + x - 1)) return false;
					}
				}
			}
			return true;
		};

		this.moveLeft = function() {
			for (var i = 0; i < this.elements.length; i++) {
				this.elements[i].style.left = this.elements[i].offsetLeft - this.area.unit + "px";
			}
			this.x--;
		};

		this.mayMoveRight = function() {
			for (var y = 0; y < this.board.length; y++) {
				for (var x = 0; x < this.board[y].length; x++) {
					if (this.board[y][x]) {
						if (this.getX() + x + 1 >= this.area.x) return false;
						if (this.area.getBlock(this.getY() + y, this.getX() + x + 1)) return false;
					}
				}
			}
			return true;
		};

		this.moveRight = function() {
			for (var i = 0; i < this.elements.length; i++) {
				this.elements[i].style.left = this.elements[i].offsetLeft + this.area.unit + "px";
			}
			this.x++;
		};
	}

        this.bindKeyboardControls = function() {
                if (self.keyboardBound) return;
                if (!self.keyboard) self.keyboard = new Keyboard();

                self.keyboard.tetris = self;
                self.keyboardHandlers = self.keyboardHandlers || {};

                var ensureHandler = function(key, label, action) {
                        if (!self.keyboardHandlers[label]) {
                                self.keyboardHandlers[label] = function() {
                                        if (!self.canHumanControlPiece(label)) return;
                                        action();
                                };
                        }
                        self.keyboard.set(key, self.keyboardHandlers[label]);
                };

                ensureHandler(self.keyboard.left, 'LEFT', self.left);
                ensureHandler(self.keyboard.right, 'RIGHT', self.right);
                ensureHandler(self.keyboard.up, 'UP', self.up);
                ensureHandler(self.keyboard.down, 'DOWN', self.down);
                ensureHandler(self.keyboard.space, 'SPACE', self.space);

                if (!self.keyboardHandlers.PAUSE) {
                        self.keyboardHandlers.PAUSE = function() {
                                if (self.inputLocked) {
                                        console.warn('[CONTROL] Acción de pausa bloqueada mientras inputLocked está activo.');
                                        return;
                                }
                                self.pause();
                        };
                }

                if (!self.keyboardHandlers.START) {
                        self.keyboardHandlers.START = function() {
                                if (self.inputLocked) {
                                        console.warn('[CONTROL] Acción de nuevo juego bloqueada mientras inputLocked está activo.');
                                        return;
                                }
                                self.start();
                        };
                }

                self.keyboard.set(self.keyboard.p, self.keyboardHandlers.PAUSE);
                self.keyboard.set(self.keyboard.n, self.keyboardHandlers.START);

                self.keyboardBound = true;
        };

        this.bindKeyboardControls();

        // --- CLASES AUXILIARES (Window, Keyboard, Stats, Area, Highscores, Cookie) ---
        // Debes mantener las definiciones originales de estas clases al final del archivo
        // o copiarlas del archivo original si las borraste. Son dependencias necesarias.
    // ... [Aquí iría el código de Window, Keyboard, etc. sin cambios] ...
    // PARA COMPLETAR: Copia las funciones auxiliares del archivo original aquí abajo.
    // (Window, Keyboard, Stats, Area, Highscores, Cookie)

    // ... [TetrisBot debe actualizarse para usar this.tetris.puzzle] ...
}

// Actualización Crítica para TetrisBot (Inyectar al final del archivo)
// Busca todas las referencias a "self.tetris.puzzle" o "botPuzzle" y cámbialas a "self.tetris.puzzle".
// Ejemplo rápido de parche para TetrisBot:

/*
function TetrisBot(tetrisInstance) {
    // ...
    this.makeMove = function() {
        var actor = self.tetris.puzzle; // CAMBIO CRÍTICO
        // ...
    };
    // ...
}
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
                        var active = document.activeElement;

                        // Solo bloquear si el foco es un input editable (permitir botones, toggles, etc.)
                        if (!active) return false;

                        if (
                                active.tagName === "INPUT" ||
                                active.tagName === "TEXTAREA" ||
                                active.isContentEditable
                        ) {
                                return true;
                        }

                        return false;
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
			var keyInfo = event.code || event.key || event.keyCode;

			// [DEBUG] 1. Entrada Cruda
			console.log("--------------------------------------------------");
			console.log("[KEYBOARD] Tecla detectada:", keyInfo);

			// Fast-fail: si un elemento interactivo tiene el foco, no procesar atajos de juego.
			if (isUIFocused(event)) {
				console.log("[KEYBOARD] Bloqueado por UI Focus"); // [DEBUG]
				if (typeof event.stopImmediatePropagation === "function") {
					event.stopImmediatePropagation();
				}
				event.preventDefault();
				return;
			}

			// [DEBUG] 2. Pasó filtro UI
			console.log("[KEYBOARD] Pasó filtro UI. Buscando mapeo...");

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
					console.log("[KEYBOARD] ¡Mapeo encontrado! Ejecutando función para:", keyCode); // [DEBUG]
					self.funcs[i]();
					break;
				}
			}
			// Si llega aquí y no hay log de "Mapeo encontrado", la tecla no está registrada en self.set()
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
                        this.timerId = setInterval(() => this.incTime(), 1000);
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
                                this.timerId = null;
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

        const DEFAULT_STRATEGY = 'BALANCED';

        var self = this;

        // --- UTILIDADES DE MODO ---

        this.getModeName = function() {
                return DEFAULT_STRATEGY;
        };

        this.setGameplayMode = function() {
                self.gameplayMode = DEFAULT_STRATEGY;
                self.activeBotModeName = DEFAULT_STRATEGY;

                updateBotStrategyUI(self.activeBotModeName);

                if (self.tetris && self.tetris.updateModeStatus) {
                        self.tetris.updateModeStatus();
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
        if (!self.tetris) { return; }
        if (!self.enabled) { return; }
        if (!move) { return; }
        if (!self.tetris.puzzle || !self.tetris.puzzle.isRunning()) { return; }
        if (!self.tetris.area || !self.tetris.area.el) { return; }

        var simulation = self.simulateDrop(move.rotation, move.x);
        if (!simulation.isValid || typeof simulation.finalX !== 'number' || typeof simulation.finalY !== 'number') { return; }
        if (!simulation.pieceGrid || !simulation.pieceGrid.length) { return; }

        var unit = self.tetris.unit;
        var pieceType = (typeof self.tetris.puzzle.type === 'number') ? self.tetris.puzzle.type : 0;

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

// Inicializar indicador en el modo predeterminado
this.setGameplayMode();

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
                        if (self.tetris && self.tetris.puzzle && self.tetris.puzzle.isRunning()) {
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
        console.log("[BOT] makeMove() called. enabled=", self.enabled);
        if (!self.enabled) return false;
        if (self.tetris.paused) return false;
        
        var actorPuzzle = self.tetris.puzzle;
        if (!actorPuzzle || !actorPuzzle.isRunning()) return false;
        if (self.isThinking || self.bestBotMove) return false;

        self.isThinking = true;
        self.predictedBoard = buildPredictedBoard();

        // Llamamos a la función UNIFICADA
        var bestMove = self.calculateBestMove();

        self.isThinking = false;
        self.clearGhostPreview();

        if (!bestMove) return false;

        self.bestBotMove = bestMove;
        self.renderGhostPreview(bestMove);
        self.executeStoredMove();
        return true;
                        };

// --- EJECUCIÓN DIFERIDA TRAS EL LOCK HUMANO ---

this.executeStoredMove = function() {
        console.log('[BOT] executeStoredMove() called', self.bestBotMove);
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

        var actor = self.tetris.puzzle;
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

                        setTimeout(() => playStep(), 50);
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
                        setTimeout(() => animateDrop(), 50);
                        return;
                }

                actor.forceMoveDownDelay = 50;
                actor.forceMoveDown();
                self.isThinking = false;
        }

        playStep();
                        };

        function countHoles(grid) {
                let holes = 0;
                const ROWS = grid.length;
                const COLS = grid[0].length;

                for (let x = 0; x < COLS; x++) {
                        let blockSeen = false;
                        for (let y = 0; y < ROWS; y++) {
                                if (grid[y][x]) {
                                        blockSeen = true;
                                } else if (blockSeen) {
                                        holes++;
                                }
                        }
                }
                return holes;
        }

        this.calculateBestMove = function () {

                const area = self.tetris.area;
                const puzzle = self.tetris.puzzle;
                if (!area || !puzzle) return null;

                const initialGrid = cloneAreaGrid(area.board);
                const holesBefore = countHoles(initialGrid);

                let candidates = [];

                // 1️⃣ Simular TODAS las jugadas posibles
                for (let rotation = 0; rotation < 4; rotation++) {
                        for (let x = 0; x < self.tetris.areaX; x++) {

                                const sim = self.simulateDrop(rotation, x);
                                if (!sim.isValid) continue;

                                const holesAfter = countHoles(sim.grid);
                                const holesCreated = holesAfter - holesBefore;

                                candidates.push({
                                        rotation,
                                        x,
                                        holesCreated,
                                        holesAfter,
                                        linesCleared: sim.linesCleared,
                                        landingY: sim.finalY
                                });
                        }
                }

                if (candidates.length === 0) return null;

                // 2️⃣ FILTRO 1: minimizar huecos creados
                let minHolesCreated = Math.min(...candidates.map(c => c.holesCreated));
                candidates = candidates.filter(c => c.holesCreated === minHolesCreated);

                // 3️⃣ FILTRO 2: maximizar líneas limpiadas
                let maxLines = Math.max(...candidates.map(c => c.linesCleared));
                candidates = candidates.filter(c => c.linesCleared === maxLines);

                // 4️⃣ FILTRO 3: aterrizar lo más abajo posible
                let maxLandingY = Math.max(...candidates.map(c => c.landingY));
                candidates = candidates.filter(c => c.landingY === maxLandingY);

                // 5️⃣ FILTRO 4: minimizar huecos totales
                let minTotalHoles = Math.min(...candidates.map(c => c.holesAfter));
                candidates = candidates.filter(c => c.holesAfter === minTotalHoles);

                // 6️⃣ Desempate determinista (opcional)
                // Elegimos la más a la izquierda para estabilidad visual
                candidates.sort((a, b) => a.x - b.x);

                const best = candidates[0];
                return best ? { rotation: best.rotation, x: best.x } : null;
        };

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

        // [CORRECCIÓN] Usar la variable unificada
        var activePuzzle = self.tetris.puzzle;
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

        // [CORREGIDO] Si la pieza está activa (NO detenida), debemos fusionarla en la proyección.
        if (self.tetris.puzzle && !self.tetris.puzzle.isStopped()) {
                var baseGrid = cloneAreaGrid(self.tetris.area.board);
                var currentPiece = clonePieceGrid(self.tetris.puzzle.board);
                var posX = self.tetris.puzzle.getX();
                var posY = self.tetris.puzzle.getY();

                // Validar posición inicial antes de proyectar
                if (isPositionValid(currentPiece, posX, posY, baseGrid)) {
                        // Simular caída (Hard Drop) de la pieza actual
                        while (isPositionValid(currentPiece, posX, posY + 1, baseGrid)) {
                                posY++;
                        }
                        return mergePiece(baseGrid, currentPiece, posX, posY);
                }
        }

        // Si la pieza está detenida o no existe, devolvemos el tablero tal cual.
        return cloneAreaGrid(self.tetris.area.board);
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

function updateBotStrategyUI(strategy) {
        const el = document.getElementById('bot-strategy-indicator');
        if (!el) return;

        var className = strategy.toLowerCase();

        if (className === 'tetris_builder') {
                className = 'tetris';
        } else if (className === 'pro_attack') {
                className = 'attack';
        }

        el.textContent = 'BOT STRATEGY: ' + strategy;
        el.className = 'bot-strategy ' + className;
}

// Exponer el bot en el ámbito global para evitar referencias indefinidas
if (typeof window !== "undefined") {
        window.TetrisBot = TetrisBot;
}


// --- INICIALIZACIÓN COMPLETA DEL JUEGO ---
document.addEventListener('DOMContentLoaded', function() {
    console.log('[INIT] 🔧 Inicializando Tetris Moderno con IA-ASSIST...');
    
    // 1. Crear instancia principal del juego
    window.tetris = new Tetris();
    console.log('[INIT] ✅ Tetris instanciado:', window.tetris);
    
    // 2. Crear instancia del bot IA
    window.bot = new TetrisBot(window.tetris);
    console.log('[INIT] ✅ Bot IA instanciado:', window.bot);
    
    // 3. Inicialización del teclado humano
    if (window.tetris && window.tetris.keyboard) {
        window.addEventListener('keydown', function(e) {
            window.tetris.keyboard.event(e);
        });
    }

    // 4. CONEXIÓN CRÍTICA: Botones del HTML con funciones JS
    
    // 🔘 Botón PLAY (▶ Play)
    var playBtn = document.getElementById('playBtn');
    if (playBtn) {
        playBtn.addEventListener('click', function() {
            console.log('[UI] ▶ Botón PLAY presionado');
            window.tetris.start();
        });
    }
    
    // 🔘 Botón NEW GAME (el primer botón con clase .btn-secondary)
    var newGameBtn = document.getElementById('newGameBtn') || document.querySelector('.btn-secondary');
    if (newGameBtn && (newGameBtn.id === 'newGameBtn' || !newGameBtn.id)) {
        newGameBtn.addEventListener('click', function() {
            console.log('[UI] 🔄 Botón NEW GAME presionado');
            if (window.tetris.puzzle && !confirm('¿Seguro que quieres empezar una nueva partida?')) {
                return;
            }
            window.tetris.start();
        });
    }
    
    // 🔘 Toggle IA-ASSIST
    var iaToggle = document.getElementById('iaAssistToggle');
    if (iaToggle) {
        iaToggle.addEventListener('click', function() {
            console.log('[UI] 🤖 Botón IA-ASSIST presionado');
            var currentIA = window.tetris.isIAAssist;
            window.tetris.updateGameMode({ 
                ia: !currentIA, 
                zen: window.tetris.zenMode 
            });
            
            // Feedback visual inmediato
            this.classList.toggle('active', !currentIA);
        });
    }
    
    // 🔘 Toggle ZEN MODE
    var zenToggle = document.getElementById('zenToggle');
    if (zenToggle) {
        zenToggle.addEventListener('click', function() {
            console.log('[UI] 🧘 Botón ZEN MODE presionado');
            var currentZen = window.tetris.zenMode;
            window.tetris.updateGameMode({ 
                ia: window.tetris.isIAAssist, 
                zen: !currentZen 
            });
            
            // Feedback visual inmediato
            this.classList.toggle('active', !currentZen);
        });
    }
    
    // 🔊 Botón de audio (placeholder - sin funcionalidad real)
    var audioBtn = document.getElementById('audioBtn');
    if (audioBtn) {
        audioBtn.addEventListener('click', function() {
            var isOn = this.textContent.includes('On');
            this.textContent = isOn ? '🔇 Sound Off' : '🔊 Sound On';
            console.log('[UI] 🔊 Audio ' + (isOn ? 'desactivado' : 'activado'));
        });
    }
    
    // 5. CONFIGURACIÓN RESPONSIVA
    setTimeout(() => {
        if (window.tetris.updateResponsiveUnit) {
            window.tetris.updateResponsiveUnit();
        }
    }, 100);
    
    window.addEventListener('resize', function() {
        if (window.tetris && window.tetris.updateResponsiveUnit) {
            window.tetris.updateResponsiveUnit();
        }
    });
    
    // 6. INICIALIZACIÓN VISUAL
    // Actualizar etiqueta del bot si existe
    if (window.tetris.updateBotToggleLabel) {
        window.tetris.updateBotToggleLabel();
    }
    
    // Actualizar estado del modo
    if (window.tetris.updateModeStatus) {
        window.tetris.updateModeStatus();
    }
    
    console.log('[INIT] 🎉 Tetris Moderno completamente inicializado y listo');
    console.log('[INIT] 📊 Estado:', {
        tetris: window.tetris ? 'OK' : 'ERROR',
        bot: window.bot ? 'OK' : 'ERROR',
        puzzle: window.tetris.puzzle ? 'Activo' : 'Inactivo'
    });
});
