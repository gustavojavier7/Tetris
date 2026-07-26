class VersusController {
  constructor() {
    const humanRoot = document.querySelector('.human-side');
    const cpuRoot = document.querySelector('.cpu-side');
    const humanUI = document.querySelector('.human-ui');
    const cpuUI = document.querySelector('.cpu-ui');
    const sharedControls = document.querySelector('.shared-controls');
    this.overlay = document.querySelector('.versus-overlay');

    if (!humanRoot || !cpuRoot || !humanUI || !cpuUI || !sharedControls || !this.overlay) {
      throw new Error('[AGENT][versus] Fast-Fail: layout versus incompleto.');
    }

    this.finished = false;
    this.human = new TetrisGame(humanRoot, {
      isCPU: false,
      playerName: 'YOU',
      uiRoot: humanUI,
      controlsRoot: sharedControls,
      onAttack: lines => this.route(this.cpu, lines),
      onDefeat: () => this.finish('CPU')
    });
    this.cpu = new TetrisGame(cpuRoot, {
      isCPU: true,
      playerName: 'CPU',
      uiRoot: cpuUI,
      onAttack: lines => this.route(this.human, lines),
      onDefeat: () => this.finish('YOU')
    });

    this.cpu.setIAAssist(true);
    this.bindControls();
    this.bindKeyboard();
    this.human.start();
    this.cpu.start();
    this.bindScale();
  }

  route(target, lines) {
    if (!(target instanceof TetrisGame) || !Number.isInteger(lines) || lines <= 0 || this.finished) return;
    target.enqueueGarbage(lines);
  }

  togglePause() {
    if (this.finished) return;
    const shouldPause = !this.human.paused || !this.cpu.paused;
    this.human.setPaused(shouldPause);
    this.cpu.setPaused(shouldPause);
  }

  reset() {
    this.finished = false;
    this.overlay.hidden = true;
    this.human.setIAAssist(false);
    this.human.reset();
    this.cpu.reset();
    this.cpu.setIAAssist(true);
  }

  finish(winner) {
    if (this.finished) return;
    this.finished = true;
    this.human.setPaused(true);
    this.cpu.setPaused(true);
    this.overlay.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = `${winner} WINS`;
    const message = document.createElement('p');
    message.textContent = winner === 'YOU' ? 'Victoria del jugador' : 'Victoria de la CPU';
    const retry = document.createElement('button');
    retry.className = 'btn-primary';
    retry.textContent = '↻ NEW MATCH';
    retry.onclick = () => this.reset();
    const panel = document.createElement('section');
    panel.className = 'versus-result';
    panel.append(title, message, retry);
    this.overlay.append(panel);
    this.overlay.hidden = false;
  }

  bindControls() {
    const playBtn = this.human.els.playBtn;
    const newGameBtn = this.human.els.newGameBtn;
    const iaAssistToggle = this.human.els.iaAssistToggle;
    if (!playBtn || !newGameBtn || !iaAssistToggle) {
      throw new Error('[AGENT][versus] Fast-Fail: controles compartidos incompletos.');
    }

    playBtn.onclick = () => this.togglePause();
    newGameBtn.onclick = () => this.reset();
    iaAssistToggle.onclick = () => this.human.setIAAssist(!this.human.iaAssist);
  }

  bindKeyboard() {
    document.addEventListener('keydown', event => {
      if (event.key.toUpperCase() === 'P') {
        event.preventDefault();
        this.togglePause();
        return;
      }
      this.human.handleKeyDown(event);
    });
    document.addEventListener('keyup', event => this.human.handleKeyUp(event));
  }

  bindScale() {
    const syncVersusBoards = () => {
      syncBoardScale(this.cpu, 0.7);
      syncBoardScale(this.human);
    };
    requestAnimationFrame(syncVersusBoards);

    window.addEventListener('resize', () => {
      clearTimeout(window.resizeTimer);
      window.resizeTimer = setTimeout(syncVersusBoards, 50);
    });
    window.addEventListener('orientationchange', syncVersusBoards);
    document.addEventListener('fullscreenchange', syncVersusBoards);
  }
}

window.addEventListener('load', () => {
  try {
    window.versus = new VersusController();
  } catch (error) {
    console.error(error);
  }
});
