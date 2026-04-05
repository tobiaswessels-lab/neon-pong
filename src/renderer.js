// =============================================================================
// Tron/Cyberpunk Pong — renderer.js
// Pure read-only view layer. Reads window.pongState, never writes to it.
// All visual logic lives here: grid, paddles, ball, particles, all screens.
// =============================================================================

import { THEME } from './theme.js';

const W = THEME.CANVAS_WIDTH;
const H = THEME.CANVAS_HEIGHT;

// ---------------------------------------------------------------------------
// Exported button hit-test bounds — game.js imports these for click detection
// ---------------------------------------------------------------------------

export const MENU_BUTTONS = {
  createGame: { x: 187, y: 448, w: 260, h: 54 },
  joinGame:   { x: 577, y: 448, w: 260, h: 54 },
};

export const LOBBY_GUEST_BUTTONS = {
  join: { x: 412, y: 462, w: 200, h: 54 },
};

export const GAMEOVER_BUTTONS = {
  playAgain:  { x: 262, y: 560, w: 220, h: 54 },
  backToMenu: { x: 542, y: 560, w: 220, h: 54 },
};

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export function render(ctx) {
  const state = window.pongState;
  if (!state) return;

  ctx.clearRect(0, 0, W, H);

  switch (state.status) {
    case 'MENU':        renderMenu(ctx, state);       break;
    case 'LOBBY_HOST':  renderLobbyHost(ctx, state);  break;
    case 'LOBBY_GUEST': renderLobbyGuest(ctx, state); break;
    case 'COUNTDOWN':   renderCountdown(ctx, state);  break;
    case 'PLAYING':     renderGame(ctx, state);       break;
    case 'GAMEOVER':    renderGameOver(ctx, state);   break;
    default:
      // Fallback: just fill background so a blank black screen never shows
      ctx.fillStyle = THEME.BG_COLOR;
      ctx.fillRect(0, 0, W, H);
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function setFont(ctx, size, family) {
  ctx.font = `${size}px ${family || THEME.FONT_FAMILY}`;
}

function glowText(ctx, text, x, y, color, blur, align) {
  ctx.save();
  ctx.textAlign   = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur  = blur;
  ctx.fillStyle   = color;
  ctx.fillText(text, x, y);
  // Second pass for extra intensity
  ctx.shadowBlur  = blur * 0.4;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

/**
 * Draw a neon-styled button.
 * hovered:  draws brighter fill + stronger glow
 * color:    border and glow color (default THEME.BUTTON_BORDER)
 */
function drawButton(ctx, label, bx, by, bw, bh, hovered, color) {
  const bc = color || THEME.BUTTON_BORDER;

  ctx.save();
  // Background fill
  ctx.fillStyle   = hovered ? THEME.BUTTON_HOVER : THEME.BUTTON_BG;
  ctx.shadowColor = bc;
  ctx.shadowBlur  = hovered ? THEME.BUTTON_GLOW_BLUR * 2 : THEME.BUTTON_GLOW_BLUR;
  drawRoundRect(ctx, bx, by, bw, bh, 4);
  ctx.fill();

  // Border
  ctx.strokeStyle = bc;
  ctx.lineWidth   = THEME.BUTTON_BORDER_WIDTH;
  ctx.shadowBlur  = hovered ? 18 : 8;
  drawRoundRect(ctx, bx, by, bw, bh, 4);
  ctx.stroke();

  // Label
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = THEME.BUTTON_TEXT_COLOR;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, THEME.BUTTON_FONT_SIZE);
  ctx.fillText(label, bx + bw / 2, by + bh / 2);
  ctx.restore();
}

/**
 * Draw a neon input box.
 * value:    current string content
 * focused:  whether cursor should blink in this field
 * placeholder: dim text shown when value is empty
 */
function drawInput(ctx, label, ix, iy, iw, ih, value, focused, placeholder) {
  ctx.save();

  // Label above
  setFont(ctx, 11);
  ctx.fillStyle   = THEME.INPUT_BORDER;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = THEME.INPUT_BORDER;
  ctx.shadowBlur  = 8;
  ctx.fillText(label, ix + iw / 2, iy - 8);

  // Box background
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = THEME.INPUT_BG;
  drawRoundRect(ctx, ix, iy, iw, ih, 3);
  ctx.fill();

  // Border — brighter when focused
  const borderColor = focused ? THEME.INPUT_BORDER_FOCUS : THEME.INPUT_BORDER;
  ctx.strokeStyle  = borderColor;
  ctx.lineWidth    = focused ? 2 : 1.5;
  ctx.shadowColor  = borderColor;
  ctx.shadowBlur   = focused ? 14 : 6;
  drawRoundRect(ctx, ix, iy, iw, ih, 3);
  ctx.stroke();

  // Text content or placeholder
  ctx.shadowBlur  = 0;
  const textY     = iy + ih / 2;
  const textX     = ix + 14;
  ctx.textAlign   = 'left';
  ctx.textBaseline = 'middle';
  setFont(ctx, THEME.INPUT_FONT_SIZE);

  if (value && value.length > 0) {
    ctx.fillStyle = THEME.INPUT_TEXT_COLOR;
    ctx.shadowColor = THEME.INPUT_BORDER;
    ctx.shadowBlur  = 6;
    ctx.fillText(value, textX, textY);
  } else if (placeholder) {
    ctx.fillStyle = THEME.INPUT_PLACEHOLDER_COLOR;
    ctx.fillText(placeholder, textX, textY);
  }

  // Blinking cursor
  if (focused && Date.now() % 1000 < 500) {
    const measured  = value ? ctx.measureText(value).width : 0;
    const cursorX   = textX + measured + 2;
    ctx.fillStyle   = THEME.INPUT_BORDER_FOCUS;
    ctx.shadowColor = THEME.INPUT_BORDER_FOCUS;
    ctx.shadowBlur  = 8;
    ctx.fillRect(cursorX, iy + 8, 2, ih - 16);
  }

  ctx.restore();
}

/** Check if (mx, my) is inside button bounds object {x,y,w,h} */
function isHovered(mx, my, btn) {
  if (mx == null || my == null) return false;
  return mx >= btn.x && mx <= btn.x + btn.w &&
         my >= btn.y && my <= btn.y + btn.h;
}

// ---------------------------------------------------------------------------
// Background: Tron perspective grid
// ---------------------------------------------------------------------------

function renderGrid(ctx) {
  // Solid background
  ctx.fillStyle = THEME.BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  const horizon = H * THEME.GRID_VANISH_Y_RATIO;

  ctx.save();
  ctx.strokeStyle = THEME.GRID_COLOR;
  ctx.lineWidth   = THEME.GRID_LINE_WIDTH;

  // --- Horizontal lines with perspective squish towards horizon ---
  const numH = THEME.GRID_ROWS;
  for (let i = 1; i <= numH; i++) {
    const t  = i / numH;
    const tq = t * t; // quadratic easing — lines bunch near horizon

    // Lines above horizon
    const ya = horizon - horizon * tq;
    ctx.beginPath();
    ctx.moveTo(0, ya);
    ctx.lineTo(W, ya);
    ctx.stroke();

    // Lines below horizon
    const yb = horizon + (H - horizon) * tq;
    ctx.beginPath();
    ctx.moveTo(0, yb);
    ctx.lineTo(W, yb);
    ctx.stroke();
  }

  // --- Vertical lines radiating from vanishing point at (W/2, horizon) ---
  const numV  = THEME.GRID_COLS;
  const spread = W * 1.4; // total spread width at top / bottom edges
  for (let i = 0; i <= numV; i++) {
    const t  = i / numV;
    const xEdge = -spread / 2 + spread * t;

    // To top edge
    ctx.beginPath();
    ctx.moveTo(W / 2, horizon);
    ctx.lineTo(W / 2 + xEdge, 0);
    ctx.stroke();

    // To bottom edge
    ctx.beginPath();
    ctx.moveTo(W / 2, horizon);
    ctx.lineTo(W / 2 + xEdge, H);
    ctx.stroke();
  }

  // --- Horizon glow band ---
  const horizGrad = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 40);
  horizGrad.addColorStop(0,   'transparent');
  horizGrad.addColorStop(0.5, THEME.GRID_HORIZON_GLOW);
  horizGrad.addColorStop(1,   'transparent');
  ctx.fillStyle = horizGrad;
  ctx.fillRect(0, horizon - 40, W, 80);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Center divider — dashed vertical line
// ---------------------------------------------------------------------------

function renderDivider(ctx) {
  ctx.save();
  ctx.strokeStyle = THEME.DIVIDER_COLOR;
  ctx.lineWidth   = THEME.DIVIDER_WIDTH;
  ctx.setLineDash([THEME.DIVIDER_DASH_HEIGHT, THEME.DIVIDER_GAP_HEIGHT]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Paddle
// ---------------------------------------------------------------------------

function renderPaddle(ctx, x, y, height, color, isFlashing) {
  const pw  = THEME.PADDLE_WIDTH;
  const ph  = height || THEME.PADDLE_HEIGHT;
  const rx  = x - pw / 2;
  const ry  = y - ph / 2;
  const col = isFlashing ? THEME.PADDLE_HIT_FLASH_COLOR : color;

  ctx.save();

  // Pass 1: wide outer halo
  ctx.shadowColor = col;
  ctx.shadowBlur  = THEME.PADDLE_GLOW_BLUR_OUTER;
  ctx.fillStyle   = col;
  drawRoundRect(ctx, rx, ry, pw, ph, 3);
  ctx.fill();

  // Pass 2: tight inner core — slightly inset, pure white
  ctx.shadowBlur  = THEME.PADDLE_GLOW_BLUR;
  ctx.shadowColor = col;
  ctx.fillStyle   = THEME.PADDLE_CORE_COLOR;
  drawRoundRect(ctx, rx + 2, ry + 2, pw - 4, ph - 4, 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ball + trail
// ---------------------------------------------------------------------------

function renderBall(ctx, ball) {
  const trail = ball.trail || [];

  // Trail — oldest first (index 0) so newest paints on top
  for (let i = 0; i < trail.length; i++) {
    const t      = trail[i];
    const frac   = i / Math.max(trail.length - 1, 1); // 0 = oldest, 1 = newest
    const alpha  = THEME.BALL_TRAIL_ALPHA_END +
                   (THEME.BALL_TRAIL_ALPHA_START - THEME.BALL_TRAIL_ALPHA_END) * frac;
    const radius = THEME.BALL_RADIUS * (0.3 + 0.5 * frac);

    ctx.beginPath();
    ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = THEME.BALL_TRAIL_BASE + alpha.toFixed(3) + ')';
    ctx.fill();
  }

  // Main ball — draw twice for layered glow
  ctx.save();

  // Outer halo pass
  ctx.shadowBlur  = THEME.BALL_GLOW_BLUR * 1.4;
  ctx.shadowColor = THEME.BALL_GLOW;
  ctx.fillStyle   = THEME.BALL_GLOW;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, THEME.BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Inner white core pass
  ctx.shadowBlur  = THEME.BALL_GLOW_BLUR;
  ctx.shadowColor = THEME.BALL_GLOW;
  ctx.fillStyle   = THEME.BALL_COLOR;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, THEME.BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function renderParticles(ctx, particles) {
  if (!particles || particles.length === 0) return;

  ctx.save();
  for (const p of particles) {
    if (p.alpha <= 0) continue;
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD — scores, names, timer
// ---------------------------------------------------------------------------

function renderHUD(ctx, state) {
  const left  = state.players.left;
  const right = state.players.right;
  const timer = state.timer !== undefined ? state.timer : THEME.MATCH_DURATION;

  // --- Left player name + score ---
  ctx.save();
  setFont(ctx, THEME.NAME_FONT_SIZE);
  ctx.textBaseline = 'top';

  // Name
  ctx.textAlign   = 'left';
  ctx.fillStyle   = THEME.NAME_COLOR_LEFT;
  ctx.shadowColor = THEME.NAME_COLOR_LEFT;
  ctx.shadowBlur  = 10;
  ctx.fillText(left.name || 'PLAYER 1', 60, 18);

  // Score (larger, centered below name area)
  setFont(ctx, THEME.SCORE_FONT_SIZE);
  ctx.textAlign   = 'left';
  ctx.fillStyle   = THEME.SCORE_COLOR;
  ctx.shadowColor = THEME.NAME_COLOR_LEFT;
  ctx.shadowBlur  = 15;
  ctx.fillText(String(left.score || 0), 60, 40);

  // --- Right player name + score ---
  setFont(ctx, THEME.NAME_FONT_SIZE);
  ctx.textAlign   = 'right';
  ctx.fillStyle   = THEME.NAME_COLOR_RIGHT;
  ctx.shadowColor = THEME.NAME_COLOR_RIGHT;
  ctx.shadowBlur  = 10;
  ctx.fillText(right.name || 'PLAYER 2', W - 60, 18);

  setFont(ctx, THEME.SCORE_FONT_SIZE);
  ctx.textAlign   = 'right';
  ctx.fillStyle   = THEME.SCORE_COLOR;
  ctx.shadowColor = THEME.NAME_COLOR_RIGHT;
  ctx.shadowBlur  = 15;
  ctx.fillText(String(right.score || 0), W - 60, 40);

  // --- Center timer ---
  const mins    = Math.floor(timer / 60);
  const secs    = Math.floor(timer % 60);
  const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
  const isLow   = timer < THEME.TIMER_LOW_THRESHOLD;
  const blink   = timer < 5 && Date.now() % 1000 < 500;

  if (!blink) {
    setFont(ctx, THEME.TIMER_FONT_SIZE);
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'top';
    const tc        = isLow ? THEME.TIMER_LOW_COLOR : THEME.TIMER_COLOR;
    ctx.fillStyle   = tc;
    ctx.shadowColor = tc;
    ctx.shadowBlur  = isLow ? 20 : 10;
    ctx.fillText(timeStr, W / 2, 22);
  }

  // --- Ping indicator (bottom-right corner, if available) ---
  if (state.ping != null) {
    const ping    = state.ping;
    const pingCol = ping < THEME.PING_GOOD_MS ? THEME.PING_GOOD_COLOR
                  : ping < THEME.PING_MED_MS  ? THEME.PING_MED_COLOR
                  : THEME.PING_BAD_COLOR;
    setFont(ctx, 9);
    ctx.textAlign   = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle   = pingCol;
    ctx.shadowBlur  = 0;
    ctx.fillText(`${ping}ms`, W - 8, H - 8);
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// High score table (shared between MENU and GAMEOVER)
// ---------------------------------------------------------------------------

function renderHighScores(ctx, scores, centerY) {
  if (!scores || scores.length === 0) return;

  const top    = scores.slice(0, 10);
  const lineH  = 26;
  const startY = centerY - (top.length * lineH) / 2;

  ctx.save();
  setFont(ctx, 11);
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'top';

  // Section header
  ctx.fillStyle   = THEME.TITLE_COLOR;
  ctx.shadowColor = THEME.TITLE_COLOR;
  ctx.shadowBlur  = 12;
  ctx.fillText('HIGH SCORES', W / 2, startY - 32);

  top.forEach((entry, i) => {
    const y   = startY + i * lineH;
    const col = i === 0 ? THEME.WIN_COLOR : (i < 3 ? THEME.TIMER_COLOR : 'rgba(255,255,255,0.7)');
    ctx.fillStyle   = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = i === 0 ? 10 : 4;
    ctx.fillText(`${i + 1}. ${entry.name}   ${entry.score}`, W / 2, y);
  });

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Screen: MENU
// ---------------------------------------------------------------------------

function renderMenu(ctx, state) {
  // Background grid (static, no game running)
  renderGrid(ctx);

  // Title — "NEON PONG"
  ctx.save();
  setFont(ctx, THEME.TITLE_FONT_SIZE * 1.6);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Layered glow — three passes for depth
  const titleY = 140;
  for (const [blur, alpha] of [[80, 0.5], [40, 0.8], [0, 1.0]]) {
    ctx.shadowColor = THEME.TITLE_GLOW;
    ctx.shadowBlur  = blur;
    ctx.fillStyle   = blur === 0
      ? THEME.TITLE_COLOR
      : `rgba(255,0,255,${alpha})`;
    ctx.fillText('NEON PONG', W / 2, titleY);
  }
  ctx.restore();

  // Subtitle
  ctx.save();
  setFont(ctx, THEME.SUBTITLE_FONT_SIZE);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = THEME.SUBTITLE_COLOR;
  ctx.shadowColor  = THEME.SUBTITLE_COLOR;
  ctx.shadowBlur   = 12;
  ctx.fillText('ONLINE MULTIPLAYER', W / 2, 210);
  ctx.restore();

  // Decorative horizontal neon line under subtitle
  ctx.save();
  const lineGrad = ctx.createLinearGradient(200, 0, W - 200, 0);
  lineGrad.addColorStop(0,   'transparent');
  lineGrad.addColorStop(0.3, THEME.SUBTITLE_COLOR);
  lineGrad.addColorStop(0.7, THEME.SUBTITLE_COLOR);
  lineGrad.addColorStop(1,   'transparent');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth   = 1;
  ctx.shadowColor = THEME.SUBTITLE_COLOR;
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  ctx.moveTo(200, 232);
  ctx.lineTo(W - 200, 232);
  ctx.stroke();
  ctx.restore();

  // Name input field
  const inputFocused = state.focusedInput === 'name' || state.focusedInput == null;
  drawInput(
    ctx,
    'ENTER YOUR NAME',
    W / 2 - 180, 278, 360, 46,
    state.inputBuffer || '',
    inputFocused,
    'PLAYER'
  );

  // Buttons
  const mx = state.mouseX;
  const my = state.mouseY;
  drawButton(
    ctx,
    'CREATE GAME',
    MENU_BUTTONS.createGame.x, MENU_BUTTONS.createGame.y,
    MENU_BUTTONS.createGame.w, MENU_BUTTONS.createGame.h,
    isHovered(mx, my, MENU_BUTTONS.createGame),
    THEME.PADDLE_LEFT_COLOR
  );
  drawButton(
    ctx,
    'JOIN GAME',
    MENU_BUTTONS.joinGame.x, MENU_BUTTONS.joinGame.y,
    MENU_BUTTONS.joinGame.w, MENU_BUTTONS.joinGame.h,
    isHovered(mx, my, MENU_BUTTONS.joinGame),
    THEME.PADDLE_RIGHT_COLOR
  );

  // High scores at the bottom
  if (state.highScores && state.highScores.length > 0) {
    renderHighScores(ctx, state.highScores, 650);
  }
}

// ---------------------------------------------------------------------------
// Screen: LOBBY_HOST
// ---------------------------------------------------------------------------

function renderLobbyHost(ctx, state) {
  renderGrid(ctx);

  // Host label
  ctx.save();
  setFont(ctx, THEME.NAME_FONT_SIZE);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = THEME.NAME_COLOR_LEFT;
  ctx.shadowColor  = THEME.NAME_COLOR_LEFT;
  ctx.shadowBlur   = 10;
  ctx.fillText(`HOST: ${state.playerName || 'PLAYER'}`, W / 2, 120);
  ctx.restore();

  // "Waiting for opponent..." with animated dots
  const dotCount = Math.floor(Date.now() / 400) % 4;
  const dots     = '.'.repeat(dotCount);
  const pulse    = 0.6 + 0.4 * Math.sin(Date.now() / (THEME.WAITING_PULSE_PERIOD / (2 * Math.PI)));
  ctx.save();
  setFont(ctx, 14);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = `rgba(255,0,255,${pulse.toFixed(2)})`;
  ctx.shadowColor  = THEME.WAITING_PULSE_COLOR;
  ctx.shadowBlur   = 15 * pulse;
  ctx.fillText(`WAITING FOR OPPONENT${dots}`, W / 2, 200);
  ctx.restore();

  // Room code — large, cyan, heavy glow
  const code = state.roomCode || '????';
  ctx.save();
  setFont(ctx, 96);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Three-pass glow
  for (const [blur, col] of [[80, 'rgba(0,255,255,0.3)'], [35, 'rgba(0,255,255,0.7)'], [0, THEME.SUBTITLE_COLOR]]) {
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur  = blur;
    ctx.fillStyle   = col;
    ctx.fillText(code, W / 2, 370);
  }
  ctx.restore();

  // Hint text
  ctx.save();
  setFont(ctx, 11);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = 'rgba(255,255,255,0.5)';
  ctx.shadowBlur   = 0;
  ctx.fillText('SHARE THIS CODE WITH YOUR OPPONENT', W / 2, 480);
  ctx.restore();

  // Decorative box around room code
  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,255,0.25)';
  ctx.lineWidth   = 1;
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur  = 6;
  drawRoundRect(ctx, W / 2 - 180, 310, 360, 120, 6);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Screen: LOBBY_GUEST
// ---------------------------------------------------------------------------

function renderLobbyGuest(ctx, state) {
  renderGrid(ctx);

  // Guest label
  ctx.save();
  setFont(ctx, THEME.NAME_FONT_SIZE);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = THEME.NAME_COLOR_RIGHT;
  ctx.shadowColor  = THEME.NAME_COLOR_RIGHT;
  ctx.shadowBlur   = 10;
  ctx.fillText(`GUEST: ${state.playerName || 'PLAYER'}`, W / 2, 120);
  ctx.restore();

  // Title
  ctx.save();
  setFont(ctx, THEME.TITLE_FONT_SIZE * 0.8);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = THEME.TITLE_COLOR;
  ctx.shadowColor  = THEME.TITLE_COLOR;
  ctx.shadowBlur   = 25;
  ctx.fillText('JOIN A GAME', W / 2, 220);
  ctx.restore();

  // Code input — max 4 chars, uppercase
  const inputFocused = state.focusedInput === 'code' || state.focusedInput == null;
  drawInput(
    ctx,
    'ENTER ROOM CODE',
    W / 2 - 100, 290, 200, 52,
    (state.inputBuffer || '').toUpperCase(),
    inputFocused,
    'XXXX'
  );

  // Join button
  const mx = state.mouseX;
  const my = state.mouseY;
  drawButton(
    ctx,
    'JOIN',
    LOBBY_GUEST_BUTTONS.join.x, LOBBY_GUEST_BUTTONS.join.y,
    LOBBY_GUEST_BUTTONS.join.w, LOBBY_GUEST_BUTTONS.join.h,
    isHovered(mx, my, LOBBY_GUEST_BUTTONS.join),
    THEME.PADDLE_RIGHT_COLOR
  );

  // Network error message
  if (state.networkError) {
    ctx.save();
    setFont(ctx, 11);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = THEME.LOSE_COLOR;
    ctx.shadowColor  = THEME.LOSE_COLOR;
    ctx.shadowBlur   = 12;
    ctx.fillText(state.networkError, W / 2, 550);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Screen: COUNTDOWN
// ---------------------------------------------------------------------------

function renderCountdown(ctx, state) {
  // Live game field in background — paddles, grid, divider, no HUD timer
  renderGrid(ctx);
  renderDivider(ctx);

  const left  = state.players.left;
  const right = state.players.right;
  const ball  = state.ball;

  if (left)  renderPaddle(ctx, THEME.PADDLE_X_LEFT,  left.y,  THEME.PADDLE_HEIGHT, THEME.PADDLE_LEFT_COLOR);
  if (right) renderPaddle(ctx, THEME.PADDLE_X_RIGHT, right.y, THEME.PADDLE_HEIGHT, THEME.PADDLE_RIGHT_COLOR);
  if (ball)  renderBall(ctx, ball);

  // Semi-transparent overlay to dim the field slightly
  ctx.fillStyle = 'rgba(10,10,20,0.45)';
  ctx.fillRect(0, 0, W, H);

  // Countdown number or GO!
  const cd     = state.countdown;
  const label  = cd > 0 ? String(cd) : 'GO!';
  const color  = cd > 0 ? '#ffffff' : THEME.WIN_COLOR;
  const glow   = cd > 0 ? '#ffffff' : THEME.WIN_GLOW;

  // scale-pulse: we animate from 1.5 → 1.0 over the second
  // state.countdownFrac should be 0..1 within the current second (1=new, 0=about to change)
  const frac  = state.countdownFrac !== undefined ? state.countdownFrac : 1;
  const scale = 1.0 + 0.5 * frac;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  setFont(ctx, cd > 0 ? 140 : 80);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Glow passes
  for (const [blur, alpha] of [[100, 0.35], [50, 0.7], [0, 1.0]]) {
    ctx.shadowColor = glow;
    ctx.shadowBlur  = blur;
    ctx.fillStyle   = blur === 0 ? color : `rgba(255,255,255,${alpha})`;
    ctx.fillText(label, 0, 0);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Screen: PLAYING
// ---------------------------------------------------------------------------

function renderGame(ctx, state) {
  renderGrid(ctx);
  renderDivider(ctx);

  const left   = state.players.left;
  const right  = state.players.right;
  const ball   = state.ball;
  const now    = Date.now();

  // Paddles — check flash state
  const leftFlash  = left  && left.hitFlashUntil  && now < left.hitFlashUntil;
  const rightFlash = right && right.hitFlashUntil && now < right.hitFlashUntil;

  if (left)  renderPaddle(ctx, THEME.PADDLE_X_LEFT,  left.y,  THEME.PADDLE_HEIGHT, THEME.PADDLE_LEFT_COLOR,  leftFlash);
  if (right) renderPaddle(ctx, THEME.PADDLE_X_RIGHT, right.y, THEME.PADDLE_HEIGHT, THEME.PADDLE_RIGHT_COLOR, rightFlash);

  // Ball
  if (ball) renderBall(ctx, ball);

  // Particles
  renderParticles(ctx, state.particles);

  // HUD on top
  renderHUD(ctx, state);
}

// ---------------------------------------------------------------------------
// Screen: GAMEOVER
// ---------------------------------------------------------------------------

function renderGameOver(ctx, state) {
  // Draw the field dimmed behind result overlay
  renderGrid(ctx);
  renderDivider(ctx);

  const left  = state.players.left;
  const right = state.players.right;
  if (left)  renderPaddle(ctx, THEME.PADDLE_X_LEFT,  left.y,  THEME.PADDLE_HEIGHT, THEME.PADDLE_LEFT_COLOR);
  if (right) renderPaddle(ctx, THEME.PADDLE_X_RIGHT, right.y, THEME.PADDLE_HEIGHT, THEME.PADDLE_RIGHT_COLOR);

  // Dim overlay
  ctx.fillStyle = 'rgba(5,5,18,0.82)';
  ctx.fillRect(0, 0, W, H);

  // "GAME OVER" title
  ctx.save();
  setFont(ctx, THEME.TITLE_FONT_SIZE * 1.2);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const [blur, col] of [[60, 'rgba(255,0,255,0.4)'], [25, 'rgba(255,0,255,0.8)'], [0, THEME.TITLE_COLOR]]) {
    ctx.shadowColor = THEME.TITLE_GLOW;
    ctx.shadowBlur  = blur;
    ctx.fillStyle   = col;
    ctx.fillText('GAME OVER', W / 2, 110);
  }
  ctx.restore();

  // Determine winner text and color
  const ls = left  ? (left.score  || 0) : 0;
  const rs = right ? (right.score || 0) : 0;
  let winnerText, winColor;

  if (ls === rs) {
    winnerText = "IT'S A TIE!";
    winColor   = THEME.DRAW_COLOR;
  } else if (ls > rs) {
    winnerText = `${(left.name  || 'PLAYER 1').toUpperCase()} WINS!`;
    winColor   = THEME.NAME_COLOR_LEFT;
  } else {
    winnerText = `${(right.name || 'PLAYER 2').toUpperCase()} WINS!`;
    winColor   = THEME.NAME_COLOR_RIGHT;
  }

  ctx.save();
  setFont(ctx, 28);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = winColor;
  ctx.shadowColor  = winColor;
  ctx.shadowBlur   = 28;
  ctx.fillText(winnerText, W / 2, 200);
  ctx.restore();

  // Final scores
  ctx.save();
  setFont(ctx, THEME.NAME_FONT_SIZE);
  ctx.textBaseline = 'middle';

  ctx.textAlign   = 'right';
  ctx.fillStyle   = THEME.NAME_COLOR_LEFT;
  ctx.shadowColor = THEME.NAME_COLOR_LEFT;
  ctx.shadowBlur  = 10;
  ctx.fillText(`${left  ? (left.name  || 'PLAYER 1') : 'PLAYER 1'}`, W / 2 - 20, 268);

  ctx.textAlign   = 'left';
  ctx.fillStyle   = THEME.NAME_COLOR_RIGHT;
  ctx.shadowColor = THEME.NAME_COLOR_RIGHT;
  ctx.shadowBlur  = 10;
  ctx.fillText(`${right ? (right.name || 'PLAYER 2') : 'PLAYER 2'}`, W / 2 + 20, 268);

  setFont(ctx, 36);
  ctx.textAlign   = 'right';
  ctx.fillStyle   = THEME.SCORE_COLOR;
  ctx.shadowColor = THEME.NAME_COLOR_LEFT;
  ctx.shadowBlur  = 14;
  ctx.fillText(String(ls), W / 2 - 20, 310);

  ctx.textAlign   = 'left';
  ctx.shadowColor = THEME.NAME_COLOR_RIGHT;
  ctx.fillText(String(rs), W / 2 + 20, 310);

  // Dash separator
  ctx.textAlign    = 'center';
  ctx.fillStyle    = 'rgba(255,255,255,0.4)';
  ctx.shadowBlur   = 0;
  ctx.fillText('-', W / 2, 310);
  ctx.restore();

  // High score table
  if (state.highScores && state.highScores.length > 0) {
    renderHighScores(ctx, state.highScores, 470);
  }

  // Action buttons
  const mx = state.mouseX;
  const my = state.mouseY;
  drawButton(
    ctx,
    'PLAY AGAIN',
    GAMEOVER_BUTTONS.playAgain.x, GAMEOVER_BUTTONS.playAgain.y,
    GAMEOVER_BUTTONS.playAgain.w, GAMEOVER_BUTTONS.playAgain.h,
    isHovered(mx, my, GAMEOVER_BUTTONS.playAgain),
    THEME.PADDLE_LEFT_COLOR
  );
  drawButton(
    ctx,
    'MAIN MENU',
    GAMEOVER_BUTTONS.backToMenu.x, GAMEOVER_BUTTONS.backToMenu.y,
    GAMEOVER_BUTTONS.backToMenu.w, GAMEOVER_BUTTONS.backToMenu.h,
    isHovered(mx, my, GAMEOVER_BUTTONS.backToMenu),
    THEME.PADDLE_RIGHT_COLOR
  );
}
