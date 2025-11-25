import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { RefreshToken } from "../models/RefreshToken.js";
import * as userService from "./user.service.js";
import { signToken, signRefreshToken, verifyRefreshToken, getSecondsUntil14DaysAt4AM } from "../utils/jwt.js";
import ApiError from "../utils/ApiError.js";

const JWT_AUTH_SECRET = process.env.JWT_SECRET || process.env.JWT_AUTH_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

// Build strict whitelist of access token claims
function buildAccessClaims(src) {
  const out = {};
  // Identity and auth
  out._id = src._id;
  out.email = src.email;
  out.firstName = src.firstName;
  out.lastName = src.lastName;
  out.createdAt = src.createdAt;

  // Add other fields as needed
  if (src.profession) out.profession = src.profession;

  return out;
}

// Generate Access Token (whitelisted claims only)
function generateAccessToken(claims) {
  return signToken(claims, "7d");
}

// Generate Refresh Token (minimal claims only)
async function generateRefreshToken(userMeta) {
  try {
    // Check if a refresh token already exists for the given userId and delete it if found
    await RefreshToken.findOneAndDelete({ userId: userMeta._id });

    // Calculate the time until 14 days from now at 4 AM
    const expiresIn = getSecondsUntil14DaysAt4AM();

    // Generate the new refresh token with minimal payload
    const refreshClaims = { _id: userMeta._id, email: userMeta.email };
    const refreshToken = signRefreshToken(refreshClaims, expiresIn);

    // Create the new refresh token in the database
    await RefreshToken.create({ userId: userMeta._id, token: refreshToken });

    // Return the newly created refresh token
    return refreshToken;
  } catch (e) {
    console.error("Error generating refresh token:", e);
    throw e;
  }
}

/**
 * Login with username and password
 */
async function loginUserWithEmailAndPassword(req, res) {
  const { email, password } = req.body;
  const user = await userService.getUserByEmail(email.toLowerCase());

  if (user && bcrypt.compareSync(password, user.passwordHash)) {
    try {
      const userObj = user.toObject();
      const { passwordHash, ...userMeta } = userObj;

      // Whitelist access token claims
      const accessClaims = buildAccessClaims(userMeta);

      const token = generateAccessToken(accessClaims);
      const refreshToken = await generateRefreshToken(userMeta);

      req.user = userMeta;

      return { auth_token: token, refresh_token: refreshToken };
    } catch (e) {
      console.error("Login error:", e);
      throw e;
    }
  } else {
    res.status(403).json({ message: "Username or password incorrect" });
    return null;
  }
}

/**
 * Logout
 */
async function logout(refreshToken) {
  try {
    const tokenFound = await RefreshToken.findOne({ token: refreshToken });
    if (tokenFound && tokenFound !== null) {
      await RefreshToken.deleteOne({ token: refreshToken });
    }
  } catch (e) {
    console.error("Logout error:", e);
  }
}

/**
 * Refresh auth tokens
 */
async function refreshToken(req, res) {
  try {
    const token = req.body.refreshToken;
    const tokenFound = await RefreshToken.findOne({ token });

    if (!tokenFound) return 403;

    return jwt.verify(token, JWT_REFRESH_SECRET, async (err, user) => {
      if (err) {
        console.error("Refresh Token Error: ", err);
        return 403;
      }

      const userDoc = await userService.getUserByEmail(user.email.toLowerCase());
      if (!userDoc) return 403;

      const userObj = userDoc.toObject();
      const { passwordHash, exp, ...userMeta } = userObj;
      const accessClaims = buildAccessClaims(userMeta);
      const accessToken = generateAccessToken(accessClaims);
      return { auth_token: accessToken };
    });
  } catch (error) {
    console.error("Error refreshing token:", error);
    return 403;
  }
}

