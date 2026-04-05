// =============================================================================
// Tron/Cyberpunk Pong — game.js
// Entry point. Owns window.pongState, the game loop, input handling,
// physics (host only), and network orchestration.
//
// Architecture:
//   Host  — runs all physics, sends authoritative state to guest each frame.
//   Guest — applies host state, runs only local paddle movement, sends Y.
//
// Loaded by index.html as <script type="module" src="src/game.js">.
// =============================================================================

import { THEME } from './theme.js';
import { render, MENU_BUTTONS, LOBBY_GUEST_BUTTONS, GAMEOVER_BUTTONS } from './renderer.js';
import {
  initAudio, playPaddleHit, playWallBounce, playScore,
  playGameStart, playGameEnd, playCountdownBeep, playConnect, playDisconnect,
} from './audio.js';
import {
  generateRoomCode, createRoom, joinRoom,
  sendToGuest, sendToHost,
  onData, onDisconnect as onNetworkDisconnect, onNetworkError,
  disconnect,
} from './network.js';

// ---------------------------------------------------------------------------
// Canvas setup — grabbed once, reused every frame
// ---------------------------------------------------------------------------

const canvas = document.getElementById('pong-canvas');
const ctx    = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Shorthand constants from THEME
// ---------------------------------------------------------------------------

const W  = THEME.CANVAS_WIDTH;
const H  = THEME.CANVAS_HEIGHT;

const PADDLE_WIDTH     = THEME.PADDLE_WIDTH;
const PADDLE_HEIGHT    = THEME.PADDLE_HEIGHT;
const PADDLE_X_LEFT    = THEME.PADDLE_X_LEFT;
const PADDLE_X_RIGHT   = THEME.PADDLE_X_RIGHT;
const PADDLE_SPEED     = THEME.PADDLE_SPEED;
const PADDLE_Y_MIN     = THEME.PADDLE_Y_MIN;
const PADDLE_Y_MAX     = THEME.PADDLE_Y_MAX;

const BALL_RADIUS        = THEME.BALL_RADIUS;
const BALL_INITIAL_SPEED = THEME.BALL_INITIAL_SPEED;
const BALL_MAX_SPEED     = THEME.BALL_MAX_SPEED;
const BALL_SPEED_INC     = THEME.BALL_SPEED_INCREMENT;
const MAX_TRAIL_LENGTH   = THEME.MAX_TRAIL_LENGTH;

const MATCH_DURATION   = THEME.MATCH_DURATION;
const WINNING_SCORE    = THEME.WINNING_SCORE;
const HIT_FLASH_MS     = THEME.PADDLE_HIT_FLASH_MS;

const PARTICLE_COLORS    = THEME.PARTICLE_COLORS;
const PARTICLE_COUNT_HIT = THEME.PARTICLE_COUNT_HIT;
const PARTICLE_COUNT_SCR = THEME.PARTICLE_COUNT_SCORE;
const PARTICLE_SPD_MIN   = THEME.PARTICLE_SPEED_MIN;
const PARTICLE_SPD_MAX   = THEME.PARTICLE_SPEED_MAX;
const PARTICLE_LIFE_S    = THEME.PARTICLE_LIFE_MS / 1000;
const PARTICLE_SZ_MIN    = THEME.PARTICLE_SIZE_MIN;
const PARTICLE_SZ_MAX    = THEME.PARTICLE_SIZE_MAX;

// ---------------------------------------------------------------------------
// Runtime state (not part of pongState — internal to game.js)
// ---------------------------------------------------------------------------

let isHost       = false;   // true after createRoom, false after joinRoom
let isLocalMode  = false;   // true for local 2-player (same keyboard)
let audioReady   = false;   // becomes true after first user gesture
let lastTimestamp = 0;
let hitCount     = 0;       // paddle hits in current rally (for sound pitch)

