import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

// userId index (unique: true on token already creates an index for token)
refreshTokenSchema.index({ userId: 1 });

export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

