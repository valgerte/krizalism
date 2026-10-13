import { vis, setState, attachAnalyser, onLocal, getState } from "./visbus.js";
import { startProjection } from "./projection.js";
const $ = (s) => document.querySelector(s);
const presets = {
  soft: {
    cloudBase: 220,
    base: 170,
    cutoff: 1800,
    decay: 0.16,
    reverb: 0.18,
    echo: 0.04,
  },
  glass: {
    cloudBase: 351,
    base: 540,
    cutoff: 5000,
    decay: 0.32,
    reverb: 0.32,
    echo: 0.12,
  },
  dream: {
    cloudBase: 185,
    base: 115,
    cutoff: 850,
    decay: 0.22,
    reverb: 0.46,
    echo: 0.06,
  },
};
let preset = "soft",
  ctx,
  bus,
  master,
  wet,
  delaySend,
  noiseBuffer,
  recorder,
  recordDest,
  recordURL,
  enabled = false,
  initPromise,
  active = new Set(),
  recordTimer;
const status = (t) => ($("#status").textContent = t);
function ramp(param, value, t = 0.035) {
  param.setTargetAtTime(value, ctx.currentTime, t);
}
function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw Error("Браузер не поддерживает Web Audio");
  ctx = new AC();
  bus = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = presets[preset].cutoff;
  bus.connect(filter);
  bus.filter = filter;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 18;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master = ctx.createGain();
  master.gain.value = Number($("#volume").value) / 100;
  filter.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);
  const convolver = ctx.createConvolver(),
    ir = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * 0.6;
  }
  convolver.buffer = ir;
  wet = ctx.createGain();
  wet.gain.value = (Number($("#reverb").value) / 100) * 0.7;
  filter.connect(convolver);
  convolver.connect(wet);
  wet.connect(comp);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.28;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.22;
  delaySend = ctx.createGain();
  delaySend.gain.value = (Number($("#echo").value) / 100) * 0.5;
  filter.connect(delaySend);
  delaySend.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(comp);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  let last = 0;
  const nd = noiseBuffer.getChannelData(0);
  for (let i = 0; i < nd.length; i++) {
    last = (last + 0.025 * (Math.random() * 2 - 1)) / 1.025;
    nd[i] = last * 5;
  }
  recordDest = ctx.createMediaStreamDestination();
  master.connect(recordDest);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  master.connect(analyser);
  attachAnalyser(analyser);
}
async function ensure() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      init();
      await ctx.resume();
      enabled = true;
      $("#power").setAttribute("aria-pressed", "true");
      $("#power span").textContent = "Выключить звук";
      status("Можно играть. В своём темпе.");
      return true;
    } catch (e) {
      status("Звук недоступен: " + e.message);
      return false;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}