// Countdown internals — tracks the wall-clock second boundaries
let countdownSecondStart = 0;  // performance.now() when current second began
let guestLastCountdown   = -1; // guest tracks countdown changes for audio

// Key state — set by keyboard listeners
const keys = {};

// ---------------------------------------------------------------------------
// Helper: ensure audio context is unblocked
// ---------------------------------------------------------------------------

function ensureAudio() {
  if (!audioReady) {
    initAudio();
    audioReady = true;
  }
}

// ---------------------------------------------------------------------------
// High score persistence
// ---------------------------------------------------------------------------

function loadHighScores() {
  try {
    return JSON.parse(localStorage.getItem('pong-highscores') || '[]');
  } catch (_) {
    return [];
  }
}

function saveHighScore(winnerName, winnerScore, opponentName) {
  const scores = loadHighScores();
  scores.push({
    name:     winnerName,
    score:    winnerScore,
    date:     new Date().toISOString(),
    opponent: opponentName,
  });
  scores.sort((a, b) => b.score - a.score);
  scores.splice(10);
  localStorage.setItem('pong-highscores', JSON.stringify(scores));
  return scores;
}

// ---------------------------------------------------------------------------
// Particle helpers
// ---------------------------------------------------------------------------

function spawnParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = PARTICLE_SPD_MIN + Math.random() * (PARTICLE_SPD_MAX - PARTICLE_SPD_MIN);
    window.pongState.particles.push({
      x,
      y,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed,
      alpha: 1,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      size:  PARTICLE_SZ_MIN + Math.random() * (PARTICLE_SZ_MAX - PARTICLE_SZ_MIN),
    });
  }
}

function updateParticles(dt) {
  const ps = window.pongState.particles;
  for (const p of ps) {
    p.x     += p.vx * dt * 60;
    p.y     += p.vy * dt * 60;
    p.alpha -= dt / PARTICLE_LIFE_S;
  }
  window.pongState.particles = ps.filter(p => p.alpha > 0);
}

// ---------------------------------------------------------------------------
// Ball reset
// ---------------------------------------------------------------------------

/**
 * Reset the ball to centre after a score.
 * The ball serves toward the scorer (who just won the point) so they get
 * the advantage of an incoming ball.
 *
 * @param {'left'|'right'} scorer
 */
function scorePoint(scorer) {
  const { players, ball } = window.pongState;

  if (scorer === 'left') {
    players.left.score++;
  } else {
    players.right.score++;
  }

  playScore();
  spawnParticles(scorer === 'left' ? 0 : W, ball.y, PARTICLE_COUNT_SCR);

  // Reset ball
  ball.x     = W / 2;
  ball.y     = H / 2;
  ball.speed = BALL_INITIAL_SPEED;
  ball.trail = [];
  hitCount   = 0;

  // Random angle [-45°, +45°], serve toward scorer
  const angle = (Math.random() * 0.5 - 0.25) * Math.PI;
  const dir   = scorer === 'left' ? -1 : 1; // negative = toward left, i.e., moving right-to-left
  // Actually serve TOWARD the scorer means the scorer has to receive it.
  // Scorer is the one who just got a point; they were the attacker.
  // Standard pong convention: serve toward the player who just conceded.
  // We match the spec comment: "dir toward scorer" means ball moves in dir.
  ball.vx = Math.cos(angle) * ball.speed * dir;
  ball.vy = Math.sin(angle) * ball.speed;
}

// ---------------------------------------------------------------------------
// Paddle collision (host-side physics only)
// ---------------------------------------------------------------------------

/**
 * Swept paddle collision check for one paddle.
 * Modifies ball velocity in-place on hit.
 *
 * @param {object} ball
 * @param {object} player    { y, paddleHeight, hitFlashUntil }
 * @param {number} paddleX   Center X of the paddle
 * @param {number} dt
 */
