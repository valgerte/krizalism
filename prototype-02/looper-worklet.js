class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.take = null;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "cancel") this.take = null;
      if (m.type === "record" && m.length > 0 && m.length <= sampleRate * 32)
        this.take = {
          id: m.id,
          start: m.start,
          samples: new Float32Array(m.length),
          end: m.start + m.length,
        };
    };
  }
  process(inputs) {
    const take = this.take;
    if (!take) return true;
    const channels = inputs[0] || [],
      size = 128;
    for (let i = 0; i < size; i++) {
      const frame = currentFrame + i,
        offset = frame - take.start;
      if (offset >= 0 && offset < take.samples.length) {
        let v = 0;
        for (const ch of channels) v += ch[i] || 0;
        take.samples[offset] = channels.length ? v / channels.length : 0;
      }
    }
    if (currentFrame + size >= take.end) {
      this.port.postMessage(
        { type: "take", id: take.id, samples: take.samples },
        [take.samples.buffer],
      );
      this.take = null;
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