function stopAll() {
  for (const stop of [...active]) stop();
  document
    .querySelectorAll(".holding")
    .forEach((e) => e.classList.remove("holding"));
}
async function powerOff() {
  window.dispatchEvent(new Event("audio-stop"));
  enabled = false;
  stopAll();
  if (ctx) await ctx.suspend();
  $("#power").setAttribute("aria-pressed", "false");
  $("#power span").textContent = "Включить звук";
  status("Тихая пауза. Звук выключен.");
}
$("#power").onclick = () => (enabled ? powerOff() : ensure());
function makeNoise() {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer;
  s.loop = true;
  return s;
}
function voice(kind, freq = 170) {
  const now = ctx.currentTime,
    g = ctx.createGain(),
    f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = kind === "rub" ? 950 : 1600;
  g.gain.value = 0;
  f.connect(g);
  g.connect(bus);
  let sources = [],
    partials = [];
  if (kind === "rub") {
    const s = makeNoise();
    s.connect(f);
    sources.push(s);
    g.gain.setTargetAtTime(0.27, now, 0.06);
  } else {
    for (const [ratio, level] of [
      [1, 0.8],
      [1.004, 0.5],
      [2, 0.25],
    ]) {
      const s = ctx.createOscillator(),
        partial = ctx.createGain();
      s.type = "sine";
      s.frequency.value = freq * ratio;
      partial.gain.value = level;
      s.connect(partial);
      partial.connect(f);
      sources.push(s);
      partials.push(partial);
    }
    g.gain.setTargetAtTime(0.085, now, 0.18);
  }
  sources.forEach((s) => s.start());
  let ended = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    sources.forEach((s) => s.stop(ctx.currentTime + 0.7));
    setTimeout(() => {
      g.disconnect();
      f.disconnect();
      sources.forEach((s) => s.disconnect());
      partials.forEach((p) => p.disconnect());
    }, 800);
    active.delete(stop);
  };
  active.add(stop);
  return {
    stop,
    move(x, y) {
      if (ended) return;
      ramp(f.frequency, kind === "rub" ? 350 + x * 2800 : 600 + x * 1600);
      ramp(g.gain, kind === "rub" ? 0.08 + y * 0.25 : 0.04 + y * 0.04);
    },
  };
}
function pop(index = 0, light = false) {
  if (!enabled) return;
  vis("pop", { i: index, light });
  const p = presets[preset],
    now = ctx.currentTime,
    o = ctx.createOscillator(),
    g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(
    p.base * (1 + index * 0.075) * (light ? 1.8 : 1),
    now,
  );
  o.frequency.exponentialRampToValueAtTime(
    Math.max(50, p.base * 0.42),
    now + 0.09,
  );
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(light ? 0.07 : 0.24, now + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
  o.connect(g);
  g.connect(bus);
  o.start();
  o.stop(now + p.decay + 0.03);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
  const n = makeNoise(),
    f = ctx.createBiquadFilter(),
    ng = ctx.createGain();
  f.type = "bandpass";
  f.frequency.value = p.cutoff * 0.7;
  f.Q.value = 0.6;
  ng.gain.setValueAtTime(light ? 0.035 : 0.1, now);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
  n.connect(f);
  f.connect(ng);
  ng.connect(bus);
  n.start();
  n.stop(now + 0.06);
  n.onended = () => {
    n.disconnect();
    f.disconnect();
    ng.disconnect();
  };
}
for (let i = 0; i < 9; i++) {
  const b = document.createElement("button");
  b.className = "bubble";
  b.setAttribute("aria-label", `Пузырёк ${i + 1}`);
  b.setAttribute("aria-pressed", "false");
  b.onclick = async () => {
    if (!(await ensure())) return;
    b.classList.toggle("pressed");
    b.setAttribute("aria-pressed", String(b.classList.contains("pressed")));
    pop(i);
    status("Мягкий хлопок · нажми ещё раз");
  };
  $("#bubbles").append(b);
}
let angle = 0,
  lastTick = 0;
function ringMove(x, y) {
  const a = (Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 90;
  angle = a;
  $("#ring").style.setProperty("--angle", a + "deg");
  $("#ring").setAttribute("aria-valuenow", Math.round(((a + 270) % 360) / 3.6));
  const now = performance.now();
  vis("ring", { a });
  window.dispatchEvent(
    new CustomEvent("kr-ring", { detail: ((a + 270) % 360) / 360 }),
  );
  if (now - lastTick > 65) {
    pop(Math.floor((a + 360) / 45) % 9, true);
    lastTick = now;
  }
}
function gesture(el, { start, move, end }) {
  let down = false,
    voiceRef = null,
    sequence = 0;
  function finish() {
    if (!down) return;
    down = false;
    sequence++;
    voiceRef?.stop();
    voiceRef = null;
    end?.();
  }
  el.addEventListener("pointerdown", async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    down = true;
    const ticket = ++sequence;
    el.setPointerCapture(e.pointerId);
    if (!(await ensure()) || !down || ticket !== sequence) return;
    voiceRef = start?.();
    update(e);
  });
  function update(e) {
    if (!down || !enabled) return;
    const r = el.getBoundingClientRect(),
      x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    move?.(x, y, voiceRef);
  }
  el.addEventListener("pointermove", update);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
  el.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
  el.addEventListener("keydown", async (e) => {
    if (
      ![
        " ",
        "Enter",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ].includes(e.key) ||
      e.repeat
    )
      return;
    e.preventDefault();
    if (!(await ensure())) return;
    if (el.id === "cloud") {
      if (!voiceRef) {
        voiceRef = start?.();
        down = true;
      }
    } else {
      voiceRef = start?.();
      move?.(e.key === "ArrowLeft" ? 0.25 : 0.75, 0.5, voiceRef);
      setTimeout(() => {
        voiceRef?.stop();
        voiceRef = null;
        end?.();
      }, 220);
    }
  });
  el.addEventListener("keyup", (e) => {
    if ([" ", "Enter"].includes(e.key)) finish();
  });
  el.addEventListener("blur", finish);
}
gesture($("#ring"), { move: ringMove });
gesture($("#silk"), {
  start: () => voice("rub"),
  end: () => window.dispatchEvent(new Event("kr-silk-end")),
  move: (x, y, v) => {
    $("#silk").style.setProperty("--x", x * 100 + "%");
    $("#silk").style.setProperty("--y", y * 100 + "%");
    $("#silk").setAttribute("aria-valuenow", Math.round(x * 100));
    v?.move(x, y);
    window.dispatchEvent(new CustomEvent("kr-silk", { detail: { x, y } }));
    vis("silk", { x, y });
  },
});
gesture($("#cloud"), {
  start: () => {
    $("#cloud").classList.add("holding");
    window.dispatchEvent(new CustomEvent("kr-sustain", { detail: true }));
    vis("cloud", { on: true });
    return voice("cloud", presets[preset].cloudBase);
  },
  end: () => {
    $("#cloud").classList.remove("holding");
    window.dispatchEvent(new CustomEvent("kr-sustain", { detail: false }));
    vis("cloud", { on: false });
  },
});
for (const id of ["volume", "reverb", "echo"]) {
  $("#" + id).oninput = (e) => {
    $("#" + id + "Out").value = e.target.value + "%";
    if (ctx)
      ramp(
        id === "volume"
          ? master.gain
          : id === "reverb"
            ? wet.gain
            : delaySend.gain,
        (+e.target.value / 100) *
          (id === "reverb" ? 0.7 : id === "echo" ? 0.5 : 1),
      );
  };
}
function selectPreset(name) {
  preset = name;
  document.querySelectorAll("[data-preset]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.preset === name);
    b.setAttribute("aria-pressed", String(b.dataset.preset === name));
  });
  const p = presets[name];
  $("#reverb").value = p.reverb * 100;
  $("#echo").value = p.echo * 100;
  $("#reverb").dispatchEvent(new Event("input"));
  $("#echo").dispatchEvent(new Event("input"));
  if (ctx) ramp(bus.filter.frequency, p.cutoff, 0.1);
  stopAll();
  status(
    "Характер звука: " +
      {
        soft: "мягкие хлопки",
        glass: "звонкие касания",
        dream: "приглушённые текстуры",
      }[name],
  );
}
document
  .querySelectorAll("[data-preset]")
  .forEach((b) => (b.onclick = () => selectPreset(b.dataset.preset)));
