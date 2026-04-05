// =============================================================================
// Tron/Cyberpunk Pong — audio.js
// All game audio synthesized via Web Audio API. No audio files.
// AudioContext is created lazily on first user gesture via initAudio().
// =============================================================================

let audioCtx = null;
let masterGain = null;

// ---------------------------------------------------------------------------
// Context bootstrap
// ---------------------------------------------------------------------------

/**
 * Creates the AudioContext on first call. Must be triggered from a user
 * gesture (click/keydown) to satisfy browser autoplay policy.
 * Subsequent calls are no-ops. Returns the AudioContext.
 */
export function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain node — all sounds route through this so volume can be
    // adjusted globally or muted cleanly.
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioCtx.destination);
  }
  // Resume in case browser suspended the context (tab focus rules)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Set master volume. 0 = silent, 1 = full.
 */
export function setMasterVolume(v) {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Creates an oscillator + gain envelope and fires it.
 *
 * @param {number}  freq      - Frequency in Hz
 * @param {string}  type      - OscillatorNode type
 * @param {number}  duration  - Envelope length in seconds
 * @param {number}  startTime - AudioContext time to start (defaults to now)
 * @param {number}  peakGain  - Peak amplitude before decay (default 0.35)
 * @param {number}  attack    - Attack time in seconds (default 0.005)
 */
function playTone(freq, type, duration, startTime, peakGain = 0.35, attack = 0.005) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  // Sharp attack, exponential decay tail
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(now);
  osc.stop(now + duration + 0.01); // tiny buffer avoids click on cut-off
}

/**
 * Frequency sweep using linearRampToValueAtTime on the oscillator's
 * frequency parameter. Useful for whoosh / riser effects.
 */
function playSweep(freqStart, freqEnd, type, duration, startTime, peakGain = 0.25) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.linearRampToValueAtTime(freqEnd, now + duration);

  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(now);
  osc.stop(now + duration + 0.01);
}

/**
 * Short noise burst — used for wall bounce texture.
 */
function playNoiseBurst(duration, startTime, peakGain = 0.12, hiPassFreq = 800) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer     = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data       = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source  = audioCtx.createBufferSource();
  source.buffer = buffer;

  // High-pass filter strips muddy low end, keeps it crisp
  const filter       = audioCtx.createBiquadFilter();
  filter.type        = 'highpass';
  filter.frequency.value = hiPassFreq;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  source.start(now);
  source.stop(now + duration + 0.01);
}

// ---------------------------------------------------------------------------
// Public sound functions
// ---------------------------------------------------------------------------

/**
 * Paddle hit.
 * Base sine at 600 Hz. Each successive hit in a rally (hitCount) nudges the
 * pitch up by 30 Hz, cycling through 8 steps so it never flies off the chart.
 * A very short click-like noise burst layers on top for tactile impact.
 *
 * @param {number} hitCount - Total paddle hits in current rally (0-based)
 */
export function playPaddleHit(hitCount = 0) {
  if (!audioCtx) return;
  const step   = (hitCount % 8);
  const freq   = 600 + step * 30;         // 600 … 810 Hz across 8 steps
  const now    = audioCtx.currentTime;

  // Punchy sine body — fast attack, short decay
  playTone(freq, 'sine', 0.08, now, 0.5, 0.003);

  // Thin high-frequency click for physical impact feel
  playNoiseBurst(0.03, now, 0.18, 3000);

  // Subtle subharmonic sine an octave down — adds weight
  playTone(freq / 2, 'sine', 0.06, now, 0.15, 0.003);
}

/**
 * Wall (top/bottom) bounce.
 * Softer and lower than a paddle hit — conveys a "lighter" surface.
 */
export function playWallBounce() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  playTone(300, 'sine', 0.06, now, 0.2, 0.004);
  // Very faint noise smear for surface texture
  playNoiseBurst(0.04, now, 0.06, 1200);
}

/**
 * Score point.
 * Ascending arpeggio C5-E5-G5 on triangle wave — bright and rewarding.
 * Notes spaced 100 ms apart.
 */
export function playScore() {
  if (!audioCtx) return;
  const notes    = [523.25, 659.25, 783.99]; // C5, E5, G5
  const spacing  = 0.10;                     // seconds between note onsets
  const duration = 0.14;                     // each note envelope length
  const now      = audioCtx.currentTime;

  notes.forEach((freq, i) => {
    const t = now + i * spacing;
    playTone(freq, 'triangle', duration, t, 0.4, 0.005);
    // Sparkle: add a softer octave-up for shimmer
    playTone(freq * 2, 'sine', duration * 0.7, t, 0.08, 0.005);
  });
}

/**
 * Game start.
 * Sawtooth sweeping 200 Hz -> 800 Hz over 500 ms, gain fading out.
 * Feels like a system powering up / laser charging.
 */
export function playGameStart() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  playSweep(200, 800, 'sawtooth', 0.5, now, 0.3);

  // Accent: short blip at the end of the sweep confirms the start
  playTone(800, 'square', 0.08, now + 0.48, 0.2, 0.003);
}

/**
 * Game end / match over.
 * Descending arpeggio G5-E5-C5-G4 on square wave, 150 ms each note.
 * Minor downward motion signals conclusion without being harsh.
 */
export function playGameEnd() {
  if (!audioCtx) return;
  const notes    = [783.99, 659.25, 523.25, 392.00]; // G5, E5, C5, G4
  const spacing  = 0.15;
  const duration = 0.20;
  const now      = audioCtx.currentTime;

  notes.forEach((freq, i) => {
    playTone(freq, 'square', duration, now + i * spacing, 0.25, 0.008);
  });
}

/**
 * Countdown beep (3-2-1 timer before serve or round start).
 *
 * @param {boolean} isFinal - If true, plays the higher-pitched "GO!" beep.
 */
export function playCountdownBeep(isFinal = false) {
  if (!audioCtx) return;
  const freq = isFinal ? 880 : 440;
  const now  = audioCtx.currentTime;

  playTone(freq, 'square', 0.10, now, 0.3, 0.005);

  if (isFinal) {
    // Double-blip for "GO!" — two quick pulses feel more urgent
    playTone(freq, 'square', 0.07, now + 0.12, 0.25, 0.005);
  }
}

// ---------------------------------------------------------------------------
// Bonus ambient / event sounds (enhance Tron atmosphere)
// ---------------------------------------------------------------------------

/**
 * Checkpoint / match point reached (one player at winning_score - 1).
 * Rising two-tone alert.
 */
export function playMatchPoint() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  playTone(523.25, 'triangle', 0.12, now,        0.3, 0.006);
  playTone(783.99, 'triangle', 0.18, now + 0.14, 0.4, 0.006);
}

/**
 * Connection established (player joins lobby).
 * Quick two-tone chirp — coin-insert feel.
 */
export function playConnect() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  playTone(660, 'square', 0.07, now,       0.25, 0.004);
  playTone(880, 'square', 0.07, now + 0.08, 0.25, 0.004);
}

/**
 * Disconnection / error.
 * Descending two-tone — audibly distinct from connect.
 */
export function playDisconnect() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  playTone(440, 'square', 0.09, now,        0.2, 0.005);
  playTone(220, 'square', 0.12, now + 0.10, 0.2, 0.005);
}
