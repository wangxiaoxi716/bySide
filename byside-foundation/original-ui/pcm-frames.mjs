// Downsample microphone input to the provider's 16 kHz, mono, signed PCM16.
// Carry partial samples and frames across audio render quanta.
export class PcmFrameEncoder {
  constructor(inputRate, onFrame) {
    this.inputRate = inputRate;
    this.onFrame = onFrame;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.offset = 0;
    this.frame = new ArrayBuffer(640);
    this.view = new DataView(this.frame);
  }

  push(input) {
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.phase += 16000;
      if (this.phase < this.inputRate) continue;
      this.phase -= this.inputRate;
      const sample = Math.max(-1, Math.min(1, this.sum / this.count));
      this.view.setInt16(this.offset * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      this.sum = 0;
      this.count = 0;
      this.offset++;
      if (this.offset === 320) {
        this.onFrame(this.frame);
        this.frame = new ArrayBuffer(640);
        this.view = new DataView(this.frame);
        this.offset = 0;
      }
    }
  }
}
