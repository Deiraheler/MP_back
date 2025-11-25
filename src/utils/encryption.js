import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "default-encryption-key-change-in-production";
const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16; // For AES, this is always 16

// Ensure the encryption key is 32 bytes (256 bits) for AES-256
function getKey() {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

/**
 * Encrypts a string value
 * @param {string} text - The text to encrypt
 * @returns {string} - Encrypted string (format: iv:encryptedData)
 */
export function encrypt(text) {
  if (!text) return "";
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypts an encrypted string
 * @param {string} encryptedText - The encrypted text (format: iv:encryptedData)
 * @returns {string} - Decrypted string
 */
export function decrypt(encryptedText) {
  if (!encryptedText) return "";
  
  try {
    const hasLegacyPrefix = typeof encryptedText === "string" && encryptedText.startsWith("$$_");
    console.log("[encryption] decrypt called", { hasLegacyPrefix });

    // Support values prefixed with "$$_" (legacy format) by stripping the marker
    const raw = hasLegacyPrefix ? encryptedText.slice(3) : encryptedText;

    const parts = raw.split(":");
    if (parts.length !== 2) {
      console.log("[encryption] value is not in iv:cipher format; returning original");
      // If not in expected format, assume it's unencrypted (for migration)
      return encryptedText;
    }
    
    // Validate hex format
    if (!/^[0-9a-fA-F]+$/.test(parts[0]) || !/^[0-9a-fA-F]+$/.test(parts[1])) {
      console.log("[encryption] iv/cipher not valid hex; returning original");
      // Not valid hex, likely unencrypted
      return encryptedText;
    }
    
    const iv = Buffer.from(parts[0], "hex");
    if (iv.length !== IV_LENGTH) {
      console.log("[encryption] IV length", iv.length, "!=", IV_LENGTH, "; returning original");
      // Invalid IV length, likely unencrypted
      return encryptedText;
    }
    
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    console.log("[encryption] decrypt success");
    return decrypted;
  } catch (error) {
    console.log("[encryption] decrypt error; returning original", error?.message);
    // If decryption fails (invalid IV, wrong format, etc.), return original
    // This handles cases where the key is not yet encrypted
    return encryptedText;
  }
}

