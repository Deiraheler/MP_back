import ApiError from "../utils/ApiError.js";
import catchAsync from "../utils/catchAsync.js";
import * as appointmentService from "../services/appointment.service.js";
import {
  addSseClient,
  removeSseClient,
  getExistingTranscriptions,
  handleAudioChunk,
} from "../services/transcription.service.js";
import { verifyToken } from "../utils/jwt.js";
import { User } from "../models/User.js";

// List all appointments
const listAppointments = catchAsync(async (req, res) => {
  const { status, appointmentId, page = 1, limit = 10, date, businessId, newOnly } = req.query;

  const filter = {
    userId: req.user && req.user._id ? req.user._id : undefined,
    status,
    appointmentId,
    date,
    businessId, // Add businessId parameter
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    newOnly: String(newOnly) === "true",
  };

  const pagination = await appointmentService.getAppointments(filter);

  res.status(200).json(pagination);
});

// Get a single appointment by ID
const getAppointment = catchAsync(async (req, res) => {
  // Ensure referral contact is fetched/saved when entering an appointment
  await appointmentService.ensureReferralContactForAppointment(req.params.id, req.user._id);

  const appointment = await appointmentService.getAppointmentById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment);
});

// Update appointment fields
const updateAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.updateAppointment(req.params.id, req.body);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment);
});

// Delete an appointment
const deleteAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.deleteAppointment(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(204).end();
});

// Update only status
const updateStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  const appointment = await appointmentService.updateAppointmentStatus(req.params.id, status);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json({ status: appointment.status });
});

// Add a treatment note prompt
const addTreatmentPrompt = catchAsync(async (req, res) => {
  const { content } = req.body;
  const appointment = await appointmentService.addTreatmentPrompt(req.params.id, content);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.treatmentNote.additionalPrompts);
});

// Delete a treatment note prompt
const deleteTreatmentPrompt = catchAsync(async (req, res) => {
  const appointment = await appointmentService.deleteTreatmentPrompt(req.params.id, req.params.promptId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.treatmentNote.additionalPrompts);
});

// Add a letter prompt
const addLetterPrompt = catchAsync(async (req, res) => {
  const { content } = req.body;
  const appointment = await appointmentService.addLetterPrompt(req.params.id, content);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.letter.additionalPrompts);
});

// Delete a letter prompt
const deleteLetterPrompt = catchAsync(async (req, res) => {
  const appointment = await appointmentService.deleteLetterPrompt(req.params.id, req.params.promptId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.letter.additionalPrompts);
});

// SSE stream for live transcriptions for a given appointment
const streamTranscriptions = async (req, res, next) => {
  try {
    const { id: appointmentId } = req.params;

    // Support auth via query token (for EventSource) or Authorization header
    const header = req.headers["authorization"] || "";
    let token = req.query.token;
    if (!token && header.startsWith("Bearer ")) {
      token = header.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = decoded.userId || decoded._id || decoded.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("_id firstName lastName email profession");
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const userKey = user._id.toString();

    // Register client
    addSseClient({ userId: userKey, appointmentId, res });

    // Send any existing transcription chunks
    const existing = await getExistingTranscriptions({ userId: userKey, appointmentId });
    for (const chunk of existing) {
      const payload = JSON.stringify({ type: "chunk", chunk });
      res.write(`data: ${payload}\n\n`);
    }

    // Handle disconnect
    req.on("close", () => {
      removeSseClient({ userId: userKey, appointmentId, res });
      try {
        res.end();
      } catch {
        // ignore
      }
    });
  } catch (err) {
    next(err);
  }
};

// Receive raw audio chunks for an appointment and forward to Deepgram
const uploadAudioChunk = catchAsync(async (req, res) => {
  const { id: appointmentId } = req.params;
  const userId = req.user && req.user._id ? req.user._id.toString() : null;

  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const audioBuffer = req.body;
  const contentType = req.headers["content-type"] || "audio/webm";

  if (!audioBuffer || !audioBuffer.length) {
    return res.status(400).json({ message: "Empty audio payload" });
  }

  await handleAudioChunk({ userId, appointmentId, audioBuffer, contentType });

  res.status(200).json({ ok: true });
});

// Generate a treatment note HTML for an appointment and persist it
const generateTreatmentNote = catchAsync(async (req, res) => {
  const { id: appointmentId } = req.params;
  const { templateId, noteId } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const note = await appointmentService.generateTreatmentNoteForAppointment({
    appointmentId,
    userId,
    templateId,
    noteId,
  });

  res.status(200).json({ note });
});

// Generate a letter HTML for an appointment and persist it
const generateLetter = catchAsync(async (req, res) => {
  const { id: appointmentId } = req.params;
  const { templateId, noteId } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const note = await appointmentService.generateTreatmentNoteForAppointment({
    appointmentId,
    userId,
    templateId,
    noteId,
    forceType: "letter",
  });

  res.status(200).json({ note });
});

// Generate a patient summary HTML for an appointment and persist it
const generateSummary = catchAsync(async (req, res) => {
  const { id: appointmentId } = req.params;
  const { templateId, noteId } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  const note = await appointmentService.generateTreatmentNoteForAppointment({
    appointmentId,
    userId,
    templateId,
    noteId,
    forceType: "summary",
  });

  res.status(200).json({ note });
});

// Streaming note generation - treatment
const generateTreatmentNoteStream = async (req, res) => {
  const { id: appointmentId } = req.params;
  const { templateId, noteId, useCurrentNote } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const note = await appointmentService.generateTreatmentNoteForAppointmentStream({
      appointmentId,
      userId,
      templateId,
      noteId,
      useCurrentNote: useCurrentNote === true,
      onChunk: (delta) => send({ delta }),
    });
    send({ done: true, note });
  } catch (err) {
    send({ error: err.message || "Failed to generate note" });
  } finally {
    res.end();
  }
};

