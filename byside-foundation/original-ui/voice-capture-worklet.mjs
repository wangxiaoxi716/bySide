import { PcmFrameEncoder } from './pcm-frames.mjs';

class YatuanPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.encoder = new PcmFrameEncoder(sampleRate, frame => this.port.postMessage({frame,capturedAt:currentTime}, [frame]));
  }

  process(inputs, outputs) {
    // A muted input still advances the stream with silence. The output stays
    // silent so the microphone is never played through the speakers.
    const input = inputs[0]?.[0] || outputs[0]?.[0];
    if (input) this.encoder.push(input);
    return true;
  }
}

registerProcessor('yatuan-pcm-capture', YatuanPcmCapture);
