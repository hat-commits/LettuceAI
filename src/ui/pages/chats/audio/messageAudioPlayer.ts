import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  abortAudioPreview,
  generateTtsForMessage,
  getTtsCached,
  getTtsCacheKey,
  playAudioFromBase64,
  saveTtsToCache,
  streamDoubaoTts,
  type AudioProviderType,
  type TtsPreviewResponse,
} from "../../../../core/storage/audioProviders";

const DOUBAO_STREAM_BUFFER_SECONDS = 0.7;
const S16_MAX = 32768;
const PCM_MIME_TYPE = "audio/pcm";

export interface MessageAudioRequest {
  providerId: string;
  providerType: AudioProviderType;
  modelId: string;
  voiceId: string;
  text: string;
  prompt?: string;
  requestId: string;
  cached?: TtsPreviewResponse;
  onCache?: (response: TtsPreviewResponse) => void;
  onPlaybackStart?: () => void;
}

export interface MessageAudioPlayback {
  stop: () => void;
  done: Promise<void>;
}

type DoubaoStreamPayload =
  | { type: "start"; sampleRate: number; format: string; mimeType: string }
  | { type: "chunk"; audioBase64: string }
  | { type: "end" }
  | { type: "error"; message?: string };

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64Bytes(value: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    const chunk = value.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function concatByteChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = view.getInt16(i * 2, true) / S16_MAX;
  }
  return out;
}

class PcmStreamQueue {
  private audioContext: AudioContext | null = null;
  private sampleRate = 24000;
  private queue: Float32Array[] = [];
  private queuedSamples = 0;
  private started = false;
  private ended = false;
  private stopped = false;
  private nextStartTime = 0;
  private pendingSources = 0;
  private resolveDone: (() => void) | null = null;
  private readonly donePromise = new Promise<void>((resolve) => {
    this.resolveDone = resolve;
  });

  constructor(private readonly onPlaybackStart?: () => void) {}

  get done() {
    return this.donePromise;
  }

  configure(sampleRate: number) {
    if (Number.isFinite(sampleRate) && sampleRate > 0) {
      this.sampleRate = sampleRate;
    }
  }

  push(bytes: Uint8Array) {
    if (this.stopped || bytes.byteLength < 2) return;
    const samples = pcm16ToFloat32(bytes);
    if (samples.length === 0) return;
    this.queue.push(samples);
    this.queuedSamples += samples.length;
    if (!this.started && this.queuedSamples / this.sampleRate >= DOUBAO_STREAM_BUFFER_SECONDS) {
      void this.start();
    } else if (this.started) {
      this.scheduleAvailable();
    }
  }

  finish() {
    this.ended = true;
    if (!this.started) {
      void this.start();
    } else {
      this.checkDone();
    }
  }

  async start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    this.nextStartTime = this.audioContext.currentTime + 0.04;
    this.onPlaybackStart?.();
    this.scheduleAvailable();
    this.checkDone();
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.queuedSamples = 0;
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.resolveDone?.();
    this.resolveDone = null;
  }

  private scheduleAvailable() {
    const ctx = this.audioContext;
    if (!ctx || this.stopped) return;
    while (this.queue.length > 0) {
      const samples = this.queue.shift();
      if (!samples) break;
      this.queuedSamples -= samples.length;
      const buffer = ctx.createBuffer(1, samples.length, this.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const startAt = Math.max(this.nextStartTime, ctx.currentTime + 0.02);
      this.nextStartTime = startAt + buffer.duration;
      this.pendingSources += 1;
      source.onended = () => {
        this.pendingSources = Math.max(0, this.pendingSources - 1);
        this.checkDone();
      };
      source.start(startAt);
    }
  }

  private checkDone() {
    if (!this.ended || this.queue.length > 0 || this.pendingSources > 0 || this.resolveDone == null) {
      return;
    }
    this.resolveDone();
    this.resolveDone = null;
  }
}

async function startPcmPlayback(
  audioBase64: string,
  onPlaybackStart?: () => void,
): Promise<MessageAudioPlayback> {
  const queue = new PcmStreamQueue(onPlaybackStart);
  queue.push(decodeBase64Bytes(audioBase64));
  queue.finish();
  return {
    stop: () => queue.stop(),
    done: queue.done,
  };
}

