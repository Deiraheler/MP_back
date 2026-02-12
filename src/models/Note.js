import mongoose from "mongoose";

export const NoteSchema = new mongoose.Schema(
  {
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "Template", required: true },
    text: { type: String, required: true }, // HTML content generated
    created: { type: Date, default: Date.now },
    // Optional Copilot Chat + Additional Instructions (Option A: stored in note)
    copilot: {
      messages: [
        {
          id: { type: String, required: true },
          role: { type: String, enum: ["user", "assistant", "system"], required: true },
          content: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      instructions: [
        {
          id: { type: String, required: true },
          content: { type: String, required: true },
          key: { type: String, default: null },
          createdAt: { type: Date, default: Date.now },
          authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
      ],
    },
  },
  { _id: true }
);

export const Note = mongoose.model("Note", NoteSchema);


