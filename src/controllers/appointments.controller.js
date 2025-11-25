import ApiError from "../utils/ApiError.js";
import catchAsync from "../utils/catchAsync.js";
import * as appointmentService from "../services/appointment.service.js";

// List all appointments
const listAppointments = catchAsync(async (req, res) => {
  const { status, appointmentId, page = 1, limit = 10, date, businessId, newOnly } = req.query;

  const filter = {
    userId: req.user && req.user._id ? req.user._id : undefined,
    status,
    appointmentId,
    date,
    businessId, // Add businessId parameter
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    newOnly: String(newOnly) === "true",
  };

  const pagination = await appointmentService.getAppointments(filter);

  res.status(200).json(pagination);
});

// Get a single appointment by ID
const getAppointment = catchAsync(async (req, res) => {
  // Ensure referral contact is fetched/saved when entering an appointment
  await appointmentService.ensureReferralContactForAppointment(req.params.id, req.user._id);

  const appointment = await appointmentService.getAppointmentById(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment);
});

// Update appointment fields
const updateAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.updateAppointment(req.params.id, req.body);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment);
});

// Delete an appointment
const deleteAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.deleteAppointment(req.params.id);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(204).end();
});

// Update only status
const updateStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  const appointment = await appointmentService.updateAppointmentStatus(req.params.id, status);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json({ status: appointment.status });
});

// Add a treatment note prompt
const addTreatmentPrompt = catchAsync(async (req, res) => {
  const { content } = req.body;
  const appointment = await appointmentService.addTreatmentPrompt(req.params.id, content);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.treatmentNote.additionalPrompts);
});

// Delete a treatment note prompt
const deleteTreatmentPrompt = catchAsync(async (req, res) => {
  const appointment = await appointmentService.deleteTreatmentPrompt(req.params.id, req.params.promptId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.treatmentNote.additionalPrompts);
});

// Add a letter prompt
const addLetterPrompt = catchAsync(async (req, res) => {
  const { content } = req.body;
  const appointment = await appointmentService.addLetterPrompt(req.params.id, content);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.letter.additionalPrompts);
});

// Delete a letter prompt
const deleteLetterPrompt = catchAsync(async (req, res) => {
  const appointment = await appointmentService.deleteLetterPrompt(req.params.id, req.params.promptId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  res.status(200).json(appointment.letter.additionalPrompts);
});

export {
  listAppointments,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  addTreatmentPrompt,
  deleteTreatmentPrompt,
  addLetterPrompt,
  deleteLetterPrompt,
};

