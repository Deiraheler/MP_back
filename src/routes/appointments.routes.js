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

export default router;

