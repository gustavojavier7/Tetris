// Core Tetris model: shared discrete simulation utilities.
// Coordinate system: grid[y][x] with y growing downward (0 at the top).
(function(globalScope) {
  function cloneGrid(grid) {
    return grid.map(function(row) { return row.slice(); });
  }

  function normalizeCells(rot) {
    return (rot || []).map(function(cell) {
      if (Array.isArray(cell)) {
        return { dx: cell[0], dy: cell[1] };
      }
      return { dx: cell.dx, dy: cell.dy };
    });
  }

  function placeable(grid, pieceCells, x, y, W, H) {
    for (var i = 0; i < pieceCells.length; i++) {
      var cell = pieceCells[i];
      var gx = x + cell.dx;
      var gy = y + cell.dy;
      if (gx < 0 || gx >= W) return false;
      if (gy >= H) return false;
      if (gy >= 0 && grid[gy][gx]) return false;
    }
    return true;
  }

  function gravityY(grid, pieceCells, x, W, H, startY) {
    var minDy = pieceCells.reduce(function(min, c) { return Math.min(min, c.dy); }, 0);
    var y = typeof startY === 'number' ? startY : -minDy;
    if (!placeable(grid, pieceCells, x, y, W, H)) return null;
    while (placeable(grid, pieceCells, x, y + 1, W, H)) {
      y += 1;
    }
    return y;
  }

  function applyPlacement(grid, pieceCells, x, y) {
    var newGrid = cloneGrid(grid);
    for (var i = 0; i < pieceCells.length; i++) {
      var cell = pieceCells[i];
      var gx = x + cell.dx;
      var gy = y + cell.dy;
      if (gy >= 0 && gy < newGrid.length && gx >= 0 && gx < newGrid[gy].length) {
        newGrid[gy][gx] = 1;
      }
    }
    return newGrid;
  }

  function completeLines(grid, W) {
    var lines = [];
    for (var y = 0; y < grid.length; y++) {
      var filled = true;
      for (var x = 0; x < W; x++) {
        if (!grid[y][x]) { filled = false; break; }
      }
      if (filled) lines.push(y);
    }
    return lines;
  }

  function clearLines(grid, W, H) {
    var newGrid = [];
    var cleared = 0;
    for (var y = grid.length - 1; y >= 0; y--) {
      var filled = true;
      for (var x = 0; x < W; x++) {
        if (!grid[y][x]) { filled = false; break; }
      }
      if (filled) {
        cleared++;
      } else {
        newGrid.unshift(grid[y].slice());
      }
    }
    while (newGrid.length < H) {
      var emptyRow = new Array(W).fill(0);
      newGrid.unshift(emptyRow);
    }
    return { grid: newGrid, cleared: cleared };
  }

  function holeSet(grid, W, H) {
    var holes = new Set();
    for (var x = 0; x < W; x++) {
      var solidSeen = false;
      for (var y = 0; y < H; y++) {
        if (grid[y][x]) {
          solidSeen = true;
        } else if (solidSeen) {
          holes.add(x + ',' + y);
        }
      }
    }
    return holes;
  }

  function newHoles(beforeGrid, afterGrid, W, H) {
    var before = holeSet(beforeGrid, W, H);
    var after = holeSet(afterGrid, W, H);
    var count = 0;
    after.forEach(function(key) {
      if (!before.has(key)) count++;
    });
    return count;
  }

  function peakCell(grid, W, H) {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (grid[y][x]) return { x: x, y: y };
      }
    }
    return null;
  }

  function pieceCellsGlobal(pieceCells, x, y) {
    return pieceCells.map(function(c) { return { x: x + c.dx, y: y + c.dy }; });
  }

  function minManhattanToCell(pieceCells, x, y, cell) {
    if (!cell) return 0;
    var globals = pieceCellsGlobal(pieceCells, x, y);
    var best = Infinity;
    for (var i = 0; i < globals.length; i++) {
      var g = globals[i];
      var dist = Math.abs(g.x - cell.x) + Math.abs(g.y - cell.y);
      if (dist < best) best = dist;
    }
    return best === Infinity ? 0 : best;
  }

  function __selfTest() {
    var ok = true;
    var W = 10, H = 20;
    var empty = Array.from({ length: H }, function() { return Array(W).fill(0); });
    var oPiece = normalizeCells([[0,0],[1,0],[0,1],[1,1]]);
    var landingY = gravityY(empty, oPiece, 0, W, H);
    console.log('[SELFTEST] landingY for O at x=0:', landingY);
    if (landingY !== H - 2) ok = false;

    var fullGrid = cloneGrid(empty);
    fullGrid[H - 1] = Array(W).fill(1);
    var lines = completeLines(fullGrid, W);
    console.log('[SELFTEST] complete lines:', lines);
    if (lines.length !== 1 || lines[0] !== H - 1) ok = false;

    var cleared = clearLines(fullGrid, W, H);
    console.log('[SELFTEST] cleared count:', cleared.cleared);
    if (cleared.cleared !== 1 || cleared.grid.length !== H) ok = false;

    return ok;
  }

  var api = {
    cloneGrid: cloneGrid,
    normalizeCells: normalizeCells,
    placeable: placeable,
    gravityY: gravityY,
    applyPlacement: applyPlacement,
    completeLines: completeLines,
    clearLines: clearLines,
    holeSet: holeSet,
    newHoles: newHoles,
    peakCell: peakCell,
    pieceCellsGlobal: pieceCellsGlobal,
    minManhattanToCell: minManhattanToCell,
    __selfTest: __selfTest
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof self !== 'undefined') {
    self.TetrisModel = api;
  }
  if (typeof window !== 'undefined') {
    window.TetrisModel = api;
  }

  if (typeof console !== 'undefined') {
    console.log('[TetrisModel] self-test result:', __selfTest());
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
