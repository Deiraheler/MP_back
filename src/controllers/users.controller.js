import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { UserSettings } from "../models/UserSettings.js";
import { encrypt, decrypt } from "../utils/encryption.js";
import { extractRegionFromApiKey } from "../utils/clinikoRegion.js";
import { findPractitionerByEmail } from "../services/cliniko.service.js";

export async function updateMe(req, res) {
  const { firstName, lastName, email, profession, password, verifyPassword, apiKey, business } = req.body || {};

  const updates = {};
  if (firstName !== undefined) updates.firstName = firstName;
  if (lastName !== undefined) updates.lastName = lastName;
  if (email !== undefined) updates.email = email;
  if (profession !== undefined) updates.profession = profession;

  if (password || verifyPassword) {
    if (!password || !verifyPassword) {
      return res.status(400).json({ message: "Both password and verifyPassword are required to change password" });
    }
    if (password !== verifyPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }
    updates.passwordHash = await bcrypt.hash(password, 10);
  }

  // Update user
  if (Object.keys(updates).length > 0) {
    const emailConflict = updates.email
      ? await User.findOne({ email: updates.email.toLowerCase().trim(), _id: { $ne: req.user._id } })
      : null;
    if (emailConflict) return res.status(409).json({ message: "Email is already in use" });
    await User.findByIdAndUpdate(req.user._id, updates, { new: true });
  }

  // Update settings (create if missing)
  const settingsUpdate = {};
  if (apiKey !== undefined) {
    // Allow both plain and already-encrypted API keys.
    const isAlreadyEncrypted = typeof apiKey === "string" && apiKey.startsWith("$$_");
    settingsUpdate.apiKey = isAlreadyEncrypted ? apiKey : encrypt(apiKey);
    
    // Extract and save region from API key
    try {
      // Region detection should work on the plain API key, so decrypt if needed
      const plainApiKey = isAlreadyEncrypted ? decrypt(apiKey) : apiKey;
      const detectedRegion = extractRegionFromApiKey(plainApiKey);
      settingsUpdate.apiRegion = detectedRegion;
      
      // Try to find practitioner ID by matching user email (no business filter needed)
      try {
        const user = await User.findById(req.user._id).select("email").lean();
        if (user?.email) {
          console.log("[users] attempting to find practitioner by email", {
            email: user.email,
            region: detectedRegion,
          });
          const practitionerId = await findPractitionerByEmail(
            plainApiKey,
            detectedRegion,
            user.email
          );
          if (practitionerId) {
            settingsUpdate.practitionerId = practitionerId;
            console.log("[users] found and saved practitioner ID", { practitionerId });
          } else {
            console.log("[users] no practitioner found matching email", { email: user.email });
          }
        }
      } catch (error) {
        console.error("[users] error finding practitioner by email:", error);
        // Don't fail the request if practitioner lookup fails
      }
    } catch (error) {
      console.error("Error detecting region from API key:", error);
      // Throw error if region cannot be extracted
      return res.status(400).json({ 
        message: error.message || "Could not extract region from API key. Please check the key format." 
      });
    }
  }
  if (business !== undefined) {
    settingsUpdate.business = business;
    
    // If API key is already set, try to find practitioner ID when business changes
    const currentSettings = await UserSettings.findOne({ user: req.user._id }).lean();
    if (currentSettings?.apiKey && currentSettings?.apiRegion) {
      try {
        const user = await User.findById(req.user._id).select("email").lean();
        if (user?.email) {
          const decryptedKey = decrypt(currentSettings.apiKey);
          console.log("[users] attempting to find practitioner by email (business changed)", {
            email: user.email,
            region: currentSettings.apiRegion,
          });
          const practitionerId = await findPractitionerByEmail(
            decryptedKey,
            currentSettings.apiRegion,
            user.email
          );
          if (practitionerId) {
            settingsUpdate.practitionerId = practitionerId;
            console.log("[users] found and saved practitioner ID (business changed)", { practitionerId });
          }
        }
      } catch (error) {
        console.error("[users] error finding practitioner by email (business changed):", error);
        // Don't fail the request if practitioner lookup fails
      }
    }
  }
  if (Object.keys(settingsUpdate).length > 0) {
    await UserSettings.findOneAndUpdate(
      { user: req.user._id },
      { $set: settingsUpdate, $setOnInsert: { user: req.user._id } },
      { upsert: true }
    );
  }

  const user = await User.findById(req.user._id).select("_id firstName lastName email profession");
  const settings = await UserSettings.findOne({ user: req.user._id }).lean();
  
  // Decrypt API key for response (only return masked version for security)
  const responseSettings = settings || { apiKey: "", business: "", apiRegion: "" };
  if (responseSettings.apiKey) {
    const decrypted = decrypt(responseSettings.apiKey);
    // Return masked version (show only last 4 characters)
    responseSettings.apiKey = decrypted ? "•".repeat(Math.max(0, decrypted.length - 4)) + decrypted.slice(-4) : "";
  }
  
  return res.json({ user, settings: responseSettings });
}


