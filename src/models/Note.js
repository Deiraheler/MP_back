import mongoose from "mongoose";

export const NoteSchema = new mongoose.Schema(
  {
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "Template", required: true },
    text: { type: String, required: true }, // HTML content generated
    created: { type: Date, default: Date.now },
  },
  { _id: true }
);

export const Note = mongoose.model("Note", NoteSchema);