function checkPaddleCollision(ball, player, paddleX, dt) {
  const halfW   = PADDLE_WIDTH  / 2;
  const halfH   = player.paddleHeight / 2;
  const isLeft  = paddleX < W / 2;

  // Front face of paddle (the face the ball hits)
  const paddleFront = isLeft ? paddleX + halfW : paddleX - halfW;

  const ballMove = Math.abs(ball.vx * dt * 60);

  if (isLeft) {
    // Ball must be moving left, and its leading edge sweeps across the front face
    if (
      ball.vx < 0 &&
      ball.x - BALL_RADIUS <= paddleFront &&
      ball.x - BALL_RADIUS + ballMove >= paddleFront
    ) {
      if (ball.y >= player.y - halfH && ball.y <= player.y + halfH) {
        resolveHit(ball, player, paddleFront, true, dt);
      }
    }
  } else {
    // Right paddle — ball moving right
    if (
      ball.vx > 0 &&
      ball.x + BALL_RADIUS >= paddleFront &&
      ball.x + BALL_RADIUS - ballMove <= paddleFront
    ) {
      if (ball.y >= player.y - halfH && ball.y <= player.y + halfH) {
        resolveHit(ball, player, paddleFront, false, dt);
      }
    }
  }
}

function resolveHit(ball, player, paddleFront, isLeft, dt) {
  const halfH  = player.paddleHeight / 2;
  const hitPos = (ball.y - player.y) / halfH; // -1 to +1

  // Reflect and add angle based on hit position
  ball.vx   = isLeft ? Math.abs(ball.vx) : -Math.abs(ball.vx);
  ball.speed = Math.min(BALL_MAX_SPEED, ball.speed + BALL_SPEED_INC);
  ball.vy   = hitPos * ball.speed * 0.75;

  // Normalize to maintain constant speed
  const mag = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (mag > 0) {
    ball.vx = (ball.vx / mag) * ball.speed;
    ball.vy = (ball.vy / mag) * ball.speed;
  }

  // Push ball clear of the paddle face to avoid tunneling on next frame
  ball.x = isLeft
    ? paddleFront + BALL_RADIUS + 1
    : paddleFront - BALL_RADIUS - 1;

  player.hitFlashUntil = Date.now() + HIT_FLASH_MS;
  hitCount++;
  playPaddleHit(hitCount);
  spawnParticles(paddleFront, ball.y, PARTICLE_COUNT_HIT);
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

function endGame() {
  const { players } = window.pongState;
  playGameEnd();

  // Determine winner
  let winnerName, winnerScore, opponentName;
  if (players.left.score > players.right.score) {
    winnerName   = players.left.name;
    winnerScore  = players.left.score;
    opponentName = players.right.name;
  } else if (players.right.score > players.left.score) {
    winnerName   = players.right.name;
    winnerScore  = players.right.score;
    opponentName = players.left.name;
  } else {
    // Tie: don't save a high score entry (no clear winner)
    winnerName   = null;
    winnerScore  = players.left.score;
    opponentName = null;
  }

  window.pongState.winner = winnerName;

  if (winnerName) {
    window.pongState.highScores = saveHighScore(winnerName, winnerScore, opponentName);
  }

  window.pongState.status = 'GAMEOVER';
}

// ---------------------------------------------------------------------------
// State initialiser
// ---------------------------------------------------------------------------

function buildInitialState() {
  return {
    status:       'MENU',
    inputBuffer:  '',
    focusedInput: 'name',   // MENU starts with name field focused
    mouseX:       null,
    mouseY:       null,
    playerName:   '',
    roomCode:     '',
    networkError: null,

    players: {
      left: {
        name:          'PLAYER 1',
        score:         0,
        y:             H / 2,
        paddleHeight:  PADDLE_HEIGHT,
        hitFlashUntil: 0,
      },
      right: {
        name:          'PLAYER 2',
        score:         0,
        y:             H / 2,
        paddleHeight:  PADDLE_HEIGHT,
        hitFlashUntil: 0,
      },
    },

    ball: {
      x:     W / 2,
      y:     H / 2,
      vx:    BALL_INITIAL_SPEED,
      vy:    BALL_INITIAL_SPEED * 0.5,
      speed: BALL_INITIAL_SPEED,
      trail: [],
    },

    timer:         MATCH_DURATION,
    countdown:     3,
    countdownFrac: 1,

    particles:  [],
    highScores: [],
    ping:       null,
    winner:     null,
  };
}

// ---------------------------------------------------------------------------
// Network callbacks — wired up once, re-evaluated each event
// ---------------------------------------------------------------------------

function setupNetworkCallbacks() {
  // Incoming data — both host (receives input) and guest (receives state)
  onData((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'input' && isHost) {
      // Guest paddle position update
      if (window.pongState.status === 'PLAYING' || window.pongState.status === 'COUNTDOWN') {
        window.pongState.players.right.y = msg.y;
      }
    } else if (msg.type === 'state' && !isHost) {
      // Full state from host
      applyHostState(msg);
    }
  });

  onNetworkDisconnect(() => {
    playDisconnect();
    window.pongState.networkError = 'Opponent disconnected.';
    // Give a brief moment so the error renders, then go back to menu
    setTimeout(() => {
      resetToMenu();
    }, 2500);
  });

  onNetworkError((errMsg) => {
    window.pongState.networkError = errMsg;
    // If we were in a lobby state, the error is fatal — go back to menu
    const s = window.pongState.status;
    if (s === 'LOBBY_HOST' || s === 'LOBBY_GUEST') {
      setTimeout(() => resetToMenu(), 2500);
    }
  });
}

