// =============================================================================
// Tron/Cyberpunk Pong — audio.js
// All game audio synthesized via Web Audio API. No audio files.
// AudioContext is created lazily on first user gesture via initAudio().
//
// Sound design: 80s arcade × Kavinsky — punchy, dramatic synthwave.
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

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioCtx.destination);
  }
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
// WaveShaper curves
// ---------------------------------------------------------------------------

/**
 * Soft-clip waveshaper curve for harmonic warmth/grit.
 * amount: 0 = clean, higher = more saturation (try 20-200)
 */
function makeDistortionCurve(amount = 50) {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Core helper: playTone
// Single oscillator with attack/decay envelope, routed to masterGain.
// ---------------------------------------------------------------------------

function playTone(freq, type, duration, startTime, peakGain = 0.35, attack = 0.005) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

// ---------------------------------------------------------------------------
// Helper: playChord
// Multiple oscillators at given frequencies, run through a shared lowpass
// filter with optional frequency sweep.
// ---------------------------------------------------------------------------

/**
 * @param {number[]} freqs       - Array of frequencies to play simultaneously
 * @param {string}  type         - OscillatorNode type
 * @param {number}  duration     - Envelope duration in seconds
 * @param {number}  startTime    - AudioContext time
 * @param {number}  peakGain     - Peak amplitude per oscillator
 * @param {number}  filterFreq   - Initial lowpass cutoff in Hz
 * @param {number}  filterEnd    - Final lowpass cutoff (sweep target). If equal
 *                                  to filterFreq, no sweep happens.
 */
function playChord(freqs, type, duration, startTime, peakGain = 0.2,
                   filterFreq = 4000, filterEnd = null) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, now);
  if (filterEnd !== null && filterEnd !== filterFreq) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(filterEnd, 20), now + duration
    );
  }
  filter.Q.value = 1.2;

  const chordGain = audioCtx.createGain();
  chordGain.gain.setValueAtTime(0.0001, now);
  chordGain.gain.linearRampToValueAtTime(peakGain, now + 0.008);
  chordGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  filter.connect(chordGain);
  chordGain.connect(masterGain);

  freqs.forEach(freq => {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(filter);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  });
}

// ---------------------------------------------------------------------------
// Helper: playFilteredSweep
// Oscillator frequency sweep + simultaneous lowpass filter sweep.
// ---------------------------------------------------------------------------

/**
 * @param {number} freqStart   - Start oscillator frequency
 * @param {number} freqEnd     - End oscillator frequency
 * @param {string} type        - OscillatorNode type
 * @param {number} duration    - Duration in seconds
 * @param {number} filterStart - Start lowpass cutoff Hz
 * @param {number} filterEnd   - End lowpass cutoff Hz
 * @param {number} startTime   - AudioContext time
 * @param {number} peakGain    - Peak amplitude
 */
function playFilteredSweep(freqStart, freqEnd, type, duration,
                           filterStart, filterEnd, startTime, peakGain = 0.25) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const osc    = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain   = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.linearRampToValueAtTime(freqEnd, now + duration);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(filterStart, 20), now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 20), now + duration);
  filter.Q.value = 1.5;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

// ---------------------------------------------------------------------------
// Helper: createDetunedPair
// Two oscillators detuned by ±detuneCents for thick unison.
// ---------------------------------------------------------------------------

/**
 * @param {number} freq         - Center frequency in Hz
 * @param {string} type         - OscillatorNode type
 * @param {number} detuneCents  - Cents offset; one osc goes +, the other -
 * @param {number} duration     - Envelope duration
 * @param {number} startTime    - AudioContext time
 * @param {number} peakGain     - Peak amplitude per oscillator
 * @param {AudioNode} [target]  - Optional destination node (defaults to masterGain)
 * @returns {{ gainNode: GainNode }} — exposes the shared gain for further routing
 */
