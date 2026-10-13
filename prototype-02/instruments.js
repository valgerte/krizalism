import {
  ctx,
  bus,
  ensure,
  enabled,
  selectPreset,
  ramp,
  makeNoise,
} from "./app.js";
import { vis, setState } from "./visbus.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let mood = "calm",
  fx,
  beatBus,
  synthBus,
  vBus,
  vInput,
  vMonitor,
  vWet,
  vEcho,
  worklet,
  workletPromise;
let run = false,
  step = 0,
  nextTime = 0,
  beatEpoch = 0,
  timer,
  drums = true,
  stream,
  micSource,
  micPending = false,
  micGeneration = 0;
let fileBuffer,
  fileSource,
  fileGeneration = 0;
let layers = [],
  epoch = 0,
  loopRunning = false,
  recording = false,
  recordStart = 0,
  recordEnd = 0,
  takeId = 0,
  loopSeconds = 8;
const notes = Array.from({ length: 25 }, (_, i) => 261.625565 * 2 ** (i / 12)),
  held = new Map(),
  transients = new Set();
const patterns = {
  calm: [
    [0, 8],
    [4, 12],
    [2, 6, 10, 14],
  ],
  focus: [
    [0, 6, 8, 10],
    [4, 12],
    [0, 2, 4, 6, 8, 10, 12, 14],
  ],
};
let pattern = patterns.calm.map((a) => new Set(a));
const setPressed = (el, on) => el.setAttribute("aria-pressed", String(on));
const value = (id) => Number($("#" + id).value);
function gain(v, target) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (target) g.connect(target);
  return g;
}
async function ready() {
  if (!(await ensure())) return false;
  if (!fx) {
    fx = ctx.createWaveShaper();
    fx.oversample = "2x";
    bus.disconnect(bus.filter);
    bus.connect(fx);
    fx.connect(bus.filter);
    beatBus = gain(value("beatLevel") / 100, bus);
    synthBus = gain(value("synthLevel") / 100, bus);
    vBus = gain(value("vLevel") / 100, bus);
    vInput = gain(1);
    vMonitor = gain(0, vInput);
    vInput.connect(vBus);
    const ir = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = ir;
    vWet = gain((value("vReverb") / 100) * 0.85, vBus);
    vInput.connect(reverb);
    reverb.connect(vWet);
    const delay = ctx.createDelay(2),
      feedback = gain(0.48);
    delay.delayTime.value = 0.375;
    vEcho = gain((value("vDelay") / 100) * 0.65, delay);
    vInput.connect(vEcho);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(vBus);
    updateFX();
    ramp(bus.filter.frequency, value("globalTone"));
  }
  return true;
}
function updateFX() {
  if (!fx) return;
  const drive = value("drive") / 100,
    crush = value("crush") / 100;
  if (!drive && !crush) {
    fx.curve = null;
    return;
  }
  const curve = new Float32Array(8192),
    k = 1 + drive * 18,
    levels = 2 ** (12 - Math.round(crush * 9));
  for (let i = 0; i < curve.length; i++) {
    let x = (i / (curve.length - 1)) * 2 - 1;
    x = Math.tanh(x * k) / Math.tanh(k);
    if (crush) x = Math.round(x * levels) / levels;
    curve[i] = x * (1 - drive * 0.6);
  }
  fx.curve = curve;
}
for (const id of ["drive", "crush"]) $("#" + id).oninput = updateFX;
$("#globalTone").oninput = () => {
  if (ctx) ramp(bus.filter.frequency, value("globalTone"));
};
for (const [id, get, max] of [
  ["synthLevel", () => synthBus, 1],
  ["beatLevel", () => beatBus, 1],
  ["vLevel", () => vBus, 1],
  ["vReverb", () => vWet, 0.85],
  ["vDelay", () => vEcho, 0.65],
])
  $("#" + id).oninput = () => {
    if (get()) ramp(get().gain, (value(id) / 100) * max);
  };
