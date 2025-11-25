import catchAsync from "../utils/catchAsync.js";
import * as authService from "../services/auth.service.js";
import * as userService from "../services/user.service.js";
import { EmailVerification } from "../models/EmailVerification.js";
import * as emailService from "../services/email.service.js";
import { generateAccessToken, generateRefreshToken } from "../services/auth.service.js";

const register = catchAsync(async (req, res) => {
  // Accept all registration fields from req.body
  // userService.createUser will handle user creation
  try {
    const result = await userService.createUser(req.body);

    // Generate tokens for immediate login
    const userObj = result.toObject();
    const { passwordHash, ...userMeta } = userObj;
    const token = generateAccessToken({ _id: userMeta._id, email: userMeta.email, firstName: userMeta.firstName, lastName: userMeta.lastName });
    const refreshToken = await generateRefreshToken(userMeta);

    const userResponse = {
      _id: userMeta._id,
      firstName: userMeta.firstName,
      lastName: userMeta.lastName,
      email: userMeta.email,
      profession: userMeta.profession,
    };

    // Return in format compatible with both old and new frontend expectations
    res.status(201).send({
      user: userResponse,
      auth_token: token,
      refresh_token: refreshToken,
      tokens: { auth_token: token, refresh_token: refreshToken },
    });
  } catch (error) {
    if (error.message === "Email is already registered") {
      return res.status(409).json({ message: error.message });
    }
    return res.status(400).json({ message: error.message || "Registration failed" });
  }
});

const login = catchAsync(async (req, res) => {
  const tokens = await authService.loginUserWithEmailAndPassword(req, res);
  if (tokens) {
    res.send(tokens);
  }
});

const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(204).send();
});

const refreshTokens = async (req, res) => {
  const token = await authService.refreshToken(req, res);
  if (!token) res.status(403).send("Forbidden: Invalid or missing token");
  else if (token == 403) res.status(403).send("Forbidden: Invalid or missing token");
  else res.send(token);
};

const forgotPassword = catchAsync(async (req, res) => {
  await authService.forgotPassword(req, res);
});

const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req, res);
});

const activateAccount = catchAsync(async (req, res) => {
  console.log("Activating account for email token:", req.body.token);
  const { email, success, message } = await authService.activateAccount(req.body);
  return res.status(200).send({ email, success, message });
});

const sendVerificationEmail = catchAsync(async (req, res) => {
  // TODO: Implement token generation for email verification
  // const verifyEmailToken = await tokenService.generateVerifyEmailToken(req.user);
  // await emailService.sendVerificationEmail(req.user.email, verifyEmailToken);
  res.status(204).send();
});

const verifyEmail = catchAsync(async (req, res) => {
  // TODO: Implement email verification
  // await authService.verifyEmail(req.query.token);
  res.status(204).send();
});

const stripeTokenExchange = catchAsync(async (req, res) => {
  const { code } = req.body;
  console.log("Stripe token exchange code:", code);
  if (!code) {
    return res.status(400).send({ error: "Missing code" });
  }
  const user = await userService.getUserByStripeOneTimeCode(code);
  console.log("Stripe token exchange user:", user);
  if (!user) {
    return res.status(404).send({ error: "Invalid or expired code" });
  }

  // Remove the code so it can't be reused
  user.stripeOneTimeCode = undefined;
  await user.save();

  // Generate tokens using the same logic as login
  const userMeta = user.toObject();
  const { passwordHash, ...userPayload } = userMeta;
  const token = generateAccessToken({ _id: userPayload._id, email: userPayload.email, firstName: userPayload.firstName, lastName: userPayload.lastName });
  const refreshToken = await generateRefreshToken(userPayload);

  res.send({ auth_token: token, refresh_token: refreshToken });
});

// Email availability check and code flow
const checkEmailAvailable = catchAsync(async (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  if (!email) return res.status(400).send({ available: false, message: "Email is required" });
  const existing = await userService.getUserByEmail(email);
  res.send({ available: !existing });
});

const sendSignupVerificationCode = catchAsync(async (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  if (!email) return res.status(400).send({ message: "Email is required" });
  const existingUser = await userService.getUserByEmail(email);
  if (existingUser) {
    return res.status(409).send({ message: "Email already in use" });
  }

  // Reuse an existing, unexpired, unverified code if present; otherwise create a new one
  const now = new Date();
  let record = await EmailVerification.findOne({ email, verified: false, expiresAt: { $gt: now } }).sort({ createdAt: -1 });
  let code;

  if (record) {
    code = record.code;
  } else {
    code = ("" + Math.floor(100000 + Math.random() * 900000)).slice(-6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    record = await EmailVerification.create({ email, code, expiresAt, verified: false });
  }

  const { firstName = "", lastName = "" } = req.body || {};
  await emailService.sendTemplateEmail(email, "Your MediScribe AI sign-up verification code", "verification_code_email.html", { code, firstName, lastName });

  res.send({ success: true });
});

const verifySignupCode = catchAsync(async (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  const code = (req.body.code || "").trim();
  if (!email || !code) return res.status(200).send({ verified: false, message: "Email and code are required" });
  const record = await EmailVerification.findOne({ email }).sort({ createdAt: -1 });
  if (!record) return res.status(200).send({ verified: false, message: "No code found" });
  if (record.expiresAt < new Date()) return res.status(200).send({ verified: false, message: "Code expired" });
  if (record.verified) return res.send({ verified: true });
  if (record.code !== code) return res.status(200).send({ verified: false, message: "Invalid code" });
  record.verified = true;
  await record.save();
  res.send({ verified: true });
});

export {
  register,
  login,
  logout,
  refreshTokens,
  forgotPassword,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
  activateAccount,
  stripeTokenExchange,
  checkEmailAvailable,
  sendSignupVerificationCode,
  verifySignupCode,
};

// Keep me endpoint for backward compatibility
import { UserSettings } from "../models/UserSettings.js";
import { decrypt } from "../utils/encryption.js";

export async function me(req, res) {
  const settings = await UserSettings.findOne({ user: req.user._id }).lean();
  
  // Decrypt API key for response (only return masked version for security)
  const responseSettings = settings || { apiKey: "", business: "", apiRegion: "" };
  if (responseSettings.apiKey) {
    const decrypted = decrypt(responseSettings.apiKey);
    // Return masked version (show only last 4 characters)
    responseSettings.apiKey = decrypted ? "•".repeat(Math.max(0, decrypted.length - 4)) + decrypted.slice(-4) : "";
  }
  
  return res.json({
    user: req.user,
    settings: responseSettings,
  });
}
