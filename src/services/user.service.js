import { User } from "../models/User.js";
import { UserSettings } from "../models/UserSettings.js";
import bcrypt from "bcryptjs";

async function getUserByEmail(email) {
  return User.findOne({ email: email.toLowerCase().trim() });
}

async function getUserById(id) {
  return User.findById(id);
}

async function getUserByStripeOneTimeCode(code) {
  return User.findOne({ stripeOneTimeCode: code });
}

async function createUser(userData) {
  const { firstName, lastName, email, password, profession, stripeOneTimeCode } = userData;

  // Check if user already exists
  const existing = await getUserByEmail(email);
  if (existing) {
    throw new Error("Email is already registered");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const user = await User.create({
    firstName,
    lastName,
    email: email.toLowerCase().trim(),
    passwordHash,
    profession,
    stripeOneTimeCode,
  });

  // Create user settings
  await UserSettings.create({ user: user._id });

  return user;
}

async function updateUserById(id, updates) {
  return User.findByIdAndUpdate(id, updates, { new: true });
}

export { getUserByEmail, getUserById, getUserByStripeOneTimeCode, createUser, updateUserById };