/**
 * Guest: overwrite pongState from authoritative host snapshot.
 * Local paddle (right) Y is preserved so the guest's own input feels instant.
 */
function applyHostState(msg) {
  const state = window.pongState;

  // Apply ball
  Object.assign(state.ball, msg.ball);

  // Apply scores / names / flash — but NOT right.y (guest owns that locally)
  if (msg.left)  Object.assign(state.players.left,  msg.left);
  if (msg.right) {
    state.players.right.score         = msg.right.score;
    state.players.right.hitFlashUntil = msg.right.hitFlashUntil;
    // Guest name is set at connect time; don't overwrite
  }

  state.timer         = msg.timer        ?? state.timer;
  state.countdownFrac = msg.countdownFrac ?? state.countdownFrac;
  state.winner        = msg.winner       ?? null;

  // Guest plays sounds when status or countdown changes
  const prevStatus = state.status;
  const newStatus  = msg.status ?? state.status;

  const newCountdown = msg.countdown ?? state.countdown;
  if (newCountdown !== guestLastCountdown && newStatus === 'COUNTDOWN') {
    guestLastCountdown = newCountdown;
    if (newCountdown > 0) {
      playCountdownBeep(false);
    } else if (newCountdown === 0) {
      playCountdownBeep(true);
    }
  }
  state.countdown = newCountdown;

  if (newStatus === 'PLAYING' && prevStatus !== 'PLAYING') {
    playGameStart();
  }
  if (newStatus === 'GAMEOVER' && prevStatus !== 'GAMEOVER') {
    playGameEnd();
  }

  state.status = newStatus;

  if (msg.particles) {
    state.particles = msg.particles;
  }
}

// ---------------------------------------------------------------------------
// Countdown logic (host drives, guest follows via state sync)
// ---------------------------------------------------------------------------

let countdownPhaseStart  = 0;   // performance.now() when countdown began

function startCountdown() {
  window.pongState.status        = 'COUNTDOWN';
  window.pongState.countdown     = 3;
  window.pongState.countdownFrac = 1;
  countdownPhaseStart            = performance.now();

  guestLastCountdown = 3;
  playCountdownBeep(false);
}