function setControl(id, v) {
  $("#" + id).value = v;
  $("#" + id).dispatchEvent(new Event("input"));
}
$$("[data-fx]").forEach(
  (b) =>
    (b.onclick = () => {
      const settings = {
        clean: [0, 0, 4000, 20, 5],
        haze: [8, 0, 1600, 70, 35],
        digital: [65, 80, 5200, 25, 28],
      }[b.dataset.fx];
      vis("fx", { name: b.dataset.fx });
      ["drive", "crush", "globalTone", "reverb", "echo"].forEach((id, i) =>
        setControl(id, settings[i]),
      );
    }),
);
function moodSelect(name) {
  mood = name;
  setState({ mood: name });
  document.body.dataset.mood = name;
  $$("[data-mood]").forEach((b) => setPressed(b, b.dataset.mood === name));
  $("#moodText").innerHTML =
    name === "calm"
      ? "Растворись в мягком звуке.<br>Начни с одного прикосновения."
      : "Найди повторяющийся пульс.<br>Остальное может подождать.";
  selectPreset(name === "calm" ? "dream" : "soft");
  if (!layers.length && !recording)
    setControl("bpm", name === "calm" ? 68 : 96);
  setControl("reverb", name === "calm" ? 65 : 24);
  setControl("echo", name === "calm" ? 26 : 12);
  setControl("globalTone", name === "calm" ? 2200 : 3800);
  setControl("drive", 0);
  setControl("crush", 0);
  setControl("vReverb", name === "calm" ? 75 : 40);
  setControl("vDelay", name === "calm" ? 48 : 24);
  $("#wave").value = name === "calm" ? "sine" : "triangle";
  $("#backing").value = name === "calm" ? "drift" : "pulse";
  pattern = patterns[name].map((a) => new Set(a));
  drawPattern();
}
$$("[data-mood]").forEach(
  (b) => (b.onclick = () => moodSelect(b.dataset.mood)),
);
function synth(
  freq,
  time,
  duration = 0.7,
  volume = 0.09,
  wave = $("#wave").value,
  target = synthBus,
) {
  const osc = ctx.createOscillator(),
    filter = ctx.createBiquadFilter(),
    g = gain(0, target);
  osc.type = wave;
  osc.frequency.value = freq;
  filter.frequency.value = value("synthTone");
  filter.Q.value = 0.4;
  osc.connect(filter);
  filter.connect(g);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(volume, time + 0.025);
  osc.start(time);
  let ended = false;
  const stop = (at = ctx.currentTime) => {
    if (ended) return;
    if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(at);
    else g.gain.cancelScheduledValues(at);
    g.gain.setTargetAtTime(0, at, 0.09);
    osc.stop(at + 0.65);
  };
  osc.onended = () => {
    ended = true;
    osc.disconnect();
    filter.disconnect();
    g.disconnect();
    transients.delete(stop);
  };
  transients.add(stop);
  if (duration !== null) stop(time + duration);
  return { stop, filter };
}
// «Можно отпустить»: while the cloud is held, released keys keep sounding
let sustain = false;
const sustained = new Map();
function releaseSustain() {
  sustained.forEach((b, v) => {
    v.stop();
    vis("note-off", { id: Number(b.dataset.i) });
    b.classList.remove("sustained");
  });
  sustained.clear();
}
window.addEventListener("kr-sustain", (e) => {
  sustain = e.detail;
  if (!sustain) releaseSustain();
});
window.addEventListener("audio-stop", releaseSustain);
// physical key position, so the keys work in any keyboard layout
const keyOf = (e) =>
  e.code?.startsWith("Key")
    ? e.code.slice(3).toLowerCase()
    : e.code === "Semicolon"
      ? ";"
      : e.key.toLowerCase();
const keys = "awsedftgyhujkolp;".split(""),
  noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
let whiteIndex = 0,
  stopGeneration = 0;
