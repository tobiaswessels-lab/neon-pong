// =============================================================================
// Tron/Cyberpunk Pong — theme.js
// Full neon color palette, glow constants, and game dimensions.
// Imported by renderer.js and game.js — never writes game state.
// =============================================================================

export const THEME = {

  // ---------------------------------------------------------------------------
  // Background & Grid
  // ---------------------------------------------------------------------------
  BG_COLOR:              '#0a0a14',
  GRID_COLOR:            'rgba(0, 255, 255, 0.07)',
  GRID_HORIZON_GLOW:     'rgba(255, 0, 128, 0.3)',
  GRID_LINE_WIDTH:       1,
  GRID_COLS:             24,           // vertical grid lines
  GRID_ROWS:             18,           // horizontal grid lines
  // Perspective grid vanishing point (bottom-center of canvas)
  GRID_PERSPECTIVE:      true,
  GRID_VANISH_Y_RATIO:   0.55,         // fraction down the canvas for horizon

  // Scanlines — subtle CRT feel
  SCANLINE_ALPHA:        0.04,
  SCANLINE_SPACING:      3,            // every N pixels

  // Vignette — dark radial falloff at canvas edges
  VIGNETTE_INNER:        0.55,         // start of dark ring (fraction of diagonal)
  VIGNETTE_OUTER:        1.0,
  VIGNETTE_COLOR:        'rgba(0, 0, 0, 0.55)',

  // ---------------------------------------------------------------------------
  // Paddles
  // ---------------------------------------------------------------------------
  PADDLE_LEFT_COLOR:     '#00ffff',    // cyan  — player 1
  PADDLE_RIGHT_COLOR:    '#ff00ff',    // magenta — player 2 / opponent
  PADDLE_CORE_COLOR:     '#ffffff',
  PADDLE_GLOW_BLUR:      20,           // inner glow shadowBlur
  PADDLE_GLOW_BLUR_OUTER: 40,          // wider diffuse halo pass
  PADDLE_GLOW_ALPHA:     0.6,
  // Paddle hit flash: briefly overrides color to white
  PADDLE_HIT_FLASH_COLOR: '#ffffff',
  PADDLE_HIT_FLASH_MS:   60,

  // ---------------------------------------------------------------------------
  // Ball
  // ---------------------------------------------------------------------------
  BALL_COLOR:            '#ffffff',
  BALL_GLOW:             '#ffff00',    // yellow glow
  BALL_GLOW_BLUR:        25,
  BALL_TRAIL_BASE:       'rgba(255, 255, 0, ', // append alpha + ')'
  // Trail alpha curve: index 0 = newest (brightest), last = oldest (faintest)
  BALL_TRAIL_ALPHA_START: 0.55,
  BALL_TRAIL_ALPHA_END:   0.02,
  // Speed-intensity glow: ball glow scales with speed ratio
  BALL_GLOW_MIN_BLUR:    10,
  BALL_GLOW_MAX_BLUR:    40,

  // ---------------------------------------------------------------------------
  // Center divider
  // ---------------------------------------------------------------------------
  DIVIDER_COLOR:         'rgba(255, 255, 255, 0.15)',
  DIVIDER_DASH_HEIGHT:   24,
  DIVIDER_GAP_HEIGHT:    16,
  DIVIDER_WIDTH:         3,

  // ---------------------------------------------------------------------------
  // HUD — scores, timer, names
  // ---------------------------------------------------------------------------
  SCORE_COLOR:           '#ffffff',
  SCORE_FONT_SIZE:       48,           // px — used with FONT_FAMILY
  TIMER_COLOR:           '#00ff88',
  TIMER_LOW_COLOR:       '#ff0044',    // switches at TIMER_LOW_THRESHOLD seconds
  TIMER_LOW_THRESHOLD:   10,
  TIMER_FONT_SIZE:       24,
  NAME_COLOR_LEFT:       '#00ffff',
  NAME_COLOR_RIGHT:      '#ff00ff',
  NAME_FONT_SIZE:        14,

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------
  PARTICLE_COLORS:       ['#ff0044', '#ff00ff', '#00ffff', '#ffff00', '#00ff88'],
  PARTICLE_COUNT_HIT:    12,           // particles on paddle hit
  PARTICLE_COUNT_SCORE:  30,           // burst on score
  PARTICLE_SPEED_MIN:    2,
  PARTICLE_SPEED_MAX:    8,
  PARTICLE_LIFE_MS:      600,
  PARTICLE_SIZE_MIN:     2,
  PARTICLE_SIZE_MAX:     6,

  // ---------------------------------------------------------------------------
  // UI Screens — title, lobby, results
  // ---------------------------------------------------------------------------
  TITLE_COLOR:           '#ff00ff',
  TITLE_GLOW:            '#ff00ff',
  TITLE_GLOW_BLUR:       30,
  TITLE_FONT_SIZE:       42,
  SUBTITLE_COLOR:        '#00ffff',
  SUBTITLE_FONT_SIZE:    14,

  BUTTON_BG:             'rgba(255, 0, 255, 0.1)',
  BUTTON_BORDER:         '#ff00ff',
  BUTTON_HOVER:          'rgba(255, 0, 255, 0.3)',
  BUTTON_ACTIVE:         'rgba(255, 0, 255, 0.5)',
  BUTTON_TEXT_COLOR:     '#ffffff',
  BUTTON_FONT_SIZE:      16,
  BUTTON_BORDER_WIDTH:   2,
  BUTTON_GLOW_BLUR:      10,

  INPUT_BG:              'rgba(0, 0, 0, 0.5)',
  INPUT_BORDER:          '#00ffff',
  INPUT_BORDER_FOCUS:    '#ffffff',
  INPUT_TEXT_COLOR:      '#00ffff',
  INPUT_FONT_SIZE:       14,
  INPUT_PLACEHOLDER_COLOR: 'rgba(0, 255, 255, 0.35)',

  // Result screen
  WIN_COLOR:             '#ffff00',
  WIN_GLOW:              '#ffaa00',
  LOSE_COLOR:            '#ff0044',
  DRAW_COLOR:            '#00ff88',

  // Lobby — waiting indicator pulse
  WAITING_PULSE_COLOR:   '#ff00ff',
  WAITING_PULSE_PERIOD:  1200,         // ms per full pulse cycle

  // Network ping display
  PING_GOOD_COLOR:       '#00ff88',
  PING_MED_COLOR:        '#ffff00',
  PING_BAD_COLOR:        '#ff0044',
  PING_GOOD_MS:          60,
  PING_MED_MS:           120,

  // ---------------------------------------------------------------------------
  // Typography
  // ---------------------------------------------------------------------------
  FONT_FAMILY:           "'Press Start 2P', monospace",

  // ---------------------------------------------------------------------------
  // Game Dimensions & Physics Constants
  // ---------------------------------------------------------------------------
  CANVAS_WIDTH:          1024,
  CANVAS_HEIGHT:         768,

  PADDLE_WIDTH:          15,
  PADDLE_HEIGHT:         100,
  PADDLE_X_LEFT:         40,           // center-x of left paddle
  PADDLE_X_RIGHT:        984,          // center-x of right paddle
  PADDLE_SPEED:          8,            // px per frame at 60fps
  // Vertical paddle boundary (paddle edge must stay within canvas)
  PADDLE_Y_MIN:          0,
  PADDLE_Y_MAX:          768,

  BALL_RADIUS:           8,
  BALL_INITIAL_SPEED:    6,
  BALL_MAX_SPEED:        18,           // cap to keep rallies readable
  BALL_SPEED_INCREMENT:  0.4,          // added on each paddle hit
  MAX_TRAIL_LENGTH:      15,

  MATCH_DURATION:        90,           // seconds
  WINNING_SCORE:         7,            // first to 7 or highest at time-up wins

};
