/** bySide local API v1. Keep provider credentials on the server. */
export type ExtensionPermission = 'read' | 'growth' | 'respond';
export type EventType = 'companion.updated' | 'message.created' | 'memory.changed' | 'memory.deleted' | 'vision.observed' | 'device.changed';
export interface ExtensionManifest {
  protocolVersion: '1.0'; id: string; name: string; url: string;
  permissions: ExtensionPermission[]; actions: string[]; events: EventType[];
}
export interface ExtensionRegistration extends ExtensionManifest { token: string }
export interface Companion {
  id: string; character: string; personality: string; mood: string; motion: string;
  speech: string; growth: number; growthStage: number; intimacy: number; energy: number;
  [key: string]: unknown;
}
export interface ChatMessage { id: string; sessionId: string; role: 'user' | 'assistant'; text: string; createdAt: string }
export interface Memory { id: string; text: string; createdAt: string; updatedAt: string }
export interface Snapshot { companion: Companion; messages: ChatMessage[]; memories: Memory[] }
export interface FoundationEvent<T = unknown> { id: number; type: EventType; data: T }
export interface GrowthResult { duplicate: boolean; companion?: Companion }
export interface RealtimeTool { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }
export interface FoodReference {
  product: string; source: 'user-supplied-package-photo'; basis: 'per-100g';
  matchBasis?: 'user-specified-test';
  visualCertainty?: 'confirmed' | 'uncertain';
  nutrients: { energyKj: number; proteinG: number; fatG: number; saturatedFatG: number; carbohydrateG: number; sugarG: number; sodiumMg: number };
  allergens?: string[];
}
export interface DesktopObservation {
  description: string; foodPresent: boolean;
  foods: { name: string; group: string; certain: boolean; colorTone?: 'light' | 'dark' | 'unknown'; classificationBasis?: 'user-specified-test'; visualCertain?: boolean }[];
  observedAt: string;
  foodReferences?: FoodReference[];
}
export type RealtimeCommand =
  | { type: 'session.start'; fullDuplex?: boolean; desktopVision?: boolean; tools?: RealtimeTool[] }
  | { type: 'session.close' | 'input.commit' | 'input.mute' | 'input.unmute' | 'response.cancel' | 'vision.pause' | 'vision.resume' }
  | { type: 'input.text'; text: string }
  | { type: 'vision.frame'; frameId: string; image: string; captureId?: string }
  | { type: 'tool.result'; callId: string; output: unknown };
export type RealtimeEvent =
  | { type: 'session.ready'; sessionId: string; provider: 'doubao-realtime'; fullDuplex: boolean; desktopVision?: boolean }
  | { type: 'session.closed' | 'transcript.started' | 'audio.started' | 'audio.done' | 'audio.flush' | 'response.done' | 'response.canceled' }
  | { type: 'transcript.partial' | 'transcript.final' | 'assistant.text.delta' | 'assistant.text.done'; text: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'transcript.error' | 'input.error' | 'vision.error'; message: string }
  | { type: 'vision.capture'; captureId: string }
  | { type: 'vision.frame.accepted' | 'vision.analyzing'; frameId: string }
  | ({ type: 'vision.observation' } & DesktopObservation)
  | { type: 'tool.call'; items: { callId: string; name: string; arguments: string }[] };
export class BySideError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'BySideError'; }
}

class HttpClient {
  constructor(protected readonly baseUrl = 'http://127.0.0.1:4173/api/v1', protected readonly token?: string) {}
  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string };
      throw new BySideError(response.status, error.message || `bySide API ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

export class BySideClient extends HttpClient {
  constructor(baseUrl?: string) { super(baseUrl); }
  capabilities() { return this.request<{ apiVersion: string; extensionProtocolVersion: string; permissions: Record<string, string>; eventTypes: EventType[]; speech: { synthesis: string; recognition: string; realtime: string; recognitionAudio: string } }>('/capabilities'); }
  snapshot() { return this.request<Snapshot>('/snapshot'); }
  chat(text: string, requestId = crypto.randomUUID(), signal?: AbortSignal) { return this.request<{ requestId: string; message: ChatMessage }>('/chat', 'POST', { text, requestId }, signal); }
  registerExtension(manifest: ExtensionManifest) { return this.request<ExtensionRegistration>('/extensions', 'POST', manifest); }
  invokeAction<T = unknown>(id: string, action: string, input: unknown) { return this.request<T>(`/extensions/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`, 'POST', input); }
  events(after = 0) { return new EventSource(`${this.baseUrl}/events?after=${after}`); }
  /** Binary uplink: 20 ms PCM s16le 16 kHz mono; binary downlink: PCM s16le 24 kHz mono. */
  realtimeSpeech(options: { fullDuplex?: boolean; desktopVision?: boolean; tools?: RealtimeTool[] } = {}) {
    const url = new URL(`${this.baseUrl}/speech/realtime`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url); socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'session.start', ...options } satisfies RealtimeCommand)));
    return socket;
  }
}

export class BySideExtensionClient extends HttpClient {
  constructor(readonly id: string, token: string, baseUrl?: string) { super(baseUrl, token); }
  private path(suffix: string) { return `/extensions/${encodeURIComponent(this.id)}/${suffix}`; }
  snapshot() { return this.request<Snapshot>(this.path('snapshot')); }
  growth(eventId: string, kind: string) { return this.request<GrowthResult>(this.path('events'), 'POST', { eventId, kind }); }
  respond(text: string) { return this.request<Companion>(this.path('respond'), 'POST', { text }); }
  /** Reconnect with the last processed id; events may be replayed after a disconnect. */
  async *subscribe(after = 0, signal?: AbortSignal): AsyncGenerator<FoundationEvent> {
    const response = await fetch(`${this.baseUrl}${this.path('stream')}?after=${after}`, { headers: { Authorization: `Bearer ${this.token}` }, signal });
    if (!response.ok || !response.body) throw new BySideError(response.status, `事件订阅失败（${response.status}）`);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        pending += decoder.decode(next.value, { stream: true });
        let split;
        while ((split = pending.search(/\r?\n\r?\n/)) !== -1) {
          const match = /\r?\n\r?\n/.exec(pending.slice(split))!;
          const frame = pending.slice(0, split); pending = pending.slice(split + match[0].length);
          let id = 0, type = '', data = '';
          for (const line of frame.split(/\r?\n/)) {
            if (line.startsWith('id:')) id = Number(line.slice(3).trim());
            else if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
          }
          if (id && type && data) yield { id, type: type as EventType, data: JSON.parse(data) };
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
