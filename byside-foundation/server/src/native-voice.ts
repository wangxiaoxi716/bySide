import { EventEmitter } from 'events';

/** Local device bridge; capture and played events carry PCM and a playback id. */
export interface NativeAudio extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  play(pcm: Buffer, id: number): void;
  flush(): void;
}
export interface LocalSocket {
  readyState: number;
  bufferedAmount: number;
  on(event: string, listener: (...args: any[]) => void): this;
  send(data: string | Buffer): void;
  close(): void;
  terminate(): void;
}
interface Options { audio: NativeAudio; connect: () => LocalSocket; fullDuplex?: boolean; }
const FRAME_BYTES = 640, SILENCE = Buffer.alloc(FRAME_BYTES), MAX_CAPTURE = FRAME_BYTES * 10;

/** Hardware client of the existing single-owner /speech/realtime protocol. */
export class NativeVoiceRunner extends EventEmitter {
  private socket?: LocalSocket;
  private input = Buffer.alloc(0);
  private sender?: NodeJS.Timeout;
  private closeTimer?: NodeJS.Timeout;
  private ready = false;
  private stopping = false;
  private finished = false;
  private running = false;
  private speaking = false;
  private playback = new Map<number, number>();
  private playbackBytes = 0;
  private nextPlaybackId = 0;
  private echoTailUntil = 0;
  private display = { motion: 'thinking', speech: '正在连接实时语音…' };
  private replyText = '';
  private lastPresentation = 0;
  private presentationTimer?: NodeJS.Timeout;
  private audioStopped?: Promise<void>;
  private resolveCompletion!: (code: number) => void;
  private completion = new Promise<number>(resolve => { this.resolveCompletion = resolve; });
  constructor(private readonly options: Options) { super(); }

