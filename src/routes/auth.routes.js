import express from "express";
import {
  register,
  login,
  logout,
  refreshTokens,
  forgotPassword,
  resetPassword,
  activateAccount,
  sendVerificationEmail,
  verifyEmail,
  stripeTokenExchange,
  checkEmailAvailable,
  sendSignupVerificationCode,
  verifySignupCode,
  me,
} from "../controllers/auth.controller.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/activate-account", activateAccount);
router.post("/logout", logout);
router.post("/refresh-token", refreshTokens);
router.post("/stripe-token-exchange", stripeTokenExchange);
router.post("/check-email", checkEmailAvailable);
router.post("/send-signup-code", sendSignupVerificationCode);
router.post("/verify-signup-code", verifySignupCode);
router.get("/me", authRequired, me);

// TODO: Add validation middleware if needed
// router.post("/login", validate(authValidation.login), login);
// router.post("/logout", validate(authValidation.logout), logout);

export default router;
