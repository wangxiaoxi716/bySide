import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import WebSocket from 'ws';
import { NativeAudioBridge } from './native-audio';
import { NativeVoiceRunner, type LocalSocket } from './native-voice';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：npm run voice:native -- [--audio-adapter 可执行文件] [--full-duplex] [--show-transcript]\nmacOS 默认使用系统输入输出设备；其他平台可指定实现标准协议的设备适配器。\n--full-duplex 允许打断，建议佩戴耳机。\n--show-transcript 在终端显示识别和回复文字。\n可用环境变量 BYSIDE_PORT 指定本机基座端口；按 Ctrl+C 结束。');
  process.exit(0);
}
let adapter: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--audio-adapter' && args[i + 1] && !args[i + 1].startsWith('--') && !adapter) adapter = resolve(args[++i]);
  else if (!['--full-duplex', '--show-transcript'].includes(args[i])) {
    console.error('音频设备参数无效。运行 npm run voice:native -- --help 查看选项。'); process.exit(1);
  }
}
const port = process.env.BYSIDE_PORT || '4173';
if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) { console.error('BYSIDE_PORT 必须是有效的本机端口。'); process.exit(1); }
if (!adapter && process.platform !== 'darwin') { console.error('请使用 --audio-adapter 指定本平台的音频设备适配器。'); process.exit(1); }
if (!adapter) {
  const build = spawnSync('sh', [join(__dirname, '../../native-voice/build.sh')], { stdio: 'inherit' });
  if (build.status !== 0) { console.error('macOS 音频桥构建失败。'); process.exit(1); }
  adapter = join(__dirname, '../../native-voice/.build/BySideAudio.app/Contents/MacOS/BySideAudio');
}
const binary = adapter;
const audio = new NativeAudioBridge(binary);
const runner = new NativeVoiceRunner({
  audio,
  connect: () => new WebSocket(`ws://127.0.0.1:${port}/api/v1/speech/realtime`) as unknown as LocalSocket,
  fullDuplex: args.includes('--full-duplex'),
});
runner.on('notice', message => console.log(message));
runner.on('failure', message => console.error(`本机语音：${message}`));
if (args.includes('--show-transcript')) {
  runner.on('transcript', text => console.log(`你：${text}`));
  runner.on('reply', text => console.log(`芽团：${text}`));
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { if (stopping) return; stopping = true; console.log('\n正在结束实时语音并释放音频设备……'); void runner.stop(); });
console.log('正在启动音频设备。首次使用可能需要允许系统访问麦克风。');
void runner.run().then(code => { process.exitCode = code; });
