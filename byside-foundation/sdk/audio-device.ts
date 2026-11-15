/** Version 1.0 of the platform-neutral, newline-JSON audio adapter contract. */
export const AUDIO_DEVICE_PROTOCOL = '1.0' as const;
export interface AudioFormat<Rate extends number = number> { encoding: 'pcm_s16le'; rate: Rate; channels: 1; }
export type AudioDeviceEvent =
  | { type: 'ready'; protocolVersion: typeof AUDIO_DEVICE_PROTOCOL; input: AudioFormat<16000>; output: AudioFormat<24000> }
  | { type: 'capture'; audio: string }
  | { type: 'played'; id: number }
  | { type: 'error'; message: string };
export type AudioDeviceCommand =
  | { type: 'play'; id: number; audio: string }
  | { type: 'flush' }
  | { type: 'stop' };