  async run(): Promise<number> {
    if (this.running) throw new Error('本机语音已经启动');
    this.running = true;
    const { audio } = this.options;
    audio.on('capture', (pcm: Buffer) => {
      if (!this.ready || this.stopping || !Buffer.isBuffer(pcm) || pcm.length % 2) return;
      if (this.gated()) { this.input = Buffer.alloc(0); return; }
      this.input = Buffer.concat([this.input, pcm]).subarray(-MAX_CAPTURE);
    });
    audio.on('played', (id: number) => {
      const bytes = this.playback.get(id);
      if (bytes !== undefined) {
        this.playback.delete(id); this.playbackBytes -= bytes; this.echoTailUntil = Date.now() + 150;
        if (!this.playback.size && !this.speaking) this.present({ motion: 'listening' });
      }
    });
    audio.on('failure', (message: string) => this.fail(message));
    try {
      await audio.start();
      if (this.stopping || this.finished) { await this.stopAudio(); return this.completion; }
      const socket = this.options.connect(); this.socket = socket;
      socket.on('open', () => {
        if (!this.stopping) socket.send(JSON.stringify({ type: 'session.start', fullDuplex: Boolean(this.options.fullDuplex), presentation: 'device' }));
      });
      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[], binary: boolean) => {
        if (this.finished) return;
        const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        if (binary) { this.onAudio(data); return; }
        let event: any; try { event = JSON.parse(data.toString('utf8')); } catch { this.fail('实时语音返回了无效数据'); return; }
        this.onEvent(event);
      });
      socket.on('error', () => { if (!this.stopping) this.fail('无法连接本机实时语音服务，请确认基座正在运行'); });
      socket.on('close', () => { if (!this.stopping) this.fail('实时语音连接已断开'); else void this.finish(0); });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '无法启动本机音频设备');
    }
    return this.completion;
  }

  async stop(): Promise<void> {
    if (this.finished) { await this.completion; return; }
    if (this.stopping) { await this.completion; return; }
    this.stopping = true; this.ready = false; this.input = Buffer.alloc(0);
    if (this.sender) clearInterval(this.sender);
    await this.stopAudio();
    if (this.socket?.readyState === 1) {
      this.socket.send(JSON.stringify({ type: 'session.close' }));
      this.closeTimer = setTimeout(() => { this.socket?.terminate(); void this.finish(0); }, 4000);
    } else {
      this.socket?.terminate(); await this.finish(0);
    }
    await this.completion;
  }

  private gated() {
    return !this.options.fullDuplex && (this.speaking || this.playback.size > 0 || Date.now() < this.echoTailUntil);
  }
  private tick() {
    if (!this.ready || this.stopping || this.socket?.readyState !== 1) return;
    if (this.socket.bufferedAmount > 256000) { this.fail('实时语音连接拥塞，请重新开始'); return; }
    let frame = SILENCE;
    if (this.gated()) this.input = Buffer.alloc(0);
    else if (this.input.length >= FRAME_BYTES) { frame = this.input.subarray(0, FRAME_BYTES); this.input = this.input.subarray(FRAME_BYTES); }
    this.socket.send(frame);
  }
  private onAudio(pcm: Buffer) {
    if (!this.ready || this.stopping) return;
    if (pcm.length % 2 || !pcm.length) { this.fail('实时语音音频格式无效'); return; }
    if (this.playbackBytes + pcm.length > 24000 * 2 * 50) { this.fail('音频播放队列过长，请检查扬声器'); return; }
    const id = ++this.nextPlaybackId; this.playback.set(id, pcm.length); this.playbackBytes += pcm.length;
    this.present({ motion: 'speaking' });
    try { this.options.audio.play(pcm, id); } catch { this.fail('音频播放失败，请检查扬声器'); }
  }
  private present(patch: Partial<{ motion: string; speech: string }>) {
    const previousMotion = this.display.motion;
    this.display = { ...this.display, ...patch, speech: (patch.speech ?? this.display.speech).slice(0, 3000) };
    if (!this.ready || this.stopping || this.socket?.readyState !== 1) return;
    const send = () => {
      this.presentationTimer = undefined;
      if (!this.ready || this.stopping || this.socket?.readyState !== 1) return;
      this.socket.send(JSON.stringify({ type: 'presentation.update', state: this.display }));
      this.lastPresentation = Date.now();
    };
    if (previousMotion !== this.display.motion || Date.now() - this.lastPresentation >= 80) {
      if (this.presentationTimer) clearTimeout(this.presentationTimer);
      send();
    } else if (!this.presentationTimer) this.presentationTimer = setTimeout(send, 80);
  }
  private onEvent(event: any) {
    if (!event || typeof event.type !== 'string') { this.fail('实时语音返回了无效数据'); return; }
    if (event.type === 'session.closed') { if (this.stopping) void this.finish(0); else this.fail('实时语音会话已结束'); return; }
    if (this.stopping) return;
    if (event.type === 'session.ready' && !this.ready) {
      this.ready = true; this.input = Buffer.alloc(0); this.sender = setInterval(() => this.tick(), 20);
      this.present({ motion: 'listening', speech: '正在听你说话…' });
      this.emit('notice', '实时语音已连接，可以开始说话。');
    } else if (event.type === 'audio.started') { this.speaking = true; this.input = Buffer.alloc(0); }
    else if (['audio.done', 'response.done', 'response.canceled'].includes(event.type)) {
      this.speaking = false; if (!this.playback.size) this.present({ motion: 'listening' });
    }
    else if (event.type === 'audio.flush') {
      this.playback.clear(); this.playbackBytes = 0; this.echoTailUntil = Date.now() + 150;
      this.replyText = ''; this.present({ motion: 'listening', speech: '正在听你说话…' });
      try { this.options.audio.flush(); } catch { this.fail('无法停止扬声器播放'); }
    } else if (event.type === 'error') this.fail(typeof event.message === 'string' ? event.message : '实时语音服务不可用');
    else if (event.type === 'transcript.error') this.emit('notice', event.message || '没有听清，请再说一次。');
    else if (event.type === 'transcript.started') { this.replyText = ''; this.present({ motion: 'listening', speech: '正在听你说话…' }); }
    else if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
      this.replyText = '';
      const content = String(event.text || '');
      this.present({ motion: event.type === 'transcript.final' ? 'thinking' : 'listening', speech: content ? `你：${content}` : '正在听你说话…' });
      if (event.type === 'transcript.final') this.emit('transcript', content);
    } else if (event.type === 'assistant.text.delta' || event.type === 'assistant.text.done') {
      this.replyText = event.type === 'assistant.text.done' ? String(event.text || this.replyText) : (this.replyText + String(event.text || '')).slice(0, 3000);
      this.present({ speech: this.replyText });
      if (event.type === 'assistant.text.done') this.emit('reply', this.replyText);
    }
  }
  private fail(message: string) {
    if (this.stopping || this.finished) return;
    this.stopping = true; this.emit('failure', message); void this.finish(1);
  }
  private stopAudio() {
    return this.audioStopped ||= this.options.audio.stop().catch(() => {});
  }
  private async finish(code: number) {
    if (this.finished) return;
    this.finished = true; this.ready = false; this.stopping = true;
    if (this.sender) clearInterval(this.sender);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.presentationTimer) clearTimeout(this.presentationTimer);
    if (this.socket && this.socket.readyState < 2) this.socket.close();
    await this.stopAudio(); this.resolveCompletion(code);
  }
}
