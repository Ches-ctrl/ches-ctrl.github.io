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

    // Everything below can throw (a locked-down browser can refuse the worklet
    // module, for instance). getUserMedia has already lit the mic indicator by
    // this point, so any failure from here on must stop the stream's tracks
    // before re-throwing - otherwise the indicator stays lit with nothing using it.
    try {
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
    } catch (err) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      throw err;
    }

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
  var drainTimer = null; // debounces speaking -> listening across a network stall

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
    // A new chunk means the queue was never really empty - cancel any pending
    // drain from a previous gap so it cannot fire mid-utterance.
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }

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
      // The queue draining to empty isn't proof the turn is over - a network
      // stall between chunks looks identical. Wait a beat, and only flip state
      // if it's still empty afterward, so a fresh chunk arriving in the gap
      // (see the clearTimeout above) wins over a premature 'listening'.
      if (!sources.length) {
        if (drainTimer) clearTimeout(drainTimer);
        drainTimer = setTimeout(function () {
          drainTimer = null;
          if (!sources.length && state === 'speaking') setState('listening');
        }, 150);
      }
    };
    setState('speaking');
  }

  /** Cut everything queued. The server sends `interruption` the moment the user talks over it. */
  function flush() {
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    sources.forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} });
    sources = [];
    cursor = 0;
  }

  /** Every terminal path has to release the microphone, not just an explicit stop().
      A dropped connection that leaves the worklet running feeds the next socket too. */
  function releaseMic() {
    if (mic) { mic.close(); mic = null; }
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
    var socket = new WebSocket(CFG.wsUrl + '?agent_id=' + encodeURIComponent(CFG.agentId));
    ws = socket;

    // Handlers bind to the socket object, not to `ws` - so an abandoned socket's
    // events still fire (a close, or even a late message, can arrive well after
    // start()/stop() has moved `ws` on to a different conversation), and by then
    // `mic` and `state` may belong to that newer conversation. Anything but the
    // current socket has nothing to say about it.
    function current() { return ws === socket; }

    socket.onopen = function () {
      socket.send(JSON.stringify({ type: 'conversation_initiation_client_data' }));
    };

    socket.onmessage = async function (event) {
      if (!current()) return;
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }

      // The pong is what keeps the connection alive, so it goes out before
      // anything below that could throw - a malformed ping frame must still be
      // answered, not just a well-formed one. Handled outside the try/catch
      // below on purpose: nothing gets a chance to pre-empt it.
      if (msg.type === 'ping') {
        var pingId = msg.ping_event && msg.ping_event.event_id;
        socket.send(JSON.stringify({ type: 'pong', event_id: pingId }));
        return;
      }

      // One malformed frame should not take down the handler for every frame
      // after it. Logged rather than silently swallowed, so a real bug still
      // surfaces - just without costing the connection.
      try {
        switch (msg.type) {
          case 'conversation_initiation_metadata': {
            var meta = msg.conversation_initiation_metadata_event || {};
            var outFormat = meta.agent_output_audio_format || '';
            var inFormat = meta.user_input_audio_format || '';

            // Anything other than pcm_* is a real agent misconfiguration, not
            // missing data - proceeding would silently feed mu-law bytes through
            // the PCM path and come out as noise, with nothing in the console to
            // say why. Refusing loudly here means the failure is "check the
            // agent's audio format in the ElevenLabs dashboard", not a bug report
            // about garbled audio.
            if (!/^pcm_/.test(outFormat) || !/^pcm_/.test(inFormat)) {
              console.error(
                'voice.js: agent is not configured for PCM audio (output=' + outFormat +
                ', input=' + inFormat + ') - set both to a pcm_* format in the ElevenLabs dashboard'
              );
              setState('error');
              try { socket.close(); } catch (e) {}
              break;
            }

            outRate = rateOf(outFormat, 16000);
            var inRate = rateOf(inFormat, 16000);
            ensureOutput();
            try {
              mic = await openMic({ rate: inRate, onChunk: function (chunk) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ user_audio_chunk: chunk }));
                }
              } });
            } catch (err) {
              showError(
                err && err.name === 'NotAllowedError'
                  ? 'No microphone access, so there is nothing to listen to. The questions above are the same ones I would have answered.'
                  : 'That microphone would not open. The questions above are the same ones I would have answered.'
              );
              setState('error');
              try { socket.close(); } catch (e) {}
              // openMic() awaited above, so a newer connect() could have moved
              // `ws` on in the meantime - only clear it if this socket is still
              // the one it points to.
              if (current()) ws = null;
              return;
            }
            setState('listening');
            break;
          }

          case 'audio': {
            var audio = msg.audio_event || {};
            if (audio.audio_base_64) play(audio.audio_base_64);
            break;
          }

          case 'interruption':
            flush();
            setState('listening');
            break;

          case 'user_transcript': {
            var userText = (msg.user_transcription_event || {}).user_transcript;
            if (userText) emitTurn('You', userText);
            break;
          }

          case 'agent_response': {
            var agentText = (msg.agent_response_event || {}).agent_response;
            if (agentText) emitTurn('This site', agentText);
            break;
          }
        }
      } catch (e) {
        console.error('voice.js: failed to handle message', msg && msg.type, e);
      }
    };

    socket.onerror = function () {
      if (!current()) return;
      showError('That connection dropped. Try again in a moment.');
      releaseMic();
      setState('error');
    };
    socket.onclose = function () {
      if (!current()) return;
      releaseMic();
      if (state !== 'error') setState('ended');
    };
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

  // ---------------------------------------------------------------- the page

  var el = {
    start: document.getElementById('ask-start'),
    wave: document.getElementById('ask-wave'),
    transcript: document.getElementById('ask-transcript'),
    error: document.getElementById('ask-error'),
  };

  var LABEL = {
    idle: 'Ask a question →',
    connecting: 'Connecting…',
    listening: 'Stop',
    speaking: 'Stop',
    ended: 'Ask another question →',
    error: 'Try again →',
  };

  function renderState(next) {
    if (el.start && el.start.firstElementChild) el.start.firstElementChild.textContent = LABEL[next] || LABEL.idle;
    if (el.wave) {
      el.wave.classList.toggle('on', next === 'listening' || next === 'speaking' || next === 'connecting');
      el.wave.classList.toggle('speaking', next === 'speaking');
    }
    if (el.error && next !== 'error') el.error.hidden = true;
  }

  /**
   * One turn per speaker change. The agent's text arrives as one message per
   * response, so a turn is never rewritten - it is appended and left alone.
   */
  function renderTurn(who, text) {
    if (!el.transcript || !text) return;
    var div = document.createElement('div');
    div.className = 'ask-turn';
    var label = document.createElement('span');
    label.className = 'who';
    label.textContent = who;
    var p = document.createElement('p');
    p.textContent = text;      // textContent, not innerHTML - this is untrusted output
    div.appendChild(label);
    div.appendChild(p);
    el.transcript.appendChild(div);
  }

  function showError(message) {
    if (!el.error) return;
    el.error.textContent = message;
    el.error.hidden = false;
  }

  window.__ask = {
    start: function () {
      if (state === 'listening' || state === 'speaking' || state === 'connecting') {
        return window.__ask.stop();
      }
      if (el.transcript && (state === 'ended' || state === 'error')) el.transcript.innerHTML = '';
      // Belt and braces: a dropped connection's mic should already be released
      // by ws.onerror/onclose, but a fresh conversation must never be able to
      // inherit a live microphone or a stale socket even if some future path
      // forgets to clean up.
      releaseMic();
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      ensureContext();      // synchronous, before any await - iOS
      ensureOutput();
      connect();
    },

    stop: function () {
      flush();
      releaseMic();
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

  window.__ask.onState(renderState);
  window.__ask.onTurn(renderTurn);

  // Free the microphone if the page is left mid-conversation.
  window.addEventListener('pagehide', function () { window.__ask.stop(); });
})();