/**
 * Simple countdown: 0-1s = "3", 1-2s = "2", 2-3s = "1", 3-3.5s = "GO!", then PLAYING.
 * Total duration: 3.5 seconds.
 */
function updateCountdown(now) {
  if (!isHost) return;

  const elapsed = now - countdownPhaseStart;
  const state   = window.pongState;

  if (elapsed < 3000) {
    // Counting 3, 2, 1
    const secondIndex  = Math.floor(elapsed / 1000);        // 0, 1, 2
    const newCount     = 3 - secondIndex;                    // 3, 2, 1
    const fracInSecond = 1 - (elapsed % 1000) / 1000;       // 1 -> 0

    if (newCount !== state.countdown) {
      state.countdown = newCount;
      playCountdownBeep(false);
    }
    state.countdownFrac = fracInSecond;
  } else if (elapsed < 3500) {
    // GO! phase
    if (state.countdown !== 0) {
      state.countdown = 0;
      state.countdownFrac = 1;
      playCountdownBeep(true);
    }
    state.countdownFrac = 1 - (elapsed - 3000) / 500;
  } else {
    // Transition to PLAYING
    state.status = 'PLAYING';
    playGameStart();
  }
}

// ---------------------------------------------------------------------------
// Host physics update
// ---------------------------------------------------------------------------

function updatePhysics(dt) {
  const { players, ball } = window.pongState;

  // ----- Ball movement -----
  ball.x += ball.vx * dt * 60;
  ball.y += ball.vy * dt * 60;

  // Trail
  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > MAX_TRAIL_LENGTH) ball.trail.shift();

  // ----- Wall bounce (top / bottom) -----
  if (ball.y - BALL_RADIUS <= 0) {
    ball.y  = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
    playWallBounce();
  }
  if (ball.y + BALL_RADIUS >= H) {
    ball.y  = H - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy);
    playWallBounce();
  }

  // ----- Paddle collisions -----
  checkPaddleCollision(ball, players.left,  PADDLE_X_LEFT,  dt);
  checkPaddleCollision(ball, players.right, PADDLE_X_RIGHT, dt);

  // ----- Score detection -----
  if (ball.x < 0) {
    scorePoint('right');
    checkWinCondition();
    return; // skip further physics this frame
  }
  if (ball.x > W) {
    scorePoint('left');
    checkWinCondition();
    return;
  }
}

function checkWinCondition() {
  const { players } = window.pongState;
  if (
    players.left.score  >= WINNING_SCORE ||
    players.right.score >= WINNING_SCORE
  ) {
    endGame();
  }
}

// ---------------------------------------------------------------------------
// Host paddle input (left paddle belongs to host)
// ---------------------------------------------------------------------------

function updateHostPaddle(dt) {
  const left = window.pongState.players.left;
  if (isLocalMode) {
    // Local mode: W/S for left paddle
    if (keys['w']) left.y -= PADDLE_SPEED * dt * 60;
    if (keys['s']) left.y += PADDLE_SPEED * dt * 60;
  } else {
    if (keys['w'] || keys['ArrowUp']) left.y -= PADDLE_SPEED * dt * 60;
    if (keys['s'] || keys['ArrowDown']) left.y += PADDLE_SPEED * dt * 60;
  }
  left.y = Math.max(
    PADDLE_HEIGHT / 2,
    Math.min(H - PADDLE_HEIGHT / 2, left.y),
  );
}

// ---------------------------------------------------------------------------
// Guest paddle input (right paddle belongs to guest)
// ---------------------------------------------------------------------------

function updateGuestPaddle(dt) {
  const right = window.pongState.players.right;
  if (keys['w'] || keys['ArrowUp']) {
    right.y -= PADDLE_SPEED * dt * 60;
  }
  if (keys['s'] || keys['ArrowDown']) {
    right.y += PADDLE_SPEED * dt * 60;
  }
  right.y = Math.max(
    PADDLE_HEIGHT / 2,
    Math.min(H - PADDLE_HEIGHT / 2, right.y),
  );
}

