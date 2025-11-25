import mongoose from "mongoose";

const userSettingsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    // Encrypted Cliniko API key (supports both new and legacy formats)
    apiKey: { type: String, default: "" },
    // Cliniko API region (au, us, uk, ca, nz, eu) - extracted from API key
    apiRegion: { type: String },
    // Selected Cliniko business id for this user
    business: { type: String, default: "" },
    // Practitioner ID from Cliniko (found by matching user email)
    practitionerId: { type: String, default: "" },
  },
  { timestamps: true }
);

export const UserSettings = mongoose.model("UserSettings", userSettingsSchema);