function createDetunedPair(freq, type, detuneCents, duration, startTime,
                           peakGain = 0.2, target = null) {
  if (!audioCtx || !masterGain) return {};
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;
  const dest = target || masterGain;

  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.linearRampToValueAtTime(peakGain, now + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gainNode.connect(dest);

  [-detuneCents, +detuneCents].forEach(d => {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = d;
    osc.connect(gainNode);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  });

  return { gainNode };
}

// ---------------------------------------------------------------------------
// Helper: playNoiseBurst
// White noise through a filter with optional gain envelope.
// ---------------------------------------------------------------------------

function playNoiseBurst(duration, startTime, peakGain = 0.12,
                        filterFreq = 800, filterType = 'highpass') {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const bufferSize = Math.floor(audioCtx.sampleRate * (duration + 0.05));
  const buffer     = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data       = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source  = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type  = filterType;
  filter.frequency.value = filterFreq;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  source.start(now);
  source.stop(now + duration + 0.05);
}

// ---------------------------------------------------------------------------
// Helper: playNoiseFilterSweep
// Noise burst with a lowpass filter that sweeps over time (riser/downward).
// ---------------------------------------------------------------------------

function playNoiseFilterSweep(duration, startTime, peakGain = 0.15,
                               filterStart = 200, filterEnd = 4000) {
  if (!audioCtx || !masterGain) return;
  const now = startTime !== undefined ? startTime : audioCtx.currentTime;

  const bufferSize = Math.floor(audioCtx.sampleRate * (duration + 0.05));
  const buffer     = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data       = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source  = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(filterStart, 20), now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 20), now + duration);
  filter.Q.value = 1.0;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + duration * 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  source.start(now);
  source.stop(now + duration + 0.05);
}

// ---------------------------------------------------------------------------
// Public sound functions
// ---------------------------------------------------------------------------

/**
 * Paddle hit — laser tennis racket.
 *
 * Layers:
 *   1. Detuned sawtooth chord (fundamental + perfect 5th) through a punchy
 *      filter for that thick synthwave thwack.
 *   2. Crispy filtered noise burst for physical impact texture.
 *   3. Sub-bass sine thump (~80 Hz) for chest-punch weight.
 *   4. Short pitch-bend portamento on the lead layer (+50 Hz over 30ms).
 *
 * As hitCount increases (mod 12) pitch rises for mounting rally tension.
 *
 * @param {number} hitCount - Total paddle hits in current rally (0-based)
 */
export function playPaddleHit(hitCount = 0) {
  if (!audioCtx) return;
  const step = hitCount % 12;

  // Base pitch: 220 Hz at step 0, rising ~30 Hz per step up to ~550 Hz
  const baseFreq = 220 + step * 28;
  const fifth    = baseFreq * 1.5; // perfect 5th
  const now      = audioCtx.currentTime;

  // --- Layer 1: detuned sawtooth chord (root + 5th) through lowpass ---
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'lowpass';
  filter.frequency.setValueAtTime(3000, now);
  filter.frequency.exponentialRampToValueAtTime(600, now + 0.07);
  filter.Q.value = 2.5;

  const chordGain = audioCtx.createGain();
  chordGain.gain.setValueAtTime(0.0001, now);
  chordGain.gain.linearRampToValueAtTime(0.32, now + 0.004);
  chordGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  filter.connect(chordGain);
  chordGain.connect(masterGain);

  [baseFreq, fifth].forEach((freq, idx) => {
    [-8, +8].forEach(cents => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      // Portamento: quick pitch bend upward gives the "nailed it" feel
      osc.frequency.linearRampToValueAtTime(freq + 50, now + 0.03);
      osc.detune.value = cents + (idx * 5); // slight spread between root & 5th
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + 0.15);
    });
  });

  // --- Layer 2: crispy noise burst (high-pass at 2.5 kHz) ---
  playNoiseBurst(0.04, now, 0.22, 2500, 'highpass');

  // --- Layer 3: sub-bass thump ---
  const subOsc  = audioCtx.createOscillator();
  const subGain = audioCtx.createGain();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(82, now);
  subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.06);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.linearRampToValueAtTime(0.55, now + 0.004);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  subOsc.connect(subGain);
  subGain.connect(masterGain);
  subOsc.start(now);
  subOsc.stop(now + 0.10);
}

/**
 * Wall bounce — chrome ping in a neon world.
 *
 * High sine at ~1200 Hz drops rapidly to ~400 Hz (metallic "ping" quality),
 * plus a delayed quieter echo copy for a reverb-like tail.
 */
