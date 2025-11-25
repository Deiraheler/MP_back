import express from "express";
import { getProfessions, getTemplateTypes, fetchBusinesses } from "../controllers/metadata.controller.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/professions", getProfessions);
router.get("/template-types", getTemplateTypes);
router.post("/businesses", authRequired, fetchBusinesses);

export default router;


