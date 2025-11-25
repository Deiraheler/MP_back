import mongoose from "mongoose";

export const TEMPLATE_TYPES = ["Treatment note", "Letter", "Patient summary"];

const templateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: TEMPLATE_TYPES, required: true },
    content: { type: String, default: "" },
  },
  { timestamps: true }
);

templateSchema.index({ user: 1, createdAt: -1 });

export const Template = mongoose.model("Template", templateSchema);