/**
 * Reset password
 */
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body;
    const user = await User.findOne({ resetToken: token });

    if (!user) {
      return res.status(404).send({ message: "Invalid token" });
    }

    const now = new Date();
    if (!user.resetTokenExpiration || user.resetTokenExpiration < now) {
      console.error(`Token has expired. User: ${user.email}`);
      return res.status(410).send({ message: "Token has expired" });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetToken = undefined;
    user.resetTokenExpiration = undefined;
    await user.save();

    res.send({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Reset error:", err);
    res.status(500).send({ message: "Server error" });
  }
}

/**
 * Activate account
 */
async function activateAccount({ token, password, profession }) {
  try {
    const user = await User.findOne({ resetToken: token });

    if (!user) {
      return { success: false, message: "Invalid token" };
    }

    const now = new Date();
    if (!user.resetTokenExpiration || user.resetTokenExpiration < now) {
      return { success: false, message: "Token has expired" };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    user.passwordHash = hashedPassword;
    user.profession = profession;
    user.resetToken = undefined;
    user.resetTokenExpiration = undefined;

    // Set key terms based on profession
    if (profession === "Podiatrist") {
      user.keyTerms = [
        "melolin",
        "inadine",
        "verruca",
        "callus",
        "heloma durum",
        "heloma molle",
        "heloma miliare",
        "oc - onychomycosis",
        "tinea pedis",
        "fungal nail",
        "paronychia",
        "podiatry",
        "metatarsalgia",
        "morton's neuroma",
        "biomechanics",
        "pes planus",
        "pes cavus",
        "hallux valgus",
        "hallux rigidus",
        "hammer toe",
        "claw toe",
        "dorsal",
        "subungual",
        "digital deformity",
        "keratolytic",
        "hydrocolloid dressing",
        "salicylic acid",
        "silver nitrate",
        "total contact cast",
        "forefoot",
        "hindfoot",
        "midfoot",
        "calcaneus",
        "navicular",
        "talus",
        "lamisil",
        "canesten",
        "phenol",
      ];
    } else if (profession === "Physiotherapist" || profession === "Osteopath") {
      user.keyTerms = [
        "neurophysiologic mechanisms",
        "biopsychosocial framework",
        "orthopaedic manual physical therapy",
        "therapeutic exercises",
        "patient education",
        "pain-gate mechanism",
        "nociceptive activity",
        "selective tissue tension testing",
        "deep transverse friction",
        "traction",
        "manipulation techniques",
        "translatory joint play",
        "convex-concave theory",
        "joint gliding",
        "post-isometric relaxation",
        "neuromobilisation",
        "oscillatory movement",
        "mobilisation with movement (mwm)",
        "natural apophyseal glides (nags)",
        "sustained natural apophyseal glides (snags)",
        "mechanical diagnosis and therapy (mdt)",
        "derangement syndrome",
        "dysfunction syndrome",
        "postural syndrome",
        "non-mechanical syndrome",
        "repeated movements",
        "sustained postures",
        "functional loading",
        "active release techniques",
        "assisted active range of motion (aarom)",
        "passive range of motion (prom)",
        "lymph drainage",
        "instrument assisted soft tissue mobilisation",
        "joint manipulation",
        "thrust manipulation",
        "non-thrust manipulation",
        "force direction",
        "relative movement",
        "maitland grading scale",
        "mulligan manual therapy",
        "kaltenborn grading scale",
        "visual analogue scale (vas)",
        "severity irritability nature (sin)",
        "grade i mobilisation",
        "grade v manipulation",
      ];
    }

    await user.save();
    return {
      success: true,
      email: user.email,
      message: "Account activated successfully",
    };
  } catch (error) {
    console.error("Error activating account:", error);
    return { success: false, message: "Failed to activate account" };
  }
}

/**
 * Forgot password
 */
async function forgotPassword(req, res) {
  const emailAddress = req.body.email;

  console.log(`** User Forgot Password Request **: ${emailAddress}`);
  try {
    // Generate a password reset token
    const resetToken = crypto.randomBytes(20).toString("hex");

    const user = await userService.getUserByEmail(emailAddress.toLowerCase());

    if (!user) {
      return res.status(404).send("User not found");
    }

    const hours = parseInt(process.env.RESET_TOKEN_HOURS || "2", 10);
    const expiration = new Date(Date.now() + hours * 60 * 60 * 1000);

    Object.assign(user, {
      resetToken,
      resetTokenExpiration: expiration,
    });
    await user.save();

    const resetPasswordUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password/${resetToken}`;
    const text = `Hi ${user.firstName},

To reset your password, click on this link:
${resetPasswordUrl}

If you did not request a password reset, please reply to this email.

Best wishes,
The MediScribe AI Team`;

    // TODO: Implement email service
    // await emailService.sendEmail(emailAddress, 'MediScribe AI Password Reset', text);
    console.log(`Reset password link: ${resetPasswordUrl}`);

    res.status(200).send("Reset link sent successfully");
  } catch (error) {
    console.error("Error sending reset link:", error);
    res.status(500).send("Failed to send reset link");
  }
}

export {
  loginUserWithEmailAndPassword,
  forgotPassword,
  logout,
  resetPassword,
  refreshToken,
  activateAccount,
  generateAccessToken,
  generateRefreshToken,
};