$("#theme").onclick = () => {
  document.body.classList.toggle("dark");
  setState({ theme: document.body.classList.contains("dark") ? "dark" : "light" });
  $("#theme").setAttribute(
    "aria-pressed",
    String(document.body.classList.contains("dark")),
  );
};
$("#about").onclick = () => $("#info").showModal();
$(".close").onclick = () => $("#info").close();
$("#info").onclick = (e) => {
  if (e.target === $("#info")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
};
$("#reset").onclick = async () => {
  if (recorder?.state === "recording") recorder.stop();
  await powerOff();
  document.querySelectorAll(".bubble").forEach((b) => {
    b.classList.remove("pressed");
    b.setAttribute("aria-pressed", "false");
  });
  selectPreset("soft");
  $("#volume").value = 35;
  $("#volume").dispatchEvent(new Event("input"));
  $("#ring").style.setProperty("--angle", "0deg");
  $("#ring").setAttribute("aria-valuenow", "0");
  status("Чистая доска. Начни с любого прикосновения.");
};
$("#record").onclick = async () => {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  if (!window.MediaRecorder) {
    status("Этот браузер не поддерживает запись. Попробуй Chrome или Firefox.");
    return;
  }
  if (!(await ensure())) return;
  try {
    recorder = new MediaRecorder(recordDest.stream);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearTimeout(recordTimer);
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (recordURL) URL.revokeObjectURL(recordURL);
      recordURL = URL.createObjectURL(blob);
      const link = $("#download");
      link.href = recordURL;
      link.download =
        "krizalizm-session." +
        (recorder.mimeType.includes("mp4") ? "m4a" : "webm");
      link.hidden = false;
      $("#record").classList.remove("recording");
      $("#record").innerHTML = "<i></i> Записать звук";
      status("Запись готова — можно скачать.");
    };
    recorder.start(500);
    recordTimer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 300000);
    $("#record").classList.add("recording");
    $("#record").textContent = "■ Остановить запись";
    status("Запись звука идёт · до 5 минут");
  } catch (e) {
    status("Не удалось начать запись: " + e.message);
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (recorder?.state === "recording") recorder.stop();
    powerOff();
  }
});
window.addEventListener("blur", stopAll);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") powerOff();
});
selectPreset("soft");
status("Начни с любого прикосновения");

