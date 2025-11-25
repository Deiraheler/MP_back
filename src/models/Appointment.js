import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, default: "pending" },
    appointmentDate: { type: Date },
    recordedAt: { type: Date },
    patientInfo: {
      id: { type: String },
      name: { type: String },
      firstName: { type: String },
      lastName: { type: String },
      dateOfBirth: { type: String },
      sex: { type: String },
      email: { type: String },
      mobilePhone: { type: String },
      homePhone: { type: String },
      workPhone: { type: String },
      address: {
        line1: { type: String },
        line2: { type: String },
        city: { type: String },
        state: { type: String },
        postalCode: { type: String },
        country: { type: String },
      },
    },
    referralContact: {
      id: { type: String },
      firstName: { type: String },
      lastName: { type: String },
      fullName: { type: String },
      email: { type: String },
      mobilePhone: { type: String },
      homePhone: { type: String },
      workPhone: { type: String },
      companyName: { type: String },
      title: { type: String },
      address: {
        line1: { type: String },
        line2: { type: String },
        city: { type: String },
        state: { type: String },
        postalCode: { type: String },
        country: { type: String },
      },
    },
    treatmentNote: {
      additionalPrompts: [
        {
          content: { type: String, required: true },
        },
      ],
    },
    letter: {
      additionalPrompts: [
        {
          content: { type: String, required: true },
        },
      ],
    },
  },
  { timestamps: true }
);

appointmentSchema.index({ user: 1, appointmentDate: 1 });
appointmentSchema.index({ appointmentDate: 1, createdAt: 1 });

export const Appointment = mongoose.model("Appointment", appointmentSchema);

