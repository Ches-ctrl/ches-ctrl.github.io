/**
 * The voice interface for /ask/. One file, no dependencies, loaded only when
 * someone clicks - see the stub in shell() and the note in CLAUDE.md.
 *
 * Audio in:  mic -> AudioWorklet -> downsample -> PCM16 LE -> base64 -> WebSocket
 * Audio out: base64 -> PCM16 LE -> AudioBuffer -> scheduled on a running cursor
 *
 * The AudioWorklet is loaded from a Blob URL rather than its own file, so this
 * stays a single request.
 */
(function () {
  'use strict';

  var CFG = window.__askConfig || {};
  var ctx = null;        // AudioContext, created inside the click handler
  var mic = null;        // { stream, node, source, analyser, close() }

  // ---------------------------------------------------------------- encoding

  /**
   * Box-average decimation. The device gives us whatever it likes (usually 48kHz);
   * the agent negotiates its own rate. Not a windowed anti-alias filter, but for
   * speech at these ratios the difference is inaudible.
   */
  function downsample(f32, inRate, outRate) {
    if (inRate === outRate) return f32;
    var ratio = inRate / outRate;
    var n = Math.floor(f32.length / ratio);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var start = Math.floor(i * ratio);
      var end = Math.floor((i + 1) * ratio);
      var sum = 0, count = 0;
      for (var j = start; j < end && j < f32.length; j++) { sum += f32[j]; count++; }
      out[i] = count ? sum / count : 0;
    }
    return out;
  }

  /** Float32 [-1,1] to signed 16-bit little-endian. */
  function pcm16(f32) {
    var buf = new ArrayBuffer(f32.length * 2);
    var view = new DataView(buf);
    for (var i = 0; i < f32.length; i++) {
      var s = f32[i] < -1 ? -1 : f32[i] > 1 ? 1 : f32[i];
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  /** Chunked so a long buffer does not blow the argument limit on apply(). */
  function b64(buf) {
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  /** base64 PCM16 LE back to Float32, for playback. */
  function unb64(s) {
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var view = new DataView(bytes.buffer);
    var out = new Float32Array(bytes.length / 2);
    for (var k = 0; k < out.length; k++) out[k] = view.getInt16(k * 2, true) / 0x8000;
    return out;
  }

  // ---------------------------------------------------------------- capture

  var WORKLET = [
    'class Cap extends AudioWorkletProcessor {',
    '  process(inputs) {',
    '    const ch = inputs[0] && inputs[0][0];',
    '    if (ch) this.port.postMessage(new Float32Array(ch));',
    '    return true;',
    '  }',
    '}',
    'registerProcessor("cap", Cap);',
  ].join('\n');

  /**
   * Open the microphone and call onChunk(base64) roughly four times a second.
   *
   * The worklet hands back 128 frames at a time, which is far too small to send
   * individually, so frames accumulate until there are `rate / 4` of them at the
   * negotiated rate - about 250ms of audio per message.
   */
  async function openMic(opts) {
    var stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    var url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    var source = ctx.createMediaStreamSource(stream);
    var node = new AudioWorkletNode(ctx, 'cap');
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;

    source.connect(analyser);
    source.connect(node);
    // The worklet returns nothing, but Chrome will not pull from a node with no
    // destination, so it is connected to a muted gain rather than left dangling.
    var sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);

    var target = Math.round(opts.rate / 4);
    var pending = [];
    var pendingLength = 0;

    node.port.onmessage = function (e) {
      var chunk = downsample(e.data, ctx.sampleRate, opts.rate);
      pending.push(chunk);
      pendingLength += chunk.length;
      if (pendingLength < target) return;
      var merged = new Float32Array(pendingLength);
      var at = 0;
      for (var i = 0; i < pending.length; i++) { merged.set(pending[i], at); at += pending[i].length; }
      pending = [];
      pendingLength = 0;
      opts.onChunk(b64(pcm16(merged)), merged);
    };

    return {
      stream: stream,
      analyser: analyser,
      close: function () {
        node.port.onmessage = null;
        try { node.disconnect(); source.disconnect(); sink.disconnect(); } catch (e) {}
        stream.getTracks().forEach(function (t) { t.stop(); });
      },
    };
  }

  // ---------------------------------------------------------------- playback

  var out = null;        // { gain, analyser }
  var sources = [];      // scheduled AudioBufferSourceNodes, so they can be cut
  var cursor = 0;        // when the next chunk should start, in context time
  var outRate = 16000;   // replaced by the negotiated rate

  function ensureOutput() {
    if (out) return out;
    var gain = ctx.createGain();
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;
    gain.connect(analyser);
    gain.connect(ctx.destination);
    out = { gain: gain, analyser: analyser };
    return out;
  }

  /**
   * Chunks arrive faster than they play, so each is scheduled at a running cursor
   * rather than started immediately. The 50ms floor when the cursor has fallen
   * behind absorbs a late chunk without a click.
   */
  function play(base64) {
    var f32 = unb64(base64);
    var buf = ctx.createBuffer(1, f32.length, outRate);
    buf.getChannelData(0).set(f32);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ensureOutput().gain);
    var now = ctx.currentTime;
    if (cursor < now) cursor = now + 0.05;
    src.start(cursor);
    cursor += buf.duration;
    sources.push(src);
    src.onended = function () {
      var i = sources.indexOf(src);
      if (i > -1) sources.splice(i, 1);
      if (!sources.length) setState('listening');
    };
    setState('speaking');
  }

  /** Cut everything queued. The server sends `interruption` the moment the user talks over it. */
  function flush() {
    sources.forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} });
    sources = [];
    cursor = 0;
  }

  // ---------------------------------------------------------------- state

  var state = 'idle';
  var stateHandlers = [];
  var turnHandlers = [];

  function setState(next) {
    if (state === next) return;
    state = next;
    stateHandlers.forEach(function (fn) { fn(next); });
  }

  function emitTurn(who, text) {
    turnHandlers.forEach(function (fn) { fn(who, text); });
  }

  // ---------------------------------------------------------------- socket

  var ws = null;

  /** `pcm_16000` -> 16000. The format is whatever the agent is configured for. */
  function rateOf(format, fallback) {
    var m = /^pcm_(\d+)$/.exec(String(format || ''));
    return m ? parseInt(m[1], 10) : fallback;
  }

  async function connect() {
    setState('connecting');
    ws = new WebSocket(CFG.wsUrl + '?agent_id=' + encodeURIComponent(CFG.agentId));

    ws.onopen = function () {
      ws.send(JSON.stringify({ type: 'conversation_initiation_client_data' }));
    };

    ws.onmessage = async function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }

      switch (msg.type) {
        case 'conversation_initiation_metadata': {
          var meta = msg.conversation_initiation_metadata_event || {};
          outRate = rateOf(meta.agent_output_audio_format, 16000);
          var inRate = rateOf(meta.user_input_audio_format, 16000);
          ensureOutput();
          mic = await openMic({
            rate: inRate,
            onChunk: function (chunk) {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ user_audio_chunk: chunk }));
              }
            },
          });
          setState('listening');
          break;
        }

        case 'audio':
          play(msg.audio_event.audio_base_64);
          break;

        case 'interruption':
          flush();
          setState('listening');
          break;

        // A missed pong drops the connection, so this is not optional.
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event.event_id }));
          break;

        case 'user_transcript':
          emitTurn('You', msg.user_transcription_event.user_transcript);
          break;

        case 'agent_response':
          emitTurn('This site', msg.agent_response_event.agent_response);
          break;
      }
    };

    ws.onerror = function () { setState('error'); };
    ws.onclose = function () { if (state !== 'error') setState('ended'); };
  }

  // ---------------------------------------------------------------- entry

  /**
   * iOS will not start an AudioContext outside a user gesture, and an `await`
   * before the first resume() breaks the gesture chain in some Safari versions -
   * so the context is created and resumed synchronously, before anything async.
   */
  function ensureContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  window.__ask = {
    start: function () {
      if (state !== 'idle' && state !== 'ended' && state !== 'error') return;
      ensureContext();      // synchronous, before any await - iOS
      ensureOutput();
      connect();
    },

    stop: function () {
      flush();
      if (mic) { mic.close(); mic = null; }
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      setState('ended');
    },

    onState: function (fn) { stateHandlers.push(fn); fn(state); },
    onTurn: function (fn) { turnHandlers.push(fn); },
    get state() { return state; },
    analysers: function () { return { input: mic && mic.analyser, output: out && out.analyser }; },

    // Exposed for scripts/voice-codec.test.js. The resampler, the PCM encoder and
    // the format negotiator are pure functions and the only part of this file
    // testable without a microphone, which is the whole reason they are reachable
    // from outside the closure.
    __codec: { downsample: downsample, pcm16: pcm16, b64: b64, unb64: unb64, rateOf: rateOf },
  };

  // Free the microphone if the page is left mid-conversation.
  window.addEventListener('pagehide', function () { window.__ask.stop(); });
})();
