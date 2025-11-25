import express from "express";
import { createTemplate, deleteTemplate, getMyTemplates, updateTemplate } from "../controllers/templates.controller.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authRequired, getMyTemplates);
router.post("/", authRequired, createTemplate);
router.put("/:id", authRequired, updateTemplate);
router.delete("/:id", authRequired, deleteTemplate);

export default router;