// Streaming note generation - letter
const generateLetterStream = async (req, res) => {
  const { id: appointmentId } = req.params;
  const { templateId, noteId, useCurrentNote } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const note = await appointmentService.generateTreatmentNoteForAppointmentStream({
      appointmentId,
      userId,
      templateId,
      noteId,
      forceType: "letter",
      useCurrentNote: useCurrentNote === true,
      onChunk: (delta) => send({ delta }),
    });
    send({ done: true, note });
  } catch (err) {
    send({ error: err.message || "Failed to generate note" });
  } finally {
    res.end();
  }
};

// Streaming note generation - summary
const generateSummaryStream = async (req, res) => {
  const { id: appointmentId } = req.params;
  const { templateId, noteId, useCurrentNote } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const note = await appointmentService.generateTreatmentNoteForAppointmentStream({
      appointmentId,
      userId,
      templateId,
      noteId,
      forceType: "summary",
      useCurrentNote: useCurrentNote === true,
      onChunk: (delta) => send({ delta }),
    });
    send({ done: true, note });
  } catch (err) {
    send({ error: err.message || "Failed to generate note" });
  } finally {
    res.end();
  }
};

// Upload treatment note to Cliniko
const writeNotes = catchAsync(async (req, res) => {
  const { id: appointmentId } = req.params;
  const { noteId, noteBody, draft } = req.body || {};

  const userId = req.user && req.user._id ? req.user._id.toString() : null;
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  if (!noteBody) {
    throw new ApiError(400, "noteBody is required");
  }

  const result = await appointmentService.writeNotesToCliniko({
    appointmentId,
    userId,
    noteId,
    noteBody,
    draft: draft !== undefined ? draft : true,
  });

  res.status(200).json(result);
});

// GET /api/appointments/:id/notes/:noteId/copilot
const getCopilot = catchAsync(async (req, res) => {
  const appointmentId = req.params.id;
  const noteId = req.params.noteId;
  const userId = req.user?._id?.toString();
  if (!userId) throw new ApiError(401, "Unauthorized");

  const data = await appointmentService.getCopilotData(appointmentId, userId, noteId);
  res.status(200).json(data);
});

// PATCH /api/appointments/:id/notes/:noteId
const patchNote = catchAsync(async (req, res) => {
  const appointmentId = req.params.id;
  const noteId = req.params.noteId;
  const userId = req.user?._id?.toString();
  if (!userId) throw new ApiError(401, "Unauthorized");
  const { text } = req.body || {};
  if (text == null || typeof text !== "string") throw new ApiError(400, "text is required");

  const { note } = await appointmentService.updateNoteText(appointmentId, userId, noteId, text);
  res.status(200).json({ note });
});

// POST /api/appointments/:id/notes/:noteId/instructions
const addNoteInstruction = catchAsync(async (req, res) => {
  const appointmentId = req.params.id;
  const noteId = req.params.noteId;
  const userId = req.user?._id?.toString();
  if (!userId) throw new ApiError(401, "Unauthorized");
  const { content, key } = req.body || {};

  const result = await appointmentService.addNoteInstruction(
    appointmentId,
    userId,
    noteId,
    content,
    key,
    req.user._id
  );
  res.status(200).json(result);
});

// POST /api/appointments/:id/notes/:noteId/copilot/chat (streaming SSE)
const copilotChat = async (req, res) => {
  const appointmentId = req.params.id;
  const noteId = req.params.noteId;
  const userId = req.user?._id?.toString();
  const { message } = req.body || {};
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ message: "message is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const result = await appointmentService.copilotChatStream({
      appointmentId,
      userId,
      noteId,
      userMessage: message,
      onChunk: (delta) => send({ delta }),
    });
    send({ done: true, reply: result.reply, messages: result.messages });
  } catch (err) {
    send({ error: err.message || "Failed to process copilot chat" });
  } finally {
    res.end();
  }
};

export {
  listAppointments,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  addTreatmentPrompt,
  deleteTreatmentPrompt,
  addLetterPrompt,
  deleteLetterPrompt,
  streamTranscriptions,
  uploadAudioChunk,
  generateTreatmentNote,
  generateLetter,
  generateSummary,
  generateTreatmentNoteStream,
  generateLetterStream,
  generateSummaryStream,
  writeNotes,
  getCopilot,
  patchNote,
  addNoteInstruction,
  copilotChat,
};

