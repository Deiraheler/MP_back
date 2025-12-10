import { Appointment } from "../models/Appointment.js";
import WebSocket from "ws";

// In-memory registry of SSE clients keyed by user + appointment
// key: `${userId}:${appointmentId}` -> Set<res>
const sseClients = new Map();

// In-memory registry of Deepgram realtime streams keyed by user + appointment
// key: `${userId}:${appointmentId}` -> { ws, ready, queue: Buffer[], userId, appointmentId, keepAliveTimer }
const deepgramStreams = new Map();

function makeKey(userId, appointmentId) {
  return `${userId}:${appointmentId}`;
}

function getClientSet(userId, appointmentId) {
  const key = makeKey(userId, appointmentId);
  if (!sseClients.has(key)) {
    sseClients.set(key, new Set());
  }
  return sseClients.get(key);
}

export function addSseClient({ userId, appointmentId, res }) {
  const set = getClientSet(userId, appointmentId);
  set.add(res);
}

export function removeSseClient({ userId, appointmentId, res }) {
  const key = makeKey(userId, appointmentId);
  const set = sseClients.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    sseClients.delete(key);
  }
}

export function broadcastTranscriptionChunk({ userId, appointmentId, chunk }) {
  const key = makeKey(userId, appointmentId);
  const set = sseClients.get(key);
  if (!set || set.size === 0) return;

  const payload = JSON.stringify({ type: "chunk", chunk });

  for (const res of set) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      // If writing fails, drop this client
      set.delete(res);
    }
  }

  if (set.size === 0) {
    sseClients.delete(key);
  }
}

export async function getExistingTranscriptions({ userId, appointmentId }) {
  const appt = await Appointment.findOne({ appointmentId, user: userId })
    .select("transcriptions")
    .lean();

  return appt?.transcriptions || [];
}

function getDeepgramStreamKey(userId, appointmentId) {
  return `${userId}:${appointmentId}`;
}

async function ensureDeepgramStream({ userId, appointmentId }) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.warn("[transcription] DEEPGRAM_API_KEY is not set. Skipping Deepgram stream.");
    return null;
  }

  const key = getDeepgramStreamKey(userId, appointmentId);
  const existing = deepgramStreams.get(key);
  if (existing && existing.ws && existing.ws.readyState === WebSocket.OPEN) {
    return existing;
  }

  const url =
    "wss://api.deepgram.com/v1/listen?model=nova-2-general&smart_format=true";

  console.log("[transcription] opening Deepgram stream", { appointmentId, userId });

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });

  const stream = {
    ws,
    ready: false,
    queue: [],
    userId,
    appointmentId,
    keepAliveTimer: null,
  };

  deepgramStreams.set(key, stream);

  ws.on("open", () => {
    stream.ready = true;
    console.log("[transcription] Deepgram stream open", { appointmentId, userId });

    // Send initial settings message (enhanced messaging) so Deepgram knows our config
    try {
      const settings = {
        type: "Settings",
        model: "nova-2-general",
        encoding: "opus",
        sample_rate: 48000,
        channels: 1,
        smart_format: true,
      };
      ws.send(JSON.stringify(settings));
    } catch (err) {
      console.error("[transcription] error sending Settings to Deepgram", err);
    }

    // Start periodic KeepAlive messages to satisfy Deepgram inactivity timeout
    if (!stream.keepAliveTimer) {
      stream.keepAliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          } catch (err) {
            console.error("[transcription] error sending KeepAlive to Deepgram", err);
          }
        }
      }, 4000);
    }
    // Flush any queued chunks
    for (const chunk of stream.queue) {
      try {
        ws.send(chunk);
      } catch (err) {
        console.error("[transcription] error sending queued chunk to Deepgram", err);
      }
    }
    stream.queue = [];
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!msg?.type || String(msg.type).toLowerCase() !== "results") return;

      const isFinal = msg.is_final;
      const alt = msg.channel?.alternatives?.[0];
      const transcript = alt?.transcript;

      if (!transcript || !transcript.trim()) return;
      if (!isFinal) return; // only store final segments

      const text = transcript.trim();
      const chunk = {
        text,
        timestamp: new Date(),
      };

      await Appointment.findOneAndUpdate(
        { appointmentId: stream.appointmentId, user: stream.userId },
        {
          $push: { transcriptions: chunk },
          $set: { recordedAt: new Date() },
        },
        { new: true }
      );

      broadcastTranscriptionChunk({
        userId: stream.userId,
        appointmentId: stream.appointmentId,
        chunk,
      });
    } catch (err) {
      console.error("[transcription] error handling Deepgram message", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[transcription] Deepgram stream error", err);
  });

  ws.on("close", (code, reason) => {
    console.log("[transcription] Deepgram stream closed", {
      appointmentId,
      userId,
      code,
      reason: reason.toString(),
    });
    if (stream.keepAliveTimer) {
      clearInterval(stream.keepAliveTimer);
      stream.keepAliveTimer = null;
    }
    deepgramStreams.delete(key);
  });

  return stream;
}

export async function handleAudioChunk({ userId, appointmentId, audioBuffer }) {
  if (!audioBuffer || !audioBuffer.length) return null;

  console.log("[transcription] received audio chunk", {
    appointmentId,
    userId,
    size: audioBuffer.length,
    isBuffer: Buffer.isBuffer(audioBuffer),
  });

  const stream = await ensureDeepgramStream({ userId, appointmentId });
  if (!stream) return null;

  if (stream.ws.readyState === WebSocket.OPEN && stream.ready) {
    try {
      stream.ws.send(audioBuffer);
    } catch (err) {
      console.error("[transcription] error sending audio chunk to Deepgram", err);
    }
  } else {
    stream.queue.push(audioBuffer);
  }

  return null;
}

