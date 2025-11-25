import mongoose from "mongoose";

const emailVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Compound index covers email queries (email index is included in compound index)
emailVerificationSchema.index({ email: 1, createdAt: -1 });

export const EmailVerification = mongoose.model("EmailVerification", emailVerificationSchema);