// ---------------------------------------------------------------------------
// Local mode: right paddle uses ArrowUp/ArrowDown
// ---------------------------------------------------------------------------

function updateLocalRightPaddle(dt) {
  const right = window.pongState.players.right;
  if (keys['ArrowUp']) right.y -= PADDLE_SPEED * dt * 60;
  if (keys['ArrowDown']) right.y += PADDLE_SPEED * dt * 60;
  right.y = Math.max(
    PADDLE_HEIGHT / 2,
    Math.min(H - PADDLE_HEIGHT / 2, right.y),
  );
}

// ---------------------------------------------------------------------------
// Host: broadcast full state to guest
// ---------------------------------------------------------------------------

function broadcastState() {
  const { players, ball, timer, status, countdown, countdownFrac, winner, particles } = window.pongState;
  sendToGuest({
    type:          'state',
    ball:          { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, speed: ball.speed, trail: ball.trail },
    left:          { y: players.left.y, score: players.left.score, name: players.left.name, hitFlashUntil: players.left.hitFlashUntil },
    right:         { y: players.right.y, score: players.right.score, hitFlashUntil: players.right.hitFlashUntil },
    timer,
    status,
    countdown,
    countdownFrac,
    winner:        winner || null,
    particles,
  });
}

// ---------------------------------------------------------------------------
// Guest: send local paddle Y to host
// ---------------------------------------------------------------------------

function broadcastInput() {
  sendToHost({ type: 'input', y: window.pongState.players.right.y });
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function resetToMenu() {
  disconnect();
  isHost = false;
  isLocalMode = false;
  hitCount = 0;
  window.pongState = buildInitialState();
  window.pongState.highScores = loadHighScores();
}

function resetBall() {
  const { ball } = window.pongState;
  ball.x     = W / 2;
  ball.y     = H / 2;
  ball.speed = BALL_INITIAL_SPEED;
  ball.trail = [];
  const angle = (Math.random() * 0.5 - 0.25) * Math.PI;
  const dir   = Math.random() < 0.5 ? 1 : -1;
  ball.vx     = Math.cos(angle) * ball.speed * dir;
  ball.vy     = Math.sin(angle) * ball.speed;
  hitCount    = 0;
}

function resetScores() {
  window.pongState.players.left.score  = 0;
  window.pongState.players.right.score = 0;
  window.pongState.players.left.y      = H / 2;
  window.pongState.players.right.y     = H / 2;
  window.pongState.timer               = MATCH_DURATION;
  window.pongState.particles           = [];
  window.pongState.winner              = null;
  window.pongState.networkError        = null;
}

// ---------------------------------------------------------------------------
// Click hit-test helper
// ---------------------------------------------------------------------------

function hitTest(mx, my, btn) {
  return mx >= btn.x && mx <= btn.x + btn.w &&
         my >= btn.y && my <= btn.y + btn.h;
}

// ---------------------------------------------------------------------------
// Input — keyboard
// ---------------------------------------------------------------------------

function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    ensureAudio();
    keys[e.key] = true;

    const state = window.pongState;

    // Text input capture — only when a field is focused
    if (state.focusedInput) {
      handleTextInput(e, state);
      return;
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
  });

  // Mouse position tracking
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    window.pongState.mouseX = (e.clientX - rect.left) * scaleX;
    window.pongState.mouseY = (e.clientY - rect.top)  * scaleY;
  });

  canvas.addEventListener('mouseleave', () => {
    window.pongState.mouseX = null;
    window.pongState.mouseY = null;
  });

  // Click handling
  canvas.addEventListener('click', (e) => {
    ensureAudio();
    const rect   = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx     = (e.clientX - rect.left) * scaleX;
    const my     = (e.clientY - rect.top)  * scaleY;
    handleClick(mx, my);
  });
}