async function startBufferedPlayback(request: MessageAudioRequest): Promise<MessageAudioPlayback> {
  const response =
    request.cached ??
    (await generateTtsForMessage(
      request.providerId,
      request.modelId,
      request.voiceId,
      request.text,
      request.prompt,
      request.requestId,
    ));
  if (!request.cached) {
    request.onCache?.(response);
  }
  request.onPlaybackStart?.();
  const audio = playAudioFromBase64(response.audioBase64, response.format);
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  audio.onended = () => {
    resolveDone?.();
    resolveDone = null;
  };
  audio.onerror = () => {
    resolveDone?.();
    resolveDone = null;
  };
  return {
    stop: () => {
      void abortAudioPreview(request.requestId).catch(() => undefined);
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
      resolveDone?.();
      resolveDone = null;
    },
    done,
  };
}

async function startDoubaoStreamPlayback(
  request: MessageAudioRequest,
): Promise<MessageAudioPlayback> {
  const cacheKey = await getTtsCacheKey(
    request.providerId,
    request.modelId,
    request.voiceId,
    request.text,
    request.prompt,
  );
  const cached = request.cached ?? (await getTtsCached(cacheKey));
  if (cached) {
    request.onCache?.(cached);
    if (cached.format === PCM_MIME_TYPE) {
      return startPcmPlayback(cached.audioBase64, request.onPlaybackStart);
    }
    return startBufferedPlayback({ ...request, cached });
  }

  const queue = new PcmStreamQueue(request.onPlaybackStart);
  const eventName = `tts-stream://${request.requestId}`;
  let unlisten: UnlistenFn | null = null;
  let streamError: Error | null = null;
  let stopped = false;
  const audioChunks: Uint8Array[] = [];

  unlisten = await listen<DoubaoStreamPayload | string>(eventName, (event) => {
    const rawPayload = event.payload;
    const payload =
      typeof rawPayload === "string"
        ? (JSON.parse(rawPayload) as DoubaoStreamPayload)
        : rawPayload;
    if (payload.type === "start") {
      queue.configure(payload.sampleRate);
      return;
    }
    if (payload.type === "chunk") {
      const bytes = decodeBase64Bytes(payload.audioBase64);
      audioChunks.push(bytes);
      queue.push(bytes);
      return;
    }
    if (payload.type === "end") {
      queue.finish();
      return;
    }
    if (payload.type === "error") {
      streamError = new Error(payload.message || "Doubao TTS stream failed");
      queue.stop();
    }
  });

  const command = streamDoubaoTts(
    request.providerId,
    request.modelId,
    request.voiceId,
    request.text,
    request.requestId,
    request.prompt,
  ).finally(() => {
    unlisten?.();
    unlisten = null;
  });

  const commandCompletion = command.catch((error) => {
    streamError = error instanceof Error ? error : new Error(String(error));
    queue.stop();
  });
  const cacheSave = command.then(async () => {
    if (stopped || audioChunks.length === 0) return;
    const audioBase64 = encodeBase64Bytes(concatByteChunks(audioChunks));
    request.onCache?.({ audioBase64, format: PCM_MIME_TYPE });
    await saveTtsToCache(cacheKey, audioBase64, PCM_MIME_TYPE).catch((error) => {
      console.warn("Failed to save streamed Doubao TTS audio to cache:", error);
    });
  });

  return {
    stop: () => {
      stopped = true;
      void abortAudioPreview(request.requestId).catch(() => undefined);
      unlisten?.();
      unlisten = null;
      queue.stop();
    },
    done: Promise.all([queue.done, commandCompletion, cacheSave.catch(() => undefined)]).then(() => {
      if (streamError) throw streamError;
    }),
  };
}

export async function startMessageAudioPlayback(
  request: MessageAudioRequest,
): Promise<MessageAudioPlayback> {
  if (request.providerType === "doubao_tts") {
    try {
      return await startDoubaoStreamPlayback(request);
    } catch (error) {
      console.warn("Doubao streaming TTS failed before playback; falling back to buffered TTS.", error);
    }
  }
  return startBufferedPlayback(request);
}