export function playWallBounce() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // Primary ping: fast pitch drop 1200 -> 400 Hz over 40ms
  const pingOsc  = audioCtx.createOscillator();
  const pingGain = audioCtx.createGain();
  pingOsc.type = 'sine';
  pingOsc.frequency.setValueAtTime(1200, now);
  pingOsc.frequency.exponentialRampToValueAtTime(400, now + 0.04);
  pingGain.gain.setValueAtTime(0.0001, now);
  pingGain.gain.linearRampToValueAtTime(0.38, now + 0.003);
  pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  pingOsc.connect(pingGain);
  pingGain.connect(masterGain);
  pingOsc.start(now);
  pingOsc.stop(now + 0.14);

  // Echo copy: same sweep, quieter, delayed 55ms — simulates quick reverb tail
  const echoOsc  = audioCtx.createOscillator();
  const echoGain = audioCtx.createGain();
  const echoT    = now + 0.055;
  echoOsc.type = 'sine';
  echoOsc.frequency.setValueAtTime(1200, echoT);
  echoOsc.frequency.exponentialRampToValueAtTime(400, echoT + 0.04);
  echoGain.gain.setValueAtTime(0.0001, echoT);
  echoGain.gain.linearRampToValueAtTime(0.10, echoT + 0.003);
  echoGain.gain.exponentialRampToValueAtTime(0.0001, echoT + 0.10);
  echoOsc.connect(echoGain);
  echoGain.connect(masterGain);
  echoOsc.start(echoT);
  echoOsc.stop(echoT + 0.12);

  // Subtle metallic noise for surface texture
  playNoiseBurst(0.03, now, 0.06, 3500, 'highpass');
}

/**
 * Score point — TRIUMPHANT.
 *
 * Phase 1 (0–400ms): Synthwave power chord (C4-G4-C5) through a lowpass
 *   filter sweep opening 200 Hz -> 4000 Hz. Fat detuned saws.
 * Phase 2 (320–800ms): Bright plucky arpeggio C5-E5-G5-C6 on square wave
 *   with shimmery octave harmonics.
 */
export function playScore() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // --- Phase 1: power chord with filter sweep ---
  // C4=261.6, G4=392.0, C5=523.3
  const chordFreqs = [261.6, 392.0, 523.3];

  const chordFilter = audioCtx.createBiquadFilter();
  chordFilter.type = 'lowpass';
  chordFilter.frequency.setValueAtTime(200, now);
  chordFilter.frequency.exponentialRampToValueAtTime(4000, now + 0.4);
  chordFilter.Q.value = 1.8;

  const chordGain = audioCtx.createGain();
  chordGain.gain.setValueAtTime(0.0001, now);
  chordGain.gain.linearRampToValueAtTime(0.28, now + 0.01);
  chordGain.gain.setValueAtTime(0.28, now + 0.35);
  chordGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

  chordFilter.connect(chordGain);
  chordGain.connect(masterGain);

  chordFreqs.forEach(freq => {
    [-7, 0, +7].forEach(cents => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(chordFilter);
      osc.start(now);
      osc.stop(now + 0.48);
    });
  });

  // Sub thump at chord onset
  const subOsc  = audioCtx.createOscillator();
  const subGain = audioCtx.createGain();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(65, now);
  subOsc.frequency.exponentialRampToValueAtTime(35, now + 0.15);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.linearRampToValueAtTime(0.5, now + 0.005);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  subOsc.connect(subGain);
  subGain.connect(masterGain);
  subOsc.start(now);
  subOsc.stop(now + 0.20);

  // --- Phase 2: ascending arpeggio C5-E5-G5-C6 ---
  // C5=523.3, E5=659.3, G5=784.0, C6=1046.5
  const arpNotes   = [523.3, 659.3, 784.0, 1046.5];
  const arpSpacing = 0.095;
  const arpStart   = now + 0.32;

  arpNotes.forEach((freq, i) => {
    const t = arpStart + i * arpSpacing;

    // Plucky square wave body
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.16);

    // Shimmery octave harmonic (sine)
    const shimOsc  = audioCtx.createOscillator();
    const shimGain = audioCtx.createGain();
    shimOsc.type = 'sine';
    shimOsc.frequency.value = freq * 2;
    shimGain.gain.setValueAtTime(0.0001, t);
    shimGain.gain.linearRampToValueAtTime(0.05, t + 0.005);
    shimGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    shimOsc.connect(shimGain);
    shimGain.connect(masterGain);
    shimOsc.start(t);
    shimOsc.stop(t + 0.12);
  });
}

