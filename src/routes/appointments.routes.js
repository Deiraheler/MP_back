import express from "express";
import { authRequired } from "../middleware/auth.js";
import * as controller from "../controllers/appointments.controller.js";

const router = express.Router();

// Appointment routes

// CRUD endpoints
router.get("/", authRequired, controller.listAppointments);
router.get("/:id", authRequired, controller.getAppointment);
router.put("/:id", authRequired, controller.updateAppointment);
router.delete("/:id", authRequired, controller.deleteAppointment);

// Status update
router.patch("/:id/status", authRequired, controller.updateStatus);

// Treatment prompts
router.post("/:id/treatment/prompt", authRequired, controller.addTreatmentPrompt);
router.delete("/:id/treatment/prompt/:promptId", authRequired, controller.deleteTreatmentPrompt);

// Letter prompts
router.post("/:id/letter/prompt", authRequired, controller.addLetterPrompt);
router.delete("/:id/letter/prompt/:promptId", authRequired, controller.deleteLetterPrompt);

// Treatment/note generation
router.post(
  "/:id/treatment/generate",
  authRequired,
  controller.generateTreatmentNote
);
router.post(
  "/:id/letter/generate",
  authRequired,
  controller.generateLetter
);
router.post("/:id/summary/generate", authRequired, controller.generateSummary);

// Upload treatment note to Cliniko
router.post("/:id/treatment/upload", authRequired, controller.writeNotes);

// Streaming transcription: SSE for transcript output
router.get("/:id/transcription/stream", controller.streamTranscriptions);

// Audio input: raw audio chunks from the browser
router.post(
  "/:id/transcription/audio",
  authRequired,
  express.raw({ type: "audio/*", limit: "10mb" }),
  controller.uploadAudioChunk
);

export default router;