const keyActions = [];
notes.forEach((freq, i) => {
  const b = document.createElement("button"),
    black = [1, 3, 6, 8, 10].includes(i % 12);
  b.className = "synth-pad" + (black ? " black" : "");
  b.dataset.i = i;
  b.style.setProperty(
    "--key-left",
    black ? (whiteIndex / 15) * 100 - 2.1 : (whiteIndex / 15) * 100,
  );
  if (!black) whiteIndex++;
  b.innerHTML = `<span>${noteNames[i % 12]}${4 + Math.floor(i / 12)}</span><small>${keys[i]?.toUpperCase() || ""}</small>`;
  b.setAttribute(
    "aria-label",
    `Нота ${noteNames[i % 12]}${4 + Math.floor(i / 12)}`,
  );
  let down = false,
    ticket = 0;
  async function start() {
    if (down) return;
    down = true;
    const t = ++ticket,
      generation = stopGeneration;
    if (
      !(await ready()) ||
      !down ||
      t !== ticket ||
      generation !== stopGeneration
    ) {
      down = false;
      return;
    }
    const v = synth(freq * 2 ** value("octave"), ctx.currentTime, null, 0.07);
    held.set(b, v);
    b.classList.add("playing");
    vis("note-on", { id: i, i });
  }
  function end() {
    down = false;
    ticket++;
    const v = held.get(b);
    held.delete(b);
    b.classList.remove("playing");
    if (v && sustain) {
      sustained.set(v, b);
      b.classList.add("sustained");
      return;
    }
    if (v) vis("note-off", { id: i });
    v?.stop();
  }
  b.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    start();
  };
  b.onpointerup = b.onpointercancel = b.onlostpointercapture = b.onblur = end;
  b.onkeydown = (e) => {
    if ([" ", "Enter"].includes(e.key)) {
      e.preventDefault();
      start();
    }
  };
  b.onkeyup = (e) => {
    if ([" ", "Enter"].includes(e.key)) end();
  };
  keyActions.push({ start, end });
  $("#synthPads").append(b);
});
window.addEventListener("keydown", (e) => {
  if (
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) ||
    $("#info").open
  )
    return;
  const i = keys.indexOf(keyOf(e));
  if (i >= 0) {
    e.preventDefault();
    keyActions[i].start();
  }
});
window.addEventListener("keyup", (e) => {
  const i = keys.indexOf(keyOf(e));
  if (i >= 0) keyActions[i].end();
});
$("#synthTone").oninput = () =>
  held.forEach((v) => ramp(v.filter.frequency, value("synthTone")));
