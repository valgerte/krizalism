// Визуальная шина: каждое действие на доске отправляется в окно «Проекция».
// BroadcastChannel связывает вкладки одного сайта; окно проекции слушает тот же канал.
const CHANNEL = "krizalizm-projection";
let channel = null;
try {
  channel = new BroadcastChannel(CHANNEL);
} catch (e) {
  channel = null;
}
const local = new Set(); // in-page overlay when a separate window is not allowed

export function vis(type, data = {}) {
  const msg = { type, ...data, at: performance.now() };
  if (channel) channel.postMessage(msg);
  local.forEach((fn) => fn(msg));
}
export function onLocal(fn) {
  local.add(fn);
  return () => local.delete(fn);
}

// state the projection needs right after it opens
let snapshot = { theme: "light", mood: "calm" };
export const getState = () => snapshot;
export function setState(patch) {
  snapshot = { ...snapshot, ...patch };
  vis("state", snapshot);
}
if (channel)
  channel.onmessage = (e) => {
    if (e.data?.type === "hello") vis("state", snapshot);
  };

// sound level: read from the master analyser and sent ~30 times a second
let analyser = null,
  buf = null,
  timer = null;
export function attachAnalyser(node) {
  analyser = node;
  buf = new Float32Array(analyser.fftSize);
  if (timer) return;
  timer = setInterval(() => {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    vis("level", { v: Math.min(1, Math.sqrt(s / buf.length) * 4) });
  }, 33);
}