export { ctx, bus, ensure, enabled, selectPreset, ramp, makeNoise };

/* ---------- «Проекция»: отдельное окно для проектора или второго экрана ----------
   Окно открывается пустым (about:blank) и рисуется прямо отсюда: так проекция работает
   и на своём хостинге, и внутри превью, где адрес страницы нельзя открыть отдельной вкладкой. */
const PROJ_CSS = `html,body{margin:0;height:100%;overflow:hidden;background:#f6f4f8;font-family:"Helvetica Neue",Arial,sans-serif}
body.dark{background:#211f2b}canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.mark{position:fixed;left:28px;bottom:22px;font-size:10px;letter-spacing:1.6px;color:#8a7e93;opacity:.55;pointer-events:none}
.mark b{display:block;font-weight:400;font-size:18px;letter-spacing:-.4px;margin-bottom:4px}
.hint{position:fixed;left:50%;top:24px;transform:translateX(-50%);font-size:12px;color:#7d7187;background:#ffffffaa;border-radius:99px;padding:8px 16px;transition:opacity 1s;pointer-events:none}
.hint.gone{opacity:0}.close{position:fixed;right:18px;top:16px;border:0;border-radius:99px;background:#ffffffcc;color:#5d5263;font-size:13px;padding:8px 14px;cursor:pointer}
body.idle,body.idle canvas{cursor:none}body.idle .close{opacity:0}`;
const PROJ_HTML = `<canvas></canvas><div class="mark"><b>кризализм</b>TOUCH TO FEEL · SOUND + VISUAL PLAYGROUND</div><div class="hint">двойное нажатие — полный экран</div>`;
let projWin = null,
  overlay = null,
  projStops = [];
function mountProjection(doc, win, root, closeFn) {
  root.innerHTML = PROJ_HTML;
  if (closeFn) {
    const c = doc.createElement("button");
    c.className = "close";
    c.textContent = "× Закрыть проекцию";
    c.onclick = closeFn;
    root.append(c);
  }
  const S = startProjection(
    root.querySelector("canvas"),
    (fn) => {
      fn({ type: "state", ...getState() });
      projStops.push(onLocal(fn));
    },
    win,
  );
  const body = root === doc.body ? doc.body : root;
  const iv = win.setInterval(() => body.classList.toggle("dark", S.theme === "dark"), 300);
  root.addEventListener("dblclick", () => {
    if (doc.fullscreenElement) doc.exitFullscreen();
    else (root === doc.body ? doc.documentElement : root).requestFullscreen?.().catch(() => {});
  });
  win.setTimeout(() => root.querySelector(".hint")?.classList.add("gone"), 4000);
  let idle;
  const wake = () => {
    body.classList.remove("idle");
    win.clearTimeout(idle);
    idle = win.setTimeout(() => body.classList.add("idle"), 2200);
  };
  root.addEventListener("pointermove", wake);
  wake();
  return () => {
    S.stopped = true;
    win.clearInterval(iv);
  };
}
function closeOverlay() {
  if (!overlay) return;
  overlay.stop();
  projStops.splice(0).forEach((f) => f());
  overlay.remove();
  overlay = null;
}
function openOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "projection-overlay";
  document.body.append(overlay);
  overlay.stop = mountProjection(document, window, overlay, closeOverlay);
}
$("#projection").onclick = () => {
  if (projWin && !projWin.closed) {
    projWin.focus();
    return;
  }
  let w = null;
  try {
    w = window.open("", "krizalizm-projection", "popup,width=1280,height=720");
    if (w) {
      w.document.open();
      w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Кризализм — проекция</title><style>${PROJ_CSS}</style></head><body></body></html>`);
      w.document.close();
      const stop = mountProjection(w.document, w, w.document.body, null);
      w.addEventListener("pagehide", () => {
        stop();
        projStops.splice(0).forEach((f) => f());
      });
    }
  } catch (e) {
    try {
      w?.close();
    } catch (x) {}
    w = null;
  }
  projWin = w;
  if (!projWin) openOverlay();
  status(
    projWin
      ? "Проекция открыта · перетащи окно на проектор, двойное нажатие — полный экран"
      : "Проекция поверх страницы · двойное нажатие — полный экран",
  );
};