function drum(row, time) {
  setTimeout(() => vis("drum", { row }), Math.max(0, (time - ctx.currentTime) * 1000));
  if (row === 0) {
    const o = ctx.createOscillator(),
      g = gain(0, beatBus);
    o.frequency.setValueAtTime(120, time);
    o.frequency.exponentialRampToValueAtTime(48, time + 0.12);
    g.gain.setValueAtTime(0.24, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    o.connect(g);
    o.start(time);
    o.stop(time + 0.25);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  } else {
    const n = makeNoise(),
      f = ctx.createBiquadFilter(),
      g = gain(0, beatBus);
    f.type = row === 1 ? "bandpass" : "highpass";
    f.frequency.value = row === 1 ? 1600 : 4200;
    g.gain.setValueAtTime(row === 1 ? 0.15 : 0.065, time);
    g.gain.exponentialRampToValueAtTime(
      0.0001,
      time + (row === 1 ? 0.15 : 0.055),
    );
    n.connect(f);
    f.connect(g);
    n.start(time);
    n.stop(time + 0.2);
    n.onended = () => {
      n.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }
}
function drawPattern() {
  const root = $("#sequencer");
  root.replaceChildren();
  ["Низ", "Щелчок", "Шорох"].forEach((name, row) => {
    const label = document.createElement("span");
    label.textContent = name;
    root.append(label);
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("button");
      b.className = "step";
      b.dataset.step = i;
      b.setAttribute("aria-label", `${name}, шаг ${i + 1}`);
      setPressed(b, pattern[row].has(i));
      b.onclick = () => {
        pattern[row].has(i) ? pattern[row].delete(i) : pattern[row].add(i);
        setPressed(b, pattern[row].has(i));
      };
      root.append(b);
    }
  });
}
function schedule() {
  if (!run) return;
  while (nextTime < ctx.currentTime + 0.12) {
    const s = step % 16,
      t = nextTime,
      beat = 60 / value("bpm");
    if (drums)
      pattern.forEach((p, row) => {
        if (p.has(s)) drum(row, t);
      });
    const backing = $("#backing").value,
      root = [130.815, 110, 174.615, 146.83][Math.floor(step / 16) % 4];
    if (backing === "drift" && s === 0)
      [1, 1.5, 2.5].forEach((r) =>
        synth(root * r, t, beat * 3.6, 0.045, "sine", beatBus),
      );
    if (backing === "pulse" && s % 4 === 0)
      synth(root, t, beat * 0.65, 0.12, "triangle", beatBus);
    if (backing === "steps" && s % 2 === 0)
      synth(
        root * [2, 2.5, 3, 4][(s / 2) % 4],
        t,
        beat * 0.5,
        0.09,
        "triangle",
        beatBus,
      );
    const visualStep = s;
    setTimeout(
      () => {
        if (run)
          $$(".step").forEach((b) =>
            b.classList.toggle(
              "current",
              Number(b.dataset.step) === visualStep,
            ),
          );
      },
      Math.max(0, (t - ctx.currentTime) * 1000),
    );
    step++;
    nextTime += beat / 4;
  }
}
function stopBeat() {
  run = false;
  clearInterval(timer);
  $("#beatPlay").textContent = "▶ Запустить";
  setPressed($("#beatPlay"), false);
  $$(".step").forEach((b) => b.classList.remove("current"));
}
$("#beatPlay").onclick = async () => {
  if (run) {
    stopBeat();
    return;
  }
  const generation = stopGeneration;
  if (!(await ready()) || run || generation !== stopGeneration) return;
  run = true;
  const tick = 60 / value("bpm") / 4;
  beatEpoch = loopRunning ? epoch : ctx.currentTime + 0.04;
  step = loopRunning
    ? Math.max(0, Math.ceil((ctx.currentTime + 0.04 - epoch) / tick))
    : 0;
  nextTime = beatEpoch + step * tick;
  timer = setInterval(schedule, 25);
  schedule();
  $("#beatPlay").textContent = "Ⅱ Остановить";
  setPressed($("#beatPlay"), true);
};
$("#drums").onclick = () => {
  drums = !drums;
  setPressed($("#drums"), drums);
  $("#drums").textContent = `Ударные: ${drums ? "вкл." : "выкл."}`;
};
$("#bpm").oninput = () => ($("#bpmOut").textContent = value("bpm") + " BPM");
function stopFile() {
  if (fileSource) {
    fileSource.stop();
    fileSource.disconnect();
    fileSource = null;
  }
  $("#filePlay").textContent = "▶ Файл";
  setPressed($("#filePlay"), false);
}
$("#audioFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const ticket = ++fileGeneration;
  stopFile();
  fileBuffer = null;
  $("#filePlay").disabled = true;
  $("#fileClear").disabled = false;
  if (f.size > 30 * 1024 * 1024) {
    $("#fileStatus").textContent = "Выбери файл меньше 30 МБ.";
    return;
  }
  $("#fileStatus").textContent = "Загружаем аудио…";
  try {
    if (!(await ready())) return;
    const decoded = await ctx.decodeAudioData(await f.arrayBuffer());
    if (ticket !== fileGeneration) return;
    if (decoded.duration > 300) throw Error("Нужен трек не длиннее 5 минут.");
    fileBuffer = decoded;
    $("#filePlay").disabled = false;
    $("#fileStatus").textContent = f.name + " · отдельный луп";
  } catch (e) {
    if (ticket === fileGeneration)
      $("#fileStatus").textContent = "Не удалось прочитать аудио. " + e.message;
  }
};
$("#filePlay").onclick = async () => {
  if (fileSource) {
    stopFile();
    return;
  }
  const generation = stopGeneration;
  if (
    !fileBuffer ||
    !(await ready()) ||
    !fileBuffer ||
    fileSource ||
    generation !== stopGeneration
  )
    return;
  fileSource = ctx.createBufferSource();
  fileSource.buffer = fileBuffer;
  fileSource.loop = true;
  fileSource.connect(beatBus);
  fileSource.start();
  $("#filePlay").textContent = "Ⅱ Остановить файл";
  setPressed($("#filePlay"), true);
};
$("#fileClear").onclick = () => {
  fileGeneration++;
  stopFile();
  fileBuffer = null;
  $("#audioFile").value = "";
  $("#filePlay").disabled = true;
  $("#fileClear").disabled = true;
  $("#fileStatus").textContent =
    "Выбери свой аудиофайл. Он остаётся в этой вкладке.";
};
async function setupWorklet() {
  if (worklet) return;
  if (!ctx.audioWorklet)
    throw Error(
      "Лупер недоступен в этом браузере. Попробуй актуальный Chrome или Safari.",
    );
  if (!workletPromise)
    workletPromise = ctx.audioWorklet
      .addModule("./looper-worklet.js")
      .catch((e) => {
        workletPromise = null;
        throw e;
      });
  await workletPromise;
  worklet = new AudioWorkletNode(ctx, "voice-capture");
  const silent = gain(0, ctx.destination);
  worklet.connect(silent);
  worklet.port.onmessage = (e) => {
    if (e.data.type !== "take" || e.data.id !== takeId || !recording) return;
    recording = false;
    const b = ctx.createBuffer(1, e.data.samples.length, ctx.sampleRate),
      data = e.data.samples;
    const fade = Math.min(256, Math.floor(data.length / 2));
    for (let i = 0; i < fade; i++) {
      data[i] *= i / fade;
      data[data.length - 1 - i] *= i / fade;
    }
    b.copyToChannel(data, 0);
    loopSeconds = b.duration;
    if (!loopRunning) {
      epoch = recordStart;
      loopRunning = true;
    }
    const layer = {
      buffer: b,
      gain: gain(0.65, vInput),
      source: null,
      muted: false,
    };
    layers.push(layer);
    vis("layer", { n: layers.length });
    startLayer(layer);
    renderLayers();
    $("#voiceStatus").textContent =
      `Слой ${layers.length} готов. Можно добавить следующий.`;
    updateLoopUI();
  };
}
async function enableMic() {
  if (micPending || stream) return;
  const ticket = ++micGeneration;
  micPending = true;
  $("#mic").disabled = true;
  $("#voiceStatus").textContent = "Разреши доступ к микрофону в браузере.";
  let incoming;
  try {
    if (!(await ready())) throw Error("Звук недоступен.");
    await setupWorklet();
    if (ticket !== micGeneration) return;
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("Микрофон недоступен в этом браузере.");
    incoming = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    if (ticket !== micGeneration) {
      incoming.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = incoming;
    micSource = ctx.createMediaStreamSource(stream);
    micSource.connect(worklet);
    micSource.connect(vMonitor);
    stream.getTracks().forEach((t) => (t.onended = () => disableMic()));
    $("#mic").textContent = "Выключить микрофон";
    setPressed($("#mic"), true);
    $("#monitor").disabled = false;
    $("#voiceStatus").textContent =
      "Микрофон готов. Запиши слой или включи прослушивание в наушниках.";
  } catch (e) {
    incoming?.getTracks().forEach((t) => t.stop());
    if (ticket === micGeneration)
      $("#voiceStatus").textContent =
        e.name === "NotAllowedError"
          ? "Доступ к микрофону не разрешён. Остальная доска работает без него."
          : e.message;
  } finally {
    if (ticket === micGeneration) {
      micPending = false;
      $("#mic").disabled = false;
      updateLoopUI();
    }
  }
}
function cancelTake() {
  takeId++;
  recording = false;
  worklet?.port.postMessage({ type: "cancel" });
  $("#loopProgress").value = 0;
}
function disableMic() {
  micGeneration++;
  micPending = false;
  cancelTake();
  micSource?.disconnect();
  micSource = null;
  if (stream) {
    stream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    stream = null;
  }
  if (vMonitor) ramp(vMonitor.gain, 0);
  $("#mic").disabled = false;
  $("#mic").textContent = "Включить микрофон";
  setPressed($("#mic"), false);
  $("#monitor").disabled = true;
  setPressed($("#monitor"), false);
  $("#monitor").textContent = "Слышать себя: выкл.";
  renderLayers();
  updateLoopUI();
}
$("#mic").onclick = () => (stream ? disableMic() : enableMic());
$("#monitor").onclick = () => {
  if (!stream) return;
  const on = $("#monitor").getAttribute("aria-pressed") !== "true";
  ramp(vMonitor.gain, on ? 0.6 : 0);
  setPressed($("#monitor"), on);
  $("#monitor").textContent = `Слышать себя: ${on ? "вкл." : "выкл."}`;
};
function startLayer(layer) {
  const s = ctx.createBufferSource();
  s.buffer = layer.buffer;
  s.loop = true;
  s.connect(layer.gain);
  const at = ctx.currentTime + 0.035,
    offset = (((at - epoch) % loopSeconds) + loopSeconds) % loopSeconds;
  s.start(at, offset);
  layer.source = s;
}
function stopLoops() {
  layers.forEach((l) => {
    l.source?.stop();
    l.source?.disconnect();
    l.source = null;
  });
  loopRunning = false;
  cancelTake();
  renderLayers();
  updateLoopUI();
}
function updateLoopUI() {
  const n = layers.length;
  $("#loopRecord").disabled = !stream || recording || n >= 6;
  $("#loopRecord").textContent = recording
    ? "● Записываем…"
    : n
      ? "● Добавить слой"
      : "● Записать слой";
  $("#loopPlay").disabled = !n || recording;
  $("#loopPlay").textContent = loopRunning ? "Ⅱ Остановить слои" : "▶ Слои";
  setPressed($("#loopPlay"), loopRunning);
  $("#loopLength").disabled = !!n || recording;
  $("#bpm").disabled = !!n || recording;
  $("#bpm").title = n || recording ? "Удалите слои, чтобы изменить темп" : "";
}
function renderLayers() {
  const root = $("#layers");
  root.replaceChildren();
  layers.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "layer";
    const name = document.createElement("span");
    name.textContent = `Слой ${i + 1}`;
    const mute = document.createElement("button");
    mute.textContent = l.muted ? "Включить" : "Приглушить";
    setPressed(mute, l.muted);
    mute.onclick = () => {
      l.muted = !l.muted;
      ramp(l.gain.gain, l.muted ? 0 : 0.65);
      renderLayers();
    };
    const del = document.createElement("button");
    del.textContent = "Удалить";
    del.disabled = recording;
    del.onclick = () => {
      l.source?.stop();
      l.source?.disconnect();
      l.gain.disconnect();
      layers.splice(i, 1);
      vis("layer", { n: layers.length });
      if (!layers.length) stopLoops();
      renderLayers();
      updateLoopUI();
    };
    row.append(name, mute, del);
    root.append(row);
  });
}
$("#loopRecord").onclick = async () => {
  if (
    !stream ||
    recording ||
    layers.length >= 6 ||
    !(await ready()) ||
    !stream ||
    recording
  )
    return;
  loopSeconds = layers.length
    ? layers[0].buffer.duration
    : (60 / value("bpm")) * 4 * value("loopLength");
  if (layers.length && !loopRunning) {
    epoch = run ? beatEpoch : ctx.currentTime + 0.1;
    loopRunning = true;
    layers.forEach(startLayer);
  }
  const now = ctx.currentTime + 0.2;
  const grid = loopRunning ? epoch : run ? beatEpoch : null;
  recordStart =
    grid !== null
      ? grid + Math.ceil((now - grid) / loopSeconds) * loopSeconds
      : now;
  recordEnd = recordStart + loopSeconds;
  recording = true;
  const id = ++takeId;
  worklet.port.postMessage({
    type: "record",
    id,
    start: Math.round(recordStart * ctx.sampleRate),
    length: Math.round(loopSeconds * ctx.sampleRate),
  });
  updateLoopUI();
  renderLayers();
};
$("#loopPlay").onclick = async () => {
  if (loopRunning) {
    stopLoops();
    return;
  }
  const generation = stopGeneration;
  if (
    !layers.length ||
    !(await ready()) ||
    !layers.length ||
    loopRunning ||
    generation !== stopGeneration
  )
    return;
  epoch = run ? beatEpoch : ctx.currentTime + 0.08;
  loopRunning = true;
  layers.forEach(startLayer);
  updateLoopUI();
};
setInterval(() => {
  if (!recording || !ctx) return;
  const now = ctx.currentTime;
  if (now < recordStart) {
    $("#voiceStatus").textContent =
      `До записи ${Math.ceil(recordStart - now)} с · ждём начало цикла`;
    $("#loopProgress").value = 0;
  } else {
    $("#voiceStatus").textContent =
      `Запись слоя · осталось ${Math.max(0, Math.ceil(recordEnd - now))} с`;
    $("#loopProgress").value = Math.min(1, (now - recordStart) / loopSeconds);
  }
}, 100);
function allStop() {
  stopGeneration++;
  keyActions.forEach((k) => k.end());
  stopBeat();
  stopFile();
  stopLoops();
  disableMic();
  held.forEach((v) => v.stop());
  held.clear();
  transients.forEach((stop) => stop());
  $$(".synth-pad").forEach((b) => b.classList.remove("playing"));
}
window.addEventListener("audio-stop", allStop);
window.addEventListener("pagehide", allStop);
window.addEventListener("blur", () => {
  stopGeneration++;
  keyActions.forEach((k) => k.end());
  held.forEach((v) => v.stop());
  held.clear();
  $$(".synth-pad").forEach((b) => b.classList.remove("playing"));
});
$("#reset").addEventListener("click", () => {
  layers.forEach((l) => l.gain.disconnect());
  layers = [];
  renderLayers();
  fileGeneration++;
  fileBuffer = null;
  $("#filePlay").disabled = true;
  $("#fileClear").disabled = true;
  $("#audioFile").value = "";
  setTimeout(() => {
    moodSelect("calm");
    updateLoopUI();
  }, 0);
});
moodSelect("calm");

$$("[data-preset]").forEach((b) =>
  b.addEventListener("click", () =>
    setControl(
      "globalTone",
      { soft: 1800, glass: 5000, dream: 850 }[b.dataset.preset],
    ),
  ),
);

// «Своя орбита»: turning the ring sends the voice further into echo and reverb
window.addEventListener("kr-ring", (e) => {
  setControl("vDelay", Math.round(10 + e.detail * 80));
  setControl("vReverb", Math.round(20 + e.detail * 80));
});
// «Тихий шорох»: while the silk is touched it sweeps the master filter, then returns
let toneBefore = null;
window.addEventListener("kr-silk", (e) => {
  if (toneBefore === null) toneBefore = value("globalTone");
  setControl("globalTone", Math.round(300 * (10000 / 300) ** e.detail.x));
});
window.addEventListener("kr-silk-end", () => {
  if (toneBefore !== null) setControl("globalTone", toneBefore);
  toneBefore = null;
});
