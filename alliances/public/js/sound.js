/*
 * Sound — WebAudio synth bank. Zero audio files: every cue is synthesized at
 * play time from oscillators + filtered noise, so the game ships with no assets
 * and every machine sounds identical.
 *
 * Browsers refuse to start an AudioContext before a user gesture, so the shell
 * calls Sound.arm() on the first click/keypress; play() silently no-ops until
 * then (and while muted) — FX code never has to care.
 */
(function () {
  "use strict";

  var ctx = null;     // single shared AudioContext, created in arm()
  var master = null;  // master gain — one knob for overall loudness
  var muted = false;
  var noiseBuf = null;

  function arm() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    var AC = (typeof window !== "undefined") && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return; // ancient browser: game stays silent, nothing breaks
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }

  // One second of white noise, generated once and reused by every noise voice.
  function noise() {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 1);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Standard percussive envelope: fast attack to peak, exponential decay to silence.
  function env(t0, attack, peak, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(master);
    return g;
  }

  // Simple pitched voice: oscillator -> envelope. Optional frequency glide.
  function tone(t0, type, f0, f1, glide, attack, peak, decay) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + glide);
    var g = env(t0, attack, peak, decay);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.1);
    return o;
  }

  // Filtered noise voice: noise -> biquad filter -> envelope.
  function noiseHit(t0, filterType, f0, f1, q, attack, peak, decay) {
    var src = ctx.createBufferSource();
    src.buffer = noise();
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + attack + decay);
    f.Q.value = q || 1;
    var g = env(t0, attack, peak, decay);
    src.connect(f);
    f.connect(g);
    src.start(t0);
    src.stop(t0 + attack + decay + 0.1);
  }

  // ---- The bank ------------------------------------------------------------
  // Each voice takes the context start time and schedules everything ahead —
  // WebAudio's clock does the timing, no setTimeout drift.

  var bank = {

    // Turn fanfare: detuned saw pair G3 -> C4 through an opening lowpass.
    turn: function (t) {
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
      var g = env(t, 0.02, 0.14, 0.6);
      lp.connect(g);
      [-8, 8].forEach(function (cents) {
        var o = ctx.createOscillator();
        o.type = "sawtooth";
        o.detune.value = cents;
        o.frequency.setValueAtTime(196, t);            // G3
        o.frequency.exponentialRampToValueAtTime(261.63, t + 0.22); // C4
        o.connect(lp);
        o.start(t);
        o.stop(t + 0.8);
      });
    },

    // Dice rattle: bandpassed noise bursts + a little click train.
    dice: function (t) {
      for (var i = 0; i < 7; i++) {
        var at = t + i * 0.065 + Math.random() * 0.02;
        noiseHit(at, "bandpass", 1400 + Math.random() * 900, 0, 2.5, 0.004, 0.09, 0.05);
      }
      for (var k = 0; k < 5; k++) {
        tone(t + 0.03 + k * 0.09 + Math.random() * 0.03, "square",
          1800 + Math.random() * 600, 0, 0, 0.002, 0.035, 0.02);
      }
    },

    // Die-settle tick: short square blip, randomized 1.2–1.8 kHz so a run of
    // settles sounds like rolling clicks, not a metronome.
    settle: function (t) {
      tone(t, "square", 1200 + Math.random() * 600, 0, 0, 0.002, 0.08, 0.045);
    },

    // Capture: rising triangle arpeggio C5-E5-G5-C6 + a noise swoosh.
    capture: function (t) {
      var notes = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) {
        tone(t + i * 0.07, "triangle", notes[i], 0, 0, 0.005, 0.12, 0.28);
      }
      noiseHit(t, "bandpass", 700, 4200, 1.2, 0.02, 0.07, 0.32);
    },

    // Repel: dropping sine thud 120 -> 60 Hz with a soft noise body.
    repel: function (t) {
      tone(t, "sine", 120, 60, 0.3, 0.008, 0.3, 0.35);
      noiseHit(t, "lowpass", 280, 0, 1, 0.004, 0.14, 0.09);
    },

    // Dispatch: 880 Hz sonar ping with a single quieter echo.
    dispatch: function (t) {
      tone(t, "sine", 880, 0, 0, 0.003, 0.12, 0.45);
      tone(t + 0.25, "sine", 880, 0, 0, 0.003, 0.05, 0.4);
    },

    // Pact sealed: two sines a fifth apart gliding to unison + octave (consonance).
    pact: function (t) {
      tone(t, "sine", 440, 440, 0.5, 0.03, 0.1, 0.7);
      tone(t, "sine", 660, 880, 0.5, 0.03, 0.1, 0.7);
    },

    // Defect: minor-second square clang + noise burst — deliberately ugly.
    defect: function (t) {
      tone(t, "square", 440, 0, 0, 0.004, 0.1, 0.25);
      tone(t, "square", 466.16, 0, 0, 0.004, 0.1, 0.25);
      noiseHit(t, "highpass", 1000, 0, 1, 0.003, 0.09, 0.12);
    },

    // Elimination timpani: 80 -> 50 Hz boom with a long tail.
    eliminated: function (t) {
      tone(t, "sine", 80, 50, 0.5, 0.01, 0.4, 1.1);
      noiseHit(t, "lowpass", 200, 0, 1, 0.005, 0.18, 0.15);
    },

    // Ceremony: I-IV-V-I triangle pad + randomized 2–3 kHz coin plinks.
    ceremony: function (t) {
      var chords = [
        [261.63, 329.63, 392.0],   // C
        [349.23, 440.0, 523.25],   // F
        [392.0, 493.88, 587.33],   // G
        [523.25, 659.25, 783.99]   // C (octave up — the payoff)
      ];
      for (var c = 0; c < chords.length; c++) {
        for (var n = 0; n < chords[c].length; n++) {
          tone(t + c * 0.55, "triangle", chords[c][n], 0, 0, 0.05, 0.06, 0.5);
        }
      }
      for (var p = 0; p < 10; p++) {
        tone(t + 0.3 + Math.random() * 2.2, "sine",
          2000 + Math.random() * 1000, 0, 0, 0.002, 0.055, 0.12);
      }
    },

    // UI click: tiny soft tick.
    click: function (t) {
      tone(t, "square", 900, 0, 0, 0.001, 0.04, 0.03);
    }
  };

  function play(name) {
    if (!ctx || muted) return;
    if (ctx.state === "suspended") ctx.resume();
    var voice = bank[name];
    if (!voice) return;
    try { voice(ctx.currentTime); } catch (e) { /* a broken cue must never break the game */ }
  }

  function setMuted(b) { muted = !!b; }
  function isMuted() { return muted; }

  var API = { arm: arm, play: play, setMuted: setMuted, isMuted: isMuted };

  if (typeof window !== "undefined") window.Sound = API;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { __test: { NAMES: Object.keys(bank) } };
  }
})();