/**
 * Game start — EPIC synthwave power-up (Tron lightcycle powering on).
 *
 * 1. Low rumble: filtered noise + sub sine swell.
 * 2. Sawtooth riser: 100 Hz -> 1200 Hz over 800ms through an opening filter.
 * 3. At the peak: massive detuned chord (root + min3rd + 5th + octave),
 *    sustained 300ms with a noise accent.
 */
export function playGameStart() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // --- 1. Low rumble: sub sine swell ---
  const rumbleOsc  = audioCtx.createOscillator();
  const rumbleGain = audioCtx.createGain();
  rumbleOsc.type = 'sine';
  rumbleOsc.frequency.setValueAtTime(40, now);
  rumbleOsc.frequency.linearRampToValueAtTime(80, now + 0.8);
  rumbleGain.gain.setValueAtTime(0.0001, now);
  rumbleGain.gain.linearRampToValueAtTime(0.35, now + 0.2);
  rumbleGain.gain.setValueAtTime(0.35, now + 0.6);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
  rumbleOsc.connect(rumbleGain);
  rumbleGain.connect(masterGain);
  rumbleOsc.start(now);
  rumbleOsc.stop(now + 0.88);

  // --- 2. Noise riser: low-pass sweeping upward ---
  playNoiseFilterSweep(0.85, now, 0.18, 100, 3500);

  // --- 3. Sawtooth frequency riser with simultaneous filter opening ---
  playFilteredSweep(100, 1200, 'sawtooth', 0.8, 100, 5000, now, 0.22);

  // Detuned second riser slightly behind for stereo width illusion
  playFilteredSweep(100, 1150, 'sawtooth', 0.8, 80, 4500, now + 0.015, 0.14);

  // --- 4. Impact chord at the peak (t = 0.80s) ---
  // Root=C4 (261.6), min3=Eb4 (311.1), 5th=G4 (392.0), octave=C5 (523.3)
  const peakT     = now + 0.80;
  const peakFreqs = [261.6, 311.1, 392.0, 523.3];

  const peakFilter = audioCtx.createBiquadFilter();
  peakFilter.type = 'lowpass';
  peakFilter.frequency.setValueAtTime(6000, peakT);
  peakFilter.frequency.exponentialRampToValueAtTime(1200, peakT + 0.35);
  peakFilter.Q.value = 2.0;

  const shaper = audioCtx.createWaveShaper();
  shaper.curve = makeDistortionCurve(40);
  shaper.oversample = '2x';

  const peakGainNode = audioCtx.createGain();
  peakGainNode.gain.setValueAtTime(0.0001, peakT);
  peakGainNode.gain.linearRampToValueAtTime(0.30, peakT + 0.01);
  peakGainNode.gain.setValueAtTime(0.30, peakT + 0.28);
  peakGainNode.gain.exponentialRampToValueAtTime(0.0001, peakT + 0.38);

  peakFilter.connect(shaper);
  shaper.connect(peakGainNode);
  peakGainNode.connect(masterGain);

  peakFreqs.forEach(freq => {
    [-10, 0, +10].forEach(cents => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(peakFilter);
      osc.start(peakT);
      osc.stop(peakT + 0.40);
    });
  });

  // Noise accent at peak
  playNoiseBurst(0.12, peakT, 0.25, 1000, 'bandpass');
}

/**
 * Game end — cinematic, like end credits rolling.
 *
 * 1. Power chord (G4-D5-G5) with filter sweep closing (4000 -> 200 Hz).
 * 2. Slow descending arpeggio G4-E4-C4-G3 with long decay, warm triangle.
 * 3. Vinyl-crackle noise texture fading out.
 */
