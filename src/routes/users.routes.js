import express from "express";
import { updateMe } from "../controllers/users.controller.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.put("/me", authRequired, updateMe);

export default router;