/**
 * Capture text input for name and code fields.
 * Prevents default on keys that would otherwise scroll the page.
 */
function handleTextInput(e, state) {
  const field = state.focusedInput;

  if (e.key === 'Backspace') {
    e.preventDefault();
    state.inputBuffer = state.inputBuffer.slice(0, -1);
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (field === 'name' && state.status === 'MENU') {
      // Treat Enter as clicking CREATE GAME (primary action)
      attemptCreateGame();
    } else if (field === 'code' && state.status === 'LOBBY_GUEST') {
      attemptJoinRoom();
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    return;
  }

  // Only accept printable single characters
  if (e.key.length !== 1) return;

  if (field === 'name') {
    // Alphanumeric + space, max 12 chars
    if (/^[a-zA-Z0-9 ]$/.test(e.key) && state.inputBuffer.length < 12) {
      e.preventDefault();
      state.inputBuffer += e.key;
    }
  } else if (field === 'code') {
    // Alphanumeric only, max 4 chars, auto-uppercase
    if (/^[a-zA-Z0-9]$/.test(e.key) && state.inputBuffer.length < 4) {
      e.preventDefault();
      state.inputBuffer += e.key.toUpperCase();
    }
  }
}

// ---------------------------------------------------------------------------
// Click handlers per screen
// ---------------------------------------------------------------------------

function handleClick(mx, my) {
  const state = window.pongState;

  switch (state.status) {
    case 'MENU':
      handleMenuClick(mx, my, state);
      break;
    case 'LOBBY_GUEST':
      handleLobbyGuestClick(mx, my, state);
      break;
    case 'GAMEOVER':
      handleGameOverClick(mx, my, state);
      break;
    default:
      break;
  }
}

function handleMenuClick(mx, my, state) {
  if (hitTest(mx, my, MENU_BUTTONS.localGame)) {
    attemptLocalGame();
  } else if (hitTest(mx, my, MENU_BUTTONS.createGame)) {
    attemptCreateGame();
  } else if (hitTest(mx, my, MENU_BUTTONS.joinGame)) {
    // Transition to guest lobby — re-use inputBuffer for room code entry
    const name = state.inputBuffer.trim() || 'PLAYER';
    state.playerName   = name.toUpperCase();
    state.status       = 'LOBBY_GUEST';
    state.inputBuffer  = '';
    state.focusedInput = 'code';
    state.networkError = null;
    isHost             = false;
  }
}

function handleLobbyGuestClick(mx, my, state) {
  if (hitTest(mx, my, LOBBY_GUEST_BUTTONS.join)) {
    attemptJoinRoom();
  }
}

function handleGameOverClick(mx, my, state) {
  if (hitTest(mx, my, GAMEOVER_BUTTONS.playAgain)) {
    if (isHost) {
      // Host creates a new room for a rematch
      disconnect();
      resetScores();
      resetBall();
      const name = state.playerName || 'PLAYER 1';
      state.players.left.name  = name;
      state.players.right.name = 'PLAYER 2';
      state.status       = 'LOBBY_HOST';
      state.networkError = null;
      state.roomCode     = '';
      state.inputBuffer  = '';
      state.focusedInput = null;
      attemptCreateRoomForRematch();
    } else {
      // Guest goes back to menu
      resetToMenu();
    }
  } else if (hitTest(mx, my, GAMEOVER_BUTTONS.backToMenu)) {
    resetToMenu();
  }
}

// ---------------------------------------------------------------------------
// Network action helpers (called from click handlers and Enter key)
// ---------------------------------------------------------------------------

function attemptCreateGame() {
  const state = window.pongState;
  const name  = state.inputBuffer.trim() || 'PLAYER 1';
  state.playerName        = name.toUpperCase();
  state.players.left.name = state.playerName;
  state.status            = 'LOBBY_HOST';
  state.inputBuffer       = '';
  state.focusedInput      = null;
  state.networkError      = null;
  isHost                  = true;

  createRoom(
    (guestName) => {
      // Guest connected and sent their name
      playConnect();
      state.players.right.name = guestName.toUpperCase() || 'PLAYER 2';
      resetScores();
      resetBall();
      startCountdown();
    },
    (errMsg) => {
      state.networkError = errMsg;
    },
  );
}

function attemptLocalGame() {
  const state = window.pongState;
  const name  = state.inputBuffer.trim() || 'PLAYER 1';
  state.playerName        = name.toUpperCase();
  state.players.left.name = state.playerName;
  state.players.right.name = 'PLAYER 2';
  state.inputBuffer       = '';
  state.focusedInput      = null;
  state.networkError      = null;
  isHost     = true;
  isLocalMode = true;

  resetScores();
  resetBall();
  startCountdown();
}

function attemptJoinRoom() {
  const state    = window.pongState;
  const code     = state.inputBuffer.trim().toUpperCase();
  if (!code || code.length < 1) {
    state.networkError = 'Enter a room code.';
    return;
  }
  state.networkError = null;

  joinRoom(
    code,
    state.playerName || 'GUEST',
    () => {
      // Successfully connected — wait for host to push COUNTDOWN state
      playConnect();
      state.status       = 'LOBBY_GUEST';
      state.focusedInput = null;
      // Guest's own paddle is on the right
      state.players.right.name = state.playerName || 'GUEST';
    },
    (errMsg) => {
      state.networkError = errMsg;
    },
  );
}

function attemptCreateRoomForRematch() {
  const state = window.pongState;

  createRoom(
    (guestName) => {
      playConnect();
      state.players.right.name = guestName.toUpperCase() || 'PLAYER 2';
      resetScores();
      resetBall();
      startCountdown();
    },
    (errMsg) => {
      state.networkError = errMsg;
    },
  );
}

// ---------------------------------------------------------------------------
// Main update dispatcher
// ---------------------------------------------------------------------------

function update(dt, nowMs) {
  const state  = window.pongState;
  const status = state.status;

  // Always update particles (they're cosmetic and keep ticking between states)
  if (state.particles.length > 0) {
    updateParticles(dt);
  }

  switch (status) {
    case 'MENU':
    case 'LOBBY_HOST':
    case 'LOBBY_GUEST':
      // No physics — just wait for input / network events
      break;

    case 'COUNTDOWN':
      if (isHost) {
        updateHostPaddle(dt);
        if (isLocalMode) updateLocalRightPaddle(dt);
        updateCountdown(nowMs);
        if (!isLocalMode) broadcastState();
      } else {
        updateGuestPaddle(dt);
        broadcastInput();
      }
      break;

    case 'PLAYING':
      if (isHost) {
        updateHostPaddle(dt);
        if (isLocalMode) updateLocalRightPaddle(dt);
        updatePhysics(dt);

        // Timer
        state.timer -= dt;
        if (state.timer <= 0) {
          state.timer = 0;
          endGame();
        }

        if (!isLocalMode) broadcastState();
      } else {
        updateGuestPaddle(dt);
        broadcastInput();
      }
      break;

    case 'GAMEOVER':
      // Broadcast final state one last time so guest sees the result
      if (isHost) {
        broadcastState();
      }
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05); // cap at 50ms
  lastTimestamp = timestamp;

  update(dt, timestamp);
  render(ctx);

  requestAnimationFrame(gameLoop);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function initGame() {
  // Build initial state
  window.pongState = buildInitialState();
  window.pongState.highScores = loadHighScores();

  // Wire up network callbacks (registered once; re-evaluated each event)
  setupNetworkCallbacks();

  // Wire up input listeners
  setupInputListeners();

  // Kick off the render loop
  requestAnimationFrame((ts) => {
    lastTimestamp = ts;
    gameLoop(ts);
  });
}

initGame();
