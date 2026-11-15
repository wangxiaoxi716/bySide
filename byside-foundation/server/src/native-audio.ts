import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { createInterface } from 'readline';
import type { NativeAudio } from './native-voice';

/** Manages the local macOS audio helper through a narrow newline-JSON protocol. */
export class NativeAudioBridge extends EventEmitter implements NativeAudio {
  private child?: ChildProcessWithoutNullStreams;
  private stopping = false;
  private started = false;
  constructor(private readonly binary: string, private readonly args: string[] = []) { super(); }
  isRunning() { return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null); }

  async start(): Promise<void> {
    if (this.child) throw new Error('本机音频设备已经启动');
    this.stopping = false;
    // Device adapters do not need model credentials from the parent shell.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VOLC_|YATUAN_AI_|YATUAN_TTS_)|(?:API_?KEY|_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY)$/i.test(name)));
    const child = spawn(this.binary, this.args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    this.child = child;
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      let pending = true;
      const timer = setTimeout(() => startupFailure('等待麦克风权限超时，请重试'), 125000);
      const startupFailure = (message: string) => {
        if (pending) { pending = false; clearTimeout(timer); reject(new Error(message)); }
        else if (!this.stopping) this.emit('failure', message);
      };
      child.on('error', () => startupFailure('无法启动本机音频桥，请重新构建后重试'));
      child.stdin.on('error', () => { if (!this.stopping) startupFailure('本机音频设备连接中断'); });
      child.on('close', () => {
        if (this.child === child) this.child = undefined;
        this.started = false;
        if (!this.stopping) startupFailure('本机音频设备已退出，请检查麦克风和扬声器');
      });
      createInterface({ input: child.stdout }).on('line', line => {
        let event: any; try { event = JSON.parse(line); } catch { startupFailure('本机音频设备返回无效数据'); return; }
        if (event.type === 'ready' && pending) {
          const validFormat = (format: any, rate: number) => format?.encoding === 'pcm_s16le' && format?.rate === rate && format?.channels === 1;
          if (event.protocolVersion !== '1.0' || !validFormat(event.input, 16000) || !validFormat(event.output, 24000)) { startupFailure('音频设备协议版本或音频格式不兼容'); return; }
          pending = false; clearTimeout(timer); this.started = true; resolve();
        }
        else if (event.type === 'error') startupFailure(typeof event.message === 'string' ? event.message : '本机音频设备出错');
        else if (event.type === 'capture' && this.started && typeof event.audio === 'string' && event.audio.length <= 32768 && /^[A-Za-z0-9+/]*={0,2}$/.test(event.audio)) {
          const pcm = Buffer.from(event.audio, 'base64'); if (pcm.length && pcm.length % 2 === 0) this.emit('capture', pcm);
        } else if (event.type === 'played' && Number.isSafeInteger(event.id)) this.emit('played', event.id);
      });
    });
  }
  play(pcm: Buffer, id: number) { this.write({ type: 'play', audio: pcm.toString('base64'), id }); }
  flush() { this.write({ type: 'flush' }); }
  private write(event: object) {
    if (!this.child || !this.started || !this.child.stdin.writable || this.child.stdin.writableLength > 512000) throw new Error('本机音频设备不可用');
    this.child.stdin.write(`${JSON.stringify(event)}\n`);
  }
  async stop(): Promise<void> {
    const child = this.child; this.stopping = true; this.started = false;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 1500);
      child.once('close', finish);
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`); else child.kill('SIGTERM');
    });
  }
}