export function playGameEnd() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // --- 1. Opening power chord with closing filter ---
  // G4=392.0, D5=587.3, G5=784.0
  const chordFreqs = [392.0, 587.3, 784.0];

  const chordFilter = audioCtx.createBiquadFilter();
  chordFilter.type = 'lowpass';
  chordFilter.frequency.setValueAtTime(4000, now);
  chordFilter.frequency.exponentialRampToValueAtTime(200, now + 0.55);
  chordFilter.Q.value = 1.5;

  const chordGain = audioCtx.createGain();
  chordGain.gain.setValueAtTime(0.0001, now);
  chordGain.gain.linearRampToValueAtTime(0.26, now + 0.012);
  chordGain.gain.setValueAtTime(0.26, now + 0.40);
  chordGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.60);

  chordFilter.connect(chordGain);
  chordGain.connect(masterGain);

  chordFreqs.forEach(freq => {
    [-6, +6].forEach(cents => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(chordFilter);
      osc.start(now);
      osc.stop(now + 0.63);
    });
  });

  // --- 2. Descending arpeggio G4-E4-C4-G3 ---
  // G4=392.0, E4=329.6, C4=261.6, G3=196.0
  const arpNotes   = [392.0, 329.6, 261.6, 196.0];
  const arpSpacing = 0.22;
  const arpStart   = now + 0.18;

  arpNotes.forEach((freq, i) => {
    const t = arpStart + i * arpSpacing;

    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.010);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.30);

    // Soft sub-octave for warmth
    const sub  = audioCtx.createOscillator();
    const subG = audioCtx.createGain();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.linearRampToValueAtTime(0.10, t + 0.010);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    sub.connect(subG);
    subG.connect(masterGain);
    sub.start(t);
    sub.stop(t + 0.27);
  });

  // --- 3. Vinyl crackle: sparse high-frequency noise fading out ---
  const crackleEnd = now + 1.40;
  const crackleGap = 0.10;
  let t = now + 0.05;
  while (t < crackleEnd) {
    if (Math.random() < 0.6) {
      playNoiseBurst(0.015, t, 0.04 * (1 - (t - now) / 1.4), 4000, 'highpass');
    }
    t += crackleGap + Math.random() * 0.08;
  }
}

/**
 * Countdown beep.
 *
 * Regular: thick square wave with slight detuning + sub-octave for warmth.
 * isFinal (GO!): MASSIVE — 3 detuned saws, pitch-up sweep, noise burst.
 *
 * @param {boolean} isFinal - If true, plays the "GO!" stab.
 */
export function playCountdownBeep(isFinal = false) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  if (!isFinal) {
    // --- Regular tick: detuned square pair ---
    createDetunedPair(440, 'square', 10, 0.13, now, 0.22);

    // Sub-octave for body
    playTone(220, 'sine', 0.10, now, 0.18, 0.006);
  } else {
    // --- GO! stab: enormous ---
    // Three detuned sawtooth oscillators
    const goFreqs   = [880, 880, 880];
    const detunes   = [-12, 0, +12];
    const goFilter  = audioCtx.createBiquadFilter();
    goFilter.type   = 'lowpass';
    goFilter.frequency.setValueAtTime(500, now);
    goFilter.frequency.exponentialRampToValueAtTime(6000, now + 0.08);
    goFilter.frequency.exponentialRampToValueAtTime(1800, now + 0.30);
    goFilter.Q.value = 2.0;

    const goGain = audioCtx.createGain();
    goGain.gain.setValueAtTime(0.0001, now);
    goGain.gain.linearRampToValueAtTime(0.38, now + 0.008);
    goGain.gain.setValueAtTime(0.38, now + 0.20);
    goGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);

    goFilter.connect(goGain);
    goGain.connect(masterGain);

    goFreqs.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 1.08, now + 0.08); // pitch-up sweep
      osc.detune.value = detunes[i];
      osc.connect(goFilter);
      osc.start(now);
      osc.stop(now + 0.42);
    });

    // Sub punch
    const subOsc  = audioCtx.createOscillator();
    const subGain = audioCtx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(110, now);
    subOsc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.55, now + 0.005);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
    subOsc.connect(subGain);
    subGain.connect(masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.22);

    // Noise burst accent
    playNoiseBurst(0.10, now, 0.30, 1500, 'bandpass');
  }
}

