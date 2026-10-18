// Android app only: build.ps1 copies this file into the APK and injects it as the FIRST <script> of index.html.
// It adapts the Android wrapper to the standard web APIs the simulator already uses, so no page code changes:
//  1) window.speechSynthesis + SpeechSynthesisUtterance polyfill on top of window.NativeVoice
//     (Android System WebView has no Web Speech TTS; DS.Voice keeps working unchanged).
//  2) Gamepad rumble: every pad from navigator.getGamepads() gets a 'dual-rumble' vibrationActuator backed by
//     NativePad.rumble (Android vibrator of the controller), so DS.Input.rumble() works on the TV.
//  3) window.DS_NATIVE = {android:true, info:{...}, exit()} for the page (optional use).
// In a normal browser NativeVoice / NativePad do not exist and this file does nothing.
(function () {
  'use strict';
  var W = window, NV = W.NativeVoice, NP = W.NativePad;
  if (!NV && !NP) return;

  var info = {};
  try { info = JSON.parse(NP && NP.info ? NP.info() : '{}') || {}; } catch (e) { info = {}; }
  W.DS_NATIVE = {
    android: true,
    info: info,
    exit: function () { try { NP.exit(); } catch (e) { /* not available */ } }
  };

  // Always take over inside the app: some WebView builds expose a speechSynthesis object that has no voices.
  if (NV) installSpeech();
  if (NP && typeof NP.rumble === 'function' && navigator.getGamepads) installRumble();

  // ---------------------------------------------------------------- speech
  function installSpeech() {
    var voices = [], live = {}, liveCount = 0, seq = 0, early = [], gotVoices = false;
    var bootT = Date.now();
    var synthLs = {};

    function num(v, d) { v = +v; return v === v ? v : d; }

    function addL(store, type, fn) { if (typeof fn !== 'function') return; (store[type] || (store[type] = [])).push(fn); }
    function remL(store, type, fn) {
      var a = store[type]; if (!a) return;
      for (var i = a.length - 1; i >= 0; i--) if (a[i] === fn) a.splice(i, 1);
    }
    function call(fn, self, ev) {
      try { fn.call(self, ev); } catch (x) { setTimeout(function () { throw x; }, 0); }
    }

    // Utterance (only if the WebView has none of its own)
    function Utt(text) {
      this.text = text == null ? '' : String(text);
      this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
      this.onstart = null; this.onend = null; this.onerror = null;
      this.onpause = null; this.onresume = null; this.onmark = null; this.onboundary = null;
      this._ls = {};
    }
    Utt.prototype.addEventListener = function (t, f) { addL(this._ls, t, f); };
    Utt.prototype.removeEventListener = function (t, f) { remL(this._ls, t, f); };
    // replace a native one too: its 'voice' setter would reject our plain voice objects
    try { Object.defineProperty(W, 'SpeechSynthesisUtterance', { value: Utt, configurable: true, writable: true }); }
    catch (e) { try { W.SpeechSynthesisUtterance = Utt; } catch (e2) { /* read-only */ } }

    function fire(u, type, error) {
      var ev = { type: type, target: u, utterance: u, charIndex: 0, charLength: 0, elapsedTime: 0, name: '', error: error || '' };
      if (u && u._ls) {
        var a = u._ls[type];
        if (a) for (var i = 0; i < a.length; i++) call(a[i], u, ev);
        if (typeof u['on' + type] === 'function') call(u['on' + type], u, ev);
        return;
      }
      if (u && typeof u.dispatchEvent === 'function') { // a native utterance object: on* handlers run too
        try { var e = new Event(type); u.dispatchEvent(e); return; } catch (x) { /* fall through */ }
      }
      if (u && typeof u['on' + type] === 'function') call(u['on' + type], u, ev);
    }
    function fireSynth(type) {
      var ev = { type: type, target: synth }, a = synthLs[type];
      if (a) for (var i = 0; i < a.length; i++) call(a[i], synth, ev);
      if (typeof synth['on' + type] === 'function') call(synth['on' + type], synth, ev);
    }

    function refreshVoices() {
      var arr = [];
      try { arr = JSON.parse(NV.voices() || '[]') || []; } catch (e) { arr = []; }
      voices = [];
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        voices.push({ voiceURI: 'android:' + v.lang, name: String(v.name || v.lang), lang: String(v.lang), localService: true, 'default': !!v['default'] });
      }
    }

    function updateFlags() { synth.speaking = liveCount > 0; synth.pending = liveCount > 1 || early.length > 0; }

    function speak(u) {
      if (!u) return;
      // the TTS engine needs ~1 s to start: keep up to 2 early lines instead of dropping the lesson intro
      if (!gotVoices) {
        if (Date.now() - bootT < 8000) {
          if (early.length >= 2) { var drop = early.shift(); setTimeout(function () { fire(drop, 'end'); }, 0); }
          early.push(u); updateFlags();
          return;
        }
        if (early.length) { // engine never came up: release the waiting lines as errors
          var stale = early; early = [];
          setTimeout(function () { for (var i = 0; i < stale.length; i++) fire(stale[i], 'error', 'synthesis-unavailable'); }, 0);
        }
      }
      var id = 'u' + (++seq), lang = (u.voice && u.voice.lang) || u.lang || '', ok = false;
      try { ok = NV.say(String(u.text == null ? '' : u.text), String(lang), num(u.rate, 1), num(u.pitch, 1), num(u.volume, 1), id); } catch (e) { ok = false; }
      if (!ok) { setTimeout(function () { fire(u, 'error', 'language-unavailable'); }, 0); return; }
      live[id] = u; liveCount++; updateFlags();
    }

    function cancel() {
      try { NV.stop(); } catch (e) { /* engine gone */ }
      var gone = [], k;
      for (k in live) if (Object.prototype.hasOwnProperty.call(live, k)) gone.push(live[k]);
      gone = gone.concat(early);
      live = {}; liveCount = 0; early = []; updateFlags();
      if (gone.length) setTimeout(function () { for (var i = 0; i < gone.length; i++) fire(gone[i], 'end'); }, 0);
    }

    var synth = {
      speaking: false, pending: false, paused: false, onvoiceschanged: null,
      speak: speak,
      cancel: cancel,
      pause: function () { /* not supported by Android TTS */ },
      resume: function () { /* not supported */ },
      getVoices: function () { return voices.slice(); },
      addEventListener: function (t, f) { addL(synthLs, t, f); },
      removeEventListener: function (t, f) { remL(synthLs, t, f); }
    };

    // Java -> page: start | end | error | voices
    W.__dsVoiceEvt = function (type, id) {
      if (type === 'voices') {
        gotVoices = true; refreshVoices(); fireSynth('voiceschanged');
        var q = early; early = []; updateFlags();
        for (var i = 0; i < q.length; i++) speak(q[i]);
        return;
      }
      var u = live[id];
      if (!u) return;
      if (type === 'start') { fire(u, 'start'); return; }
      delete live[id]; liveCount--; updateFlags();
      if (type === 'error') fire(u, 'error', 'synthesis-failed'); else fire(u, 'end');
    };

    refreshVoices();
    if (voices.length) gotVoices = true;
    try { Object.defineProperty(W, 'speechSynthesis', { value: synth, configurable: true, writable: true }); }
    catch (e) { try { W.speechSynthesis = synth; } catch (e2) { /* give up: the page stays silent */ } }
  }

  // ---------------------------------------------------------------- rumble
  function installRumble() {
    function done() { return W.Promise ? W.Promise.resolve('complete') : undefined; }
    var act = {
      type: 'dual-rumble',
      effects: ['dual-rumble'],
      canPlayEffectType: function (t) { return t === 'dual-rumble'; },
      playEffect: function (type, p) {
        p = p || {};
        var s = +p.strongMagnitude || 0, w = +p.weakMagnitude || 0, ms = +p.duration || 0, delay = +p.startDelay || 0;
        var go = function () { try { NP.rumble(s, w, ms); } catch (e) { /* no vibrator */ } };
        if (delay > 0) setTimeout(go, delay); else go();
        return done();
      },
      reset: function () { try { NP.rumble(0, 0, 0); } catch (e) { /* no vibrator */ } return done(); }
    };
    var desc = { value: act, configurable: true, enumerable: true, writable: true };
    var orig = navigator.getGamepads;
    var wrapped = function () {
      var list = orig.apply(navigator, arguments);
      if (list) {
        for (var i = 0; i < list.length; i++) {
          var g = list[i];
          if (g && g.vibrationActuator !== act) { try { Object.defineProperty(g, 'vibrationActuator', desc); } catch (e) { /* frozen */ } }
        }
      }
      return list;
    };
    try { Object.defineProperty(navigator, 'getGamepads', { value: wrapped, configurable: true, writable: true }); }
    catch (e) { try { navigator.getGamepads = wrapped; } catch (e2) { /* leave the original */ } }
  }
})();
