import mongoose from "mongoose";

export const CLINICIAN_PROFESSIONS = [
  "General Practitioner",
  "Nurse",
  "Physician Assistant",
  "Physiotherapist",
  "Occupational Therapist",
  "Psychologist",
  "Psychiatrist",
  "Dentist",
  "Optometrist",
  "Pharmacist",
  "Midwife",
  "Paramedic",
];

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    profession: { type: String, enum: CLINICIAN_PROFESSIONS, required: true },
    resetToken: { type: String },
    resetTokenExpiration: { type: Date },
    stripeOneTimeCode: { type: String },
    keyTerms: [{ type: String }],
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);


