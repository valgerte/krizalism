// «Проекция»: полноэкранный визуальный след всего, что происходит на доске.
// Работает в отдельном окне (projection.html, канал BroadcastChannel)
// и как запасной слой поверх страницы, если браузер не дал открыть окно.

const PAL = {
  pink: [255, 196, 216],
  lav: [226, 196, 245],
  cyan: [170, 232, 238],
  rose: [238, 160, 190],
  lilac: [186, 160, 226],
  aqua: [140, 210, 220],
};
const NOTE_COL = [PAL.pink, PAL.lav, PAL.cyan, PAL.rose, PAL.lilac, PAL.aqua];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function startProjection(canvas, subscribe, win = window) {
  const g = canvas.getContext("2d");
  let W = 0,
    H = 0,
    M = 0,
    dpr = 1;
  const S = {
    theme: "light",
    mood: "calm",
    level: 0,
    lvl: 0,
    fx: "clean",
    things: [],
    notes: new Map(),
    ring: { a: 0, va: 0, alive: 0 },
    silk: [],
    cloud: 0,
    cloudOn: false,
    layers: 0,
    t: 0,
  };
  function resize() {
    dpr = Math.min(2, win.devicePixelRatio || 1);
    W = canvas.clientWidth * dpr;
    H = canvas.clientHeight * dpr;
    canvas.width = W;
    canvas.height = H;
    M = Math.min(W, H);
  }
  new (win.ResizeObserver || ResizeObserver)(resize).observe(canvas);
  resize();

  const add = (o) => {
    S.things.push({ age: 0, ...o });
    if (S.things.length > 260) S.things.splice(0, S.things.length - 260);
  };
  function on(m) {
    switch (m.type) {
      case "state":
        if (m.theme) S.theme = m.theme;
        if (m.mood) S.mood = m.mood;
        break;
      case "level":
        S.level = m.v;
        break;
      case "pop": {
        const col = m.i % 3,
          row = Math.floor(m.i / 3);
        const x = 0.16 + col * 0.07 + (Math.random() - 0.5) * 0.02,
          y = 0.36 + row * 0.12;
        add({ k: "pop", x, y, c: m.light ? PAL.cyan : PAL.pink, life: 1.6 });
        break;
      }
      case "drum":
        if (m.row === 0) add({ k: "pulse", life: 1.3, c: PAL.lilac });
        else if (m.row === 1)
          for (let i = 0; i < 10; i++)
            add({ k: "spark", x: 0.5, y: 0.5, a: Math.random() * 6.28, v: 0.15 + Math.random() * 0.25, c: PAL.cyan, life: 0.9 });
        else
          for (let i = 0; i < 26; i++)
            add({ k: "grain", x: Math.random(), y: 0.15 + Math.random() * 0.7, c: PAL.lav, life: 0.5 + Math.random() * 0.4 });
        break;
      case "note-on":
        S.notes.set(m.id, { i: m.i, born: S.t, off: null, c: NOTE_COL[m.i % NOTE_COL.length], x: 0.08 + (0.84 * m.i) / 24 });
        break;
      case "note-off": {
        const n = S.notes.get(m.id);
        if (n) n.off = S.t;
        break;
      }
      case "ring":
        S.ring.va += (m.a - S.ring.a) * 0.4;
        S.ring.a = m.a;
        S.ring.alive = 1.6;
        break;
      case "silk":
        S.silk.push({ x: m.x, y: m.y, age: 0 });
        if (S.silk.length > 90) S.silk.shift();
        break;
      case "cloud":
        S.cloudOn = !!m.on;
        if (m.on) add({ k: "pulse", life: 2.2, c: PAL.pink });
        break;
      case "layer":
        S.layers = m.n;
        add({ k: "pulse", life: 2, c: PAL.rose });
        break;
      case "fx":
        S.fx = m.name;
        add({ k: "flash", life: 0.8, c: m.name === "digital" ? PAL.cyan : m.name === "haze" ? PAL.lav : PAL.pink });
        break;
    }
  }
  subscribe(on);

  function blob(x, y, r, c, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(c, a));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, 6.283);
    g.fill();
  }
  function sphere(x, y, r, c, a) {
    // soft neumorphic ball, like the board's bubbles
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.45, rgba(c, a * 0.9));
    gr.addColorStop(1, rgba(c.map((v) => v * 0.82), a * 0.85));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, 6.283);
    g.fill();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.t += dt;
    S.lvl += (S.level - S.lvl) * Math.min(1, dt * 10);
    const dark = S.theme === "dark",
      slow = S.mood === "calm" ? 0.6 : 1;
    // background
    g.globalCompositeOperation = "source-over";
    g.fillStyle = dark ? "#211f2b" : "#f6f4f8";
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = dark ? "lighter" : "source-over";
    const breathe = 1 + S.lvl * 0.5 + Math.sin(S.t * 0.6 * slow) * 0.04;
    blob(W * (0.25 + Math.sin(S.t * 0.07) * 0.05), H * 0.35, M * 0.55 * breathe, PAL.lav, dark ? 0.16 : 0.55);
    blob(W * (0.78 + Math.cos(S.t * 0.05) * 0.04), H * 0.6, M * 0.5 * breathe, PAL.cyan, dark ? 0.13 : 0.5);
    blob(W * 0.5, H * (0.85 + Math.sin(S.t * 0.04) * 0.03), M * 0.45 * breathe, PAL.pink, dark ? 0.14 : 0.5);

    // ring: an orbit of beads following the hand
    if (S.ring.alive > 0) {
      S.ring.alive -= dt;
      const al = Math.min(1, S.ring.alive),
        R = M * (0.26 + S.lvl * 0.05);
      g.lineWidth = M * 0.012;
      g.strokeStyle = rgba(PAL.aqua, 0.35 * al);
      g.beginPath();
      g.arc(W / 2, H / 2, R, 0, 6.283);
      g.stroke();
      for (let i = 0; i < 12; i++) {
        const a = ((S.ring.a - 90) * Math.PI) / 180 + (i / 12) * 6.283;
        sphere(W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R, M * (i === 0 ? 0.03 : 0.016), i === 0 ? PAL.aqua : PAL.cyan, 0.85 * al);
      }
    }
    // voice layers: concentric loops that breathe with the sound
    for (let i = 0; i < S.layers; i++) {
      g.lineWidth = M * 0.004;
      g.strokeStyle = rgba(PAL.rose, 0.35);
      g.beginPath();
      g.arc(W / 2, H / 2, M * (0.34 + i * 0.035) * (1 + S.lvl * 0.15 * Math.sin(S.t * 2 + i)), 0, 6.283);
      g.stroke();
    }
    // silk: pleated ribbon trail
    for (let i = S.silk.length - 1; i >= 0; i--) {
      const p = S.silk[i];
      p.age += dt;
      if (p.age > 2.2) {
        S.silk.splice(i, 1);
        continue;
      }
      const a = 1 - p.age / 2.2;
      for (let k = -2; k <= 2; k++) {
        g.fillStyle = rgba(k % 2 ? PAL.lilac : PAL.lav, 0.22 * a);
        g.fillRect(p.x * W + k * M * 0.012, p.y * H - M * 0.12, M * 0.007, M * 0.24 * (1.2 - p.y * 0.6));
      }
    }
    // cloud: breathing blob while held
    S.cloud += ((S.cloudOn ? 1 : 0) - S.cloud) * Math.min(1, dt * (S.cloudOn ? 2 : 0.8));
    if (S.cloud > 0.01) {
      const r = M * (0.2 + 0.03 * Math.sin(S.t * 1.6)) * (0.6 + 0.4 * S.cloud);
      blob(W / 2, H * 0.62, r * 1.8, PAL.pink, 0.35 * S.cloud);
      sphere(W / 2, H * 0.62, r, PAL.pink, 0.75 * S.cloud);
    }
    // notes: orbs that rise while the key is held
    S.notes.forEach((n, id) => {
      const held = n.off === null,
        age = S.t - n.born,
        fade = held ? 1 : Math.max(0, 1 - (S.t - n.off) / 1.4);
      if (fade <= 0) {
        S.notes.delete(id);
        return;
      }
      const y = H * (0.78 - Math.min(0.5, age * 0.06 * slow)),
        r = M * (0.035 + Math.min(0.03, age * 0.01)) * (1 + S.lvl * 0.4);
      blob(n.x * W, y, r * 3, n.c, 0.35 * fade);
      sphere(n.x * W, y, r, n.c, 0.9 * fade);
    });
    // short-lived traces
    for (let i = S.things.length - 1; i >= 0; i--) {
      const o = S.things[i];
      o.age += dt;
      const p = o.age / o.life;
      if (p >= 1) {
        S.things.splice(i, 1);
        continue;
      }
      const a = 1 - p;
      if (o.k === "pop") {
        const sq = p < 0.12 ? 1 - p * 2 : 1;
        sphere(o.x * W, o.y * H, M * 0.035 * sq, o.c, 0.9 * a);
        g.lineWidth = M * 0.003;
        g.strokeStyle = rgba(o.c, 0.6 * a);
        for (const s of [1, 1.7]) {
          g.beginPath();
          g.arc(o.x * W, o.y * H, M * (0.04 + p * 0.12 * s), 0, 6.283);
          g.stroke();
        }
      } else if (o.k === "pulse") {
        g.lineWidth = M * 0.01 * a;
        g.strokeStyle = rgba(o.c, 0.5 * a);
        g.beginPath();
        g.arc(W / 2, H / 2, M * (0.05 + p * 0.55), 0, 6.283);
        g.stroke();
      } else if (o.k === "spark") {
        const d = o.v * p * M;
        blob(o.x * W + Math.cos(o.a) * d, o.y * H + Math.sin(o.a) * d, M * 0.02, o.c, 0.8 * a);
      } else if (o.k === "grain") {
        g.fillStyle = rgba(o.c, 0.9 * a);
        g.fillRect(o.x * W, o.y * H, M * 0.006, M * 0.006);
      } else if (o.k === "flash") {
        g.fillStyle = rgba(o.c, 0.25 * a);
        g.fillRect(0, 0, W, H);
      }
    }
    // «Цифра»: the whole picture gets a coarse digital grain
    if (S.fx === "digital") {
      const s = 0.18,
        w = Math.max(16, (W * s) | 0),
        h = Math.max(10, (H * s) | 0);
      g.globalCompositeOperation = "source-over";
      g.imageSmoothingEnabled = false;
      g.drawImage(canvas, 0, 0, W, H, 0, 0, w, h);
      g.drawImage(canvas, 0, 0, w, h, 0, 0, W, H);
      g.imageSmoothingEnabled = true;
    }
    if (!S.stopped) win.requestAnimationFrame(frame);
  }
  win.requestAnimationFrame(frame);
  return S;
}