/**
 * Match point — tension alert, arcade "danger" warning.
 *
 * Rapid alternating two-tone pulse (detuned) repeating 3 times,
 * with filtered noise underneath for urgency.
 */
export function playMatchPoint() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // Two alternating tones: 740 Hz and 880 Hz, 3 pulses each
  const toneA = 740;
  const toneB = 888; // slightly detuned from 880 for tension
  const pulseLength = 0.065;
  const gap = 0.005;
  const cycle = pulseLength + gap;

  for (let i = 0; i < 3; i++) {
    const tA = now + i * cycle * 2;
    const tB = tA + cycle;

    createDetunedPair(toneA, 'square', 8, pulseLength, tA, 0.24);
    createDetunedPair(toneB, 'square', 8, pulseLength, tB, 0.28);
  }

  // Filtered urgency noise under the whole alert
  playNoiseFilterSweep(cycle * 6 + 0.02, now, 0.10, 400, 2500);
}

/**
 * Connection established — coin-insert / synthwave modem handshake.
 *
 * Three ascending tones with plucky saw + fast filter close,
 * followed by a brief noise whoosh.
 */
export function playConnect() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // Ascending plucks: C5(523) -> G5(784) -> C6(1047)
  const tones   = [523.3, 784.0, 1046.5];
  const spacing = 0.09;

  tones.forEach((freq, i) => {
    const t = now + i * spacing;

    const filter = audioCtx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.10);
    filter.Q.value = 2.5;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.26, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    filter.connect(gain);
    gain.connect(masterGain);

    [-6, 0, +6].forEach(cents => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  });

  // Whoosh noise sweep ending after the last tone
  playNoiseFilterSweep(0.32, now, 0.10, 200, 3000);
}

/**
 * Disconnection — sad/glitchy bit-crushed descent.
 *
 * Square wave with rapid vibrato slowing down, filter closing, noise texture.
 */
export function playDisconnect() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // Descending tone with LFO-style vibrato (manual scheduling)
  // Square wave dropping 660 -> 220 Hz over 400ms
  const mainOsc  = audioCtx.createOscillator();
  const mainGain = audioCtx.createGain();
  const mainFilt = audioCtx.createBiquadFilter();
  mainFilt.type  = 'lowpass';
  mainFilt.frequency.setValueAtTime(3000, now);
  mainFilt.frequency.exponentialRampToValueAtTime(200, now + 0.45);
  mainFilt.Q.value = 1.5;

  mainOsc.type = 'square';
  mainOsc.frequency.setValueAtTime(660, now);
  mainOsc.frequency.exponentialRampToValueAtTime(220, now + 0.40);

  // Rapid vibrato: stagger frequency steps to simulate bit-crush / wobble
  const vibratoDepth  = 18;   // Hz
  const vibratoSteps  = 14;
  for (let i = 0; i < vibratoSteps; i++) {
    // Vibrato rate slows from 18Hz to 4Hz as the tone descends
    const rate    = 18 - i * 1.0;
    const period  = 1 / Math.max(rate, 4);
    const tVib    = now + i * period * 0.5;
    const fBase   = 660 * Math.pow(220 / 660, (i / vibratoSteps));
    const sign    = (i % 2 === 0) ? 1 : -1;
    mainOsc.frequency.setValueAtTime(fBase + sign * vibratoDepth, tVib);
  }

  mainGain.gain.setValueAtTime(0.0001, now);
  mainGain.gain.linearRampToValueAtTime(0.28, now + 0.008);
  mainGain.gain.setValueAtTime(0.28, now + 0.32);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);

  mainOsc.connect(mainFilt);
  mainFilt.connect(mainGain);
  mainGain.connect(masterGain);
  mainOsc.start(now);
  mainOsc.stop(now + 0.50);

  // Sub-octave for weight at the start
  playTone(330, 'sine', 0.18, now, 0.20, 0.008);

  // Glitchy noise texture
  playNoiseBurst(0.08, now + 0.05, 0.12, 800, 'bandpass');
  playNoiseBurst(0.05, now + 0.22, 0.06, 1200, 'bandpass');
}
