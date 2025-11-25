import jwt from "jsonwebtoken";

const JWT_AUTH_SECRET = process.env.JWT_SECRET || process.env.JWT_AUTH_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

export function signToken(payload, expiresIn = "7d") {
  const secret = JWT_AUTH_SECRET;
  if (!secret) throw new Error("JWT_SECRET or JWT_AUTH_SECRET is not configured");
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token) {
  const secret = JWT_AUTH_SECRET;
  if (!secret) throw new Error("JWT_SECRET or JWT_AUTH_SECRET is not configured");
  return jwt.verify(token, secret);
}

export function signRefreshToken(payload, expiresIn) {
  const secret = JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is not configured");
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyRefreshToken(token) {
  const secret = JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is not configured");
  return jwt.verify(token, secret);
}

// Helper function to calculate seconds until 14 days from now at 4 AM
export function getSecondsUntil14DaysAt4AM() {
  const now = new Date();
  const expirationDate = new Date();
  expirationDate.setDate(now.getDate() + 14); // Add 14 days
  expirationDate.setHours(4, 0, 0, 0); // Set time to exactly 4 AM
  const diffInMilliseconds = expirationDate - now;
  return Math.floor(diffInMilliseconds / 1000);
}


