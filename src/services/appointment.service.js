import { Appointment } from "../models/Appointment.js";
import { Template } from "../models/Template.js";
import { Note } from "../models/Note.js";
// import { TranscriptionGeneration } from "../models/index.js"; // Uncomment when model exists
import clinikoAxios from "../utils/clinikoAxios.js";
import * as clinikoService from "./cliniko.service.js";
import ApiError from "../utils/ApiError.js";
import {
  generateTreatmentNoteHtml,
  generateLetterHtml,
  generateSummaryHtml,
  generateTreatmentNoteHtmlStream,
  generateLetterHtmlStream,
  generateSummaryHtmlStream,
} from "./openai.service.js";
import he from "he";
import axios from "axios";

async function getAppointments({ userId, status, appointmentId, date, businessId, page = 1, limit = 10, newOnly } = {}) {
  // If date is provided and we're not looking for newOnly, fetch from Cliniko
  if (date && !newOnly && userId) {
    try {
      console.log("[appointment] fetching from Cliniko", { userId, date, businessId });
      const clinikoAppointments = await fetchAppointmentsFromCliniko(userId, date, businessId);
      
      // Apply status filter if provided
      let filtered = clinikoAppointments;
      if (status) {
        filtered = clinikoAppointments.filter((apt) => apt.status === status);
      }
      
      // Apply pagination
      const skip = (page - 1) * limit;
      const paginated = filtered.slice(skip, skip + limit);
      
      return {
        data: paginated,
        page,
        limit,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
      };
    } catch (error) {
      console.error("[appointment] error fetching from Cliniko, falling back to MongoDB", error);
      // Fall through to MongoDB query if Cliniko fetch fails
    }
  }

  // Fallback to MongoDB query (existing logic)
  const filter = {};

  // Build user filter
  if (userId) {
    // For New Session rows, restrict strictly to this user
    if (newOnly) {
      filter.user = userId;
    } else {
      filter.$or = [{ user: userId }, { user: { $exists: false } }];
    }
  }

  if (appointmentId) filter.appointmentId = appointmentId;

  if (status) {
    filter.status = status;
  }

  if (newOnly) {
    filter.appointmentId = { $regex: /^new_/ };
  }

  // Filter by exact scheduledDate if date provided
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    // Build date filter
    const dateFilter = {
      $or: [
        { appointmentDate: { $gte: start, $lte: end } },
        { appointmentDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
        { appointmentDate: null, createdAt: { $gte: start, $lte: end } },
      ],
    };

    // If we already have a $or for user filter, combine them with $and
    if (filter.$or && !newOnly) {
      filter.$and = [
        { $or: filter.$or },
        dateFilter,
      ];
      delete filter.$or;
    } else if (newOnly && filter.appointmentId) {
      // Preserve appointmentId regex when newOnly is true
      filter.$and = [
        { appointmentId: filter.appointmentId },
        dateFilter,
      ];
      delete filter.appointmentId;
    } else {
      // Otherwise, merge the date filter
      Object.assign(filter, dateFilter);
    }
  }

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Appointment.find(filter).sort({ appointmentDate: 1, createdAt: 1 }).skip(skip).limit(limit),
    Appointment.countDocuments(filter),
  ]);

  // Enrich with computed startsAt and duration (minutes) for New Session rows
  let enriched = data.map((doc) => doc.toObject());

  try {
    const isNewOnly = !!newOnly;
    if (isNewOnly && enriched.length > 0 && userId) {
      // Uncomment when TranscriptionGeneration model exists
      /*
      const apptIds = enriched.map((d) => d.appointmentId).filter(Boolean);
      const gens = await TranscriptionGeneration.find({ appointmentId: { $in: apptIds }, user: userId })
        .select("appointmentId noteGeneratedAt batchTimes")
        .lean();

      const byAppt = new Map(gens.map((g) => [g.appointmentId, g]));

      enriched = enriched.map((d) => {
        const g = byAppt.get(d.appointmentId);
        const batchStarts = Array.isArray(g?.batchTimes)
          ? g.batchTimes
              .map((b) => (b?.startedAt ? new Date(b.startedAt).getTime() : null))
              .filter((t) => typeof t === "number")
          : [];

        const earliestStartMs = batchStarts.length ? Math.min(...batchStarts) : null;
        const endMs = g?.noteGeneratedAt ? new Date(g.noteGeneratedAt).getTime() : null;

        const startsAt = d?.recordedAt || (earliestStartMs ? new Date(earliestStartMs) : d?.updatedAt || d?.createdAt);
        let duration = 0;

        if (earliestStartMs && endMs && endMs > earliestStartMs) {
          duration = Math.max(0, Math.round((endMs - earliestStartMs) / 60000));
        }

        return {
          ...d,
          startsAt,
          duration,
        };
      });
      */
      // Simplified version without TranscriptionGeneration
      enriched = enriched.map((d) => ({
        ...d,
        startsAt: d?.recordedAt || d?.updatedAt || d?.createdAt,
        duration: 0,
      }));
    } else if (isNewOnly) {
      // At least provide startsAt based on recorded/created timestamps
      enriched = enriched.map((d) => ({
        ...d,
        startsAt: d?.recordedAt || d?.updatedAt || d?.createdAt,
        duration: 0,
      }));
    }
  } catch (e) {
    // Non-fatal enrichment failure: return base data
    enriched = data.map((doc) => ({
      ...doc.toObject(),
      startsAt: doc?.recordedAt || doc?.updatedAt || doc?.createdAt,
      duration: 0,
    }));
  }

  const totalPages = Math.ceil(total / limit);
  return { data: enriched, total, page, totalPages, limit };
}

async function getAppointmentById(id) {
  const appointment = await Appointment.findOne({ appointmentId: id }).populate({
    path: "notes.templateId",
    select: "name type",
  });
  if (!appointment) return null;

  // Convert to plain object to add extra fields
  const appointmentObj = appointment.toObject ? appointment.toObject() : { ...appointment };

  // Fetch appointment type details from Cliniko if we have the appointment
  try {
    const userDetails = await clinikoService.getPractitionerDetails(appointment.user?.toString());
    if (userDetails && userDetails.basicAuth && userDetails.apiRegion) {
      // Fetch appointment details from Cliniko to get appointment type
      const apptUrl = `https://api.${userDetails.apiRegion}.cliniko.com/v1/appointments/${id}`;
      const apptResponse = await clinikoAxios(apptUrl, {
        method: "GET",
        headers: {
          Authorization: userDetails.basicAuth,
          Accept: "application/json",
          "User-Agent": "MediScribeAI Backend",
        },
      });

      const apptData = apptResponse?.data || {};
      
      // Extract appointment type ID and fetch type details
      if (apptData.appointment_type?.links?.self) {
        const typeUrl = apptData.appointment_type.links.self;
        const typeResponse = await clinikoAxios(typeUrl, {
          method: "GET",
          headers: {
            Authorization: userDetails.basicAuth,
            Accept: "application/json",
            "User-Agent": "MediScribeAI Backend",
          },
        });

        const typeData = typeResponse?.data || {};
        // Add appointment type name to the appointment object
        appointmentObj.appointmentTypeName = typeData.name || "";
        appointmentObj.appointmentTypeDuration = typeData.duration_in_minutes || 0;
      }
    }
  } catch (error) {
    console.error("[appointment] error fetching appointment type details:", error.message);
    // Don't fail if we can't fetch type details
  }

  return appointmentObj;
}

/**
 * Ensure the appointment document has referralContact populated.
 * If missing, fetch from Cliniko using the user's API credentials and persist.
 * Returns the updated appointment document (or the existing one if already populated).
 */
async function ensureReferralContactForAppointment(appointmentId, userId) {
  let appt = await Appointment.findOne({ appointmentId });

  if (!appt) return null;
  if (appt.referralContact && appt.referralContact.fullName) return appt;

  // Resolve Cliniko credentials and region
  const userDetails = await clinikoService.getPractitionerDetails(userId);
  if (!userDetails || !userDetails.basicAuth || !userDetails.apiRegion) return appt;

  // Map region to correct Cliniko API subdomain (au -> au1, us -> us1, etc.)
  const regionMap = {
    au: "au1",
    us: "us1",
    uk: "uk1",
    ca: "ca1",
    nz: "nz1",
  };
  const apiSubdomain = regionMap[userDetails.apiRegion] || userDetails.apiRegion; // Use mapping or fallback to stored value

  // Determine patient id: prefer stored patientInfo.id, otherwise fetch appointment from Cliniko
  let patientId = appt?.patientInfo?.id;
  try {
    if (!patientId) {
      const apptRes = await clinikoAxios(
        `https://api.${apiSubdomain}.cliniko.com/v1/appointments/${appointmentId}`,
        {
          method: "GET",
          headers: {
            "User-Agent": "MediScribeAI Backend",
            Accept: "application/json",
            Authorization: userDetails.basicAuth,
          },
        }
      );

      const apptData = apptRes?.data || {};
      const patientLink = apptData?.patient?.links?.self || apptData?.links?.patient?.self;
      if (patientLink) {
        const last = String(patientLink).lastIndexOf("/");
        patientId = String(patientLink).substring(last + 1);
      }
    }
  } catch (_) {}

  if (!patientId) return appt; // cannot proceed without patient id

  // Fetch patient to discover referring doctor contact
  try {
    const patientRes = await clinikoAxios(
      `https://api.${apiSubdomain}.cliniko.com/v1/patients/${patientId}`,
      {
        method: "GET",
        headers: {
          "User-Agent": "MediScribeAI Backend",
          Accept: "application/json",
          Authorization: userDetails.basicAuth,
        },
      }
    );

    const p = patientRes?.data || {};

    // Prefer explicit patient.referring_doctor contact; fallback to referral_source
    let contactUrl = p?.referring_doctor?.links?.self;
    if (!contactUrl) {
      try {
        let referralSourceUrl = `https://api.${apiSubdomain}.cliniko.com/v1/patients/${patientId}/referral_source`;
        if (p?.links?.referral_source?.self) referralSourceUrl = p.links.referral_source.self;

        const rsRes = await clinikoAxios(referralSourceUrl, {
          method: "GET",
          headers: {
            "User-Agent": "MediScribeAI Backend",
            Accept: "application/json",
            Authorization: userDetails.basicAuth,
          },
        });

        const rs = rsRes?.data || {};
        contactUrl =
          rs?.referrer?.links?.self || rs?.contact?.links?.self || rs?.links?.referrer?.self || null;
      } catch (_) {}
    }

    if (!contactUrl) return appt;

    const contactRes = await clinikoAxios(contactUrl, {
      method: "GET",
      headers: {
        "User-Agent": "MediScribeAI Backend",
        Accept: "application/json",
        Authorization: userDetails.basicAuth,
      },
    });

    const c = contactRes?.data || {};
    const firstName = c.first_name || c.given_name || "";
    const lastName = c.last_name || c.family_name || "";
    const fullName = c.label || c.name || (firstName || lastName ? `${firstName} ${lastName}`.trim() : "");
    const email = c.email || c.email_address || "";
    const phoneNumbers = Array.isArray(c.phone_numbers) ? c.phone_numbers : c.patient_phone_numbers || [];
    const getByType = (type) =>
      (phoneNumbers.find((p) => (p.phone_type || "").toLowerCase() === type) || {}).number || "";
    const mobile = getByType("mobile") || c.mobile_phone_number || "";
    const home = getByType("home") || c.home_phone_number || "";
    const work = getByType("work") || c.work_phone_number || "";
    const companyName = c.company_name || c.organisation_name || c.organization_name || "";
    const title = c.title || c.job_title || "";
    const city = c.city || "";
    const state = c.state || "";
    const postalCode = c.post_code || c.postal_code || "";
    const country = c.country || "";

    const referralContact = {
      id: c.id ? String(c.id) : "",
      firstName,
      lastName,
      fullName,
      email,
      mobilePhone: mobile,
      homePhone: home,
      workPhone: work,
      companyName,
      title,
      address: {
        line1: c.address_1 || c.address?.line_1 || "",
        line2: c.address_2 || c.address?.line_2 || "",
        city,
        state,
        postalCode,
        country,
      },
    };

    appt = await Appointment.findOneAndUpdate({ appointmentId }, { $set: { referralContact } }, { new: true });
    return appt;
  } catch (_) {
    return appt;
  }
}

async function deleteAppointment(id) {
  return Appointment.findOneAndDelete({ appointmentId: id });
}

/**
 * Update appointment fields by appointmentId
 */
async function updateAppointment(id, updates) {
  return Appointment.findOneAndUpdate({ appointmentId: id }, { $set: updates }, { new: true });
}

/**
 * Update only the status of an appointment
 */
async function updateAppointmentStatus(id, status) {
  return Appointment.findOneAndUpdate({ appointmentId: id }, { status }, { new: true });
}

/**
 * Generate a treatment note HTML for an appointment using a stored template and transcript.
 */
async function generateTreatmentNoteForAppointment({ appointmentId, userId, templateId, noteId, forceType }) {
  if (!templateId && !noteId) {
    throw new ApiError(400, "templateId or noteId is required");
  }

  const appointment = await Appointment.findOne({
    appointmentId,
    user: userId,
  })
    .select(
      "transcriptions treatmentNote patientInfo referralContact appointmentDate status notes"
    )
    .lean();

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  const targetTemplateId =
    templateId ||
    appointment.notes?.find((n) => n._id?.toString() === noteId)?.templateId?.toString();

  if (!targetTemplateId) {
    throw new ApiError(400, "templateId is required");
  }

  const template = await Template.findOne({
    _id: targetTemplateId,
    user: userId,
  })
    .select("name type content")
    .lean();

  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  const transcriptText = (appointment.transcriptions || [])
    .map((t) => {
      const ts = t.timestamp ? new Date(t.timestamp).toISOString() : "";
      return ts ? `[${ts}] ${t.text || ""}` : t.text || "";
    })
    .filter(Boolean)
    .join("\n");

  const additionalPrompts = (appointment.treatmentNote?.additionalPrompts || [])
    .map((p) => p?.content)
    .filter(Boolean);

  const context = {
    appointmentId,
    status: appointment.status,
    appointmentDate: appointment.appointmentDate,
    patient: appointment.patientInfo || null,
    referralContact: appointment.referralContact || null,
    templateMeta: {
      id: templateId,
      name: template.name,
      type: template.type,
    },
  };

  const typeLower = forceType || (template.type || "").toLowerCase();
  let generator = generateTreatmentNoteHtml;
  if (typeLower === "letter") {
    generator = generateLetterHtml;
  } else if (typeLower === "patient summary" || typeLower === "summary") {
    generator = generateSummaryHtml;
  }

  const noteHtml = await generator({
    templateHtml: template.content || "",
    transcriptText,
    context,
    additionalPrompts,
  });

  let note;
  if (noteId) {
    // Update existing note text
    const updated = await Appointment.findOneAndUpdate(
      { appointmentId, user: userId, "notes._id": noteId },
      { $set: { "notes.$.text": noteHtml, "notes.$.templateId": template._id } },
      { new: true, projection: { notes: 1 } }
    )
      .populate({ path: "notes.templateId", select: "name type" })
      .lean();
    note = updated?.notes?.find((n) => n._id?.toString() === noteId?.toString());
  } else {
    // Create new note
    const newNote = new Note({
      templateId: template._id,
      text: noteHtml,
    });

    const update = {
      $push: { notes: newNote },
    };
    if (!appointment.status || appointment.status === "not_recorded") {
      update.$set = { status: "recorded" };
    }

    const updated = await Appointment.findOneAndUpdate(
      { appointmentId, user: userId },
      update,
      { new: true, projection: { notes: 1, status: 1 } }
    )
      .populate({ path: "notes.templateId", select: "name type" })
      .lean();

    if (updated?.notes?.length) {
      // The new note will be the last item in the array
      note = updated.notes[updated.notes.length - 1];
    }
  }

  if (!note) {
    throw new ApiError(500, "Failed to save note");
  }

  return {
    _id: note._id,
    templateId: note.templateId?._id || note.templateId,
    templateType: note.templateId?.type || template.type,
    templateName: note.templateId?.name || template.name,
    text: note.text,
    created: note.created,
  };
}

/**
 * Generate a treatment note HTML for an appointment using streaming.
 * Calls onChunk(delta) for each content delta, then saves and returns the note.
 */
async function generateTreatmentNoteForAppointmentStream({ appointmentId, userId, templateId, noteId, forceType, onChunk }) {
  if (!templateId && !noteId) {
    throw new ApiError(400, "templateId or noteId is required");
  }

  const appointment = await Appointment.findOne({
    appointmentId,
    user: userId,
  })
    .select(
      "transcriptions treatmentNote patientInfo referralContact appointmentDate status notes"
    )
    .lean();

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  const targetTemplateId =
    templateId ||
    appointment.notes?.find((n) => n._id?.toString() === noteId)?.templateId?.toString();

  if (!targetTemplateId) {
    throw new ApiError(400, "templateId is required");
  }

  const template = await Template.findOne({
    _id: targetTemplateId,
    user: userId,
  })
    .select("name type content")
    .lean();

  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  const transcriptText = (appointment.transcriptions || [])
    .map((t) => {
      const ts = t.timestamp ? new Date(t.timestamp).toISOString() : "";
      return ts ? `[${ts}] ${t.text || ""}` : t.text || "";
    })
    .filter(Boolean)
    .join("\n");

  const additionalPrompts = (appointment.treatmentNote?.additionalPrompts || [])
    .map((p) => p?.content)
    .filter(Boolean);

  const context = {
    appointmentId,
    status: appointment.status,
    appointmentDate: appointment.appointmentDate,
    patient: appointment.patientInfo || null,
    referralContact: appointment.referralContact || null,
    templateMeta: {
      id: templateId,
      name: template.name,
      type: template.type,
    },
  };

  const typeLower = forceType || (template.type || "").toLowerCase();
  let generator;
  if (typeLower === "letter") {
    generator = generateLetterHtmlStream;
  } else if (typeLower === "patient summary" || typeLower === "summary") {
    generator = generateSummaryHtmlStream;
  } else {
    generator = generateTreatmentNoteHtmlStream;
  }

  const noteHtml = await generator({
    templateHtml: template.content || "",
    transcriptText,
    context,
    additionalPrompts,
    onChunk,
  });

  let note;
  if (noteId) {
    const updated = await Appointment.findOneAndUpdate(
      { appointmentId, user: userId, "notes._id": noteId },
      { $set: { "notes.$.text": noteHtml, "notes.$.templateId": template._id } },
      { new: true, projection: { notes: 1 } }
    )
      .populate({ path: "notes.templateId", select: "name type" })
      .lean();
    note = updated?.notes?.find((n) => n._id?.toString() === noteId?.toString());
  } else {
    const newNote = new Note({
      templateId: template._id,
      text: noteHtml,
    });

    const update = { $push: { notes: newNote } };
    if (!appointment.status || appointment.status === "not_recorded") {
      update.$set = { status: "recorded" };
    }

    const updated = await Appointment.findOneAndUpdate(
      { appointmentId, user: userId },
      update,
      { new: true, projection: { notes: 1, status: 1 } }
    )
      .populate({ path: "notes.templateId", select: "name type" })
      .lean();

    if (updated?.notes?.length) {
      note = updated.notes[updated.notes.length - 1];
    }
  }

  if (!note) {
    throw new ApiError(500, "Failed to save note");
  }

  return {
    _id: note._id,
    templateId: note.templateId?._id || note.templateId,
    templateType: note.templateId?.type || template.type,
    templateName: note.templateId?.name || template.name,
    text: note.text,
    created: note.created,
  };
}

/**
 * Add a prompt to treatmentNote.additionalPrompts
 */
async function addTreatmentPrompt(id, content) {
  const appt = await Appointment.findOneAndUpdate(
    { appointmentId: id },
    { $push: { "treatmentNote.additionalPrompts": { content } } },
    { new: true }
  );
  return appt;
}

/**
 * Remove a prompt from treatmentNote.additionalPrompts by promptId
 */
async function deleteTreatmentPrompt(id, promptId) {
  const appt = await Appointment.findOneAndUpdate(
    { appointmentId: id },
    { $pull: { "treatmentNote.additionalPrompts": { _id: promptId } } },
    { new: true }
  );
  return appt;
}

/**
 * Add a prompt to letter.additionalPrompts
 */
async function addLetterPrompt(id, content) {
  const appt = await Appointment.findOneAndUpdate(
    { appointmentId: id },
    { $push: { "letter.additionalPrompts": { content } } },
    { new: true }
  );
  return appt;
}

/**
 * Remove a prompt from letter.additionalPrompts by promptId
 */
async function deleteLetterPrompt(id, promptId) {
  const appt = await Appointment.findOneAndUpdate(
    { appointmentId: id },
    { $pull: { "letter.additionalPrompts": { _id: promptId } } },
    { new: true }
  );
  return appt;
}

/**
 * Fetch appointments from Cliniko API for a specific date and business
 * @param {string} userId - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} businessId - Business ID (optional, will use user's default if not provided)
 * @returns {Promise<Array>} - Array of appointment objects
 */
async function fetchAppointmentsFromCliniko(userId, date, businessId = null) {
  console.log("[appointment] fetchAppointmentsFromCliniko called", {
    userId,
    date,
    businessId,
  });

  // Get user's Cliniko credentials
  const userDetails = await clinikoService.getPractitionerDetails(userId);
  if (!userDetails || !userDetails.basicAuth || !userDetails.apiRegion) {
    throw new ApiError(
      400,
      "Cliniko API credentials not found. Please configure your API key in settings."
    );
  }

  // Use provided businessId or user's default business
  const targetBusinessId = businessId || userDetails.businessId;
  if (!targetBusinessId) {
    throw new ApiError(
      400,
      "Business ID is required. Please select a business in settings."
    );
  }

  // Get practitioner ID from user details
  const practitionerId = userDetails.practitionerId;
  if (!practitionerId) {
    console.log("[appointment] no practitioner ID found, fetching all appointments for business");
  }

  // Build date range for the selected day (start of day to end of day)
  const selectedDate = new Date(date);
  const startDate = new Date(selectedDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(selectedDate);
  endDate.setHours(23, 59, 59, 999);

  // Format dates for Cliniko API (ISO 8601)
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  console.log("[appointment] date range", {
    date,
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // Build query string for Cliniko API
  // URLSearchParams doesn't handle multiple q[] well, so build manually
  const queryParts = [
    "sort=appointment_start",
    "page=1",
    "per_page=100",
    `q[]=starts_at:>=${encodeURIComponent(startDateStr)}`,
    `q[]=starts_at:<${encodeURIComponent(endDateStr)}`,
    `q[]=business_id:=${targetBusinessId}`,
  ];

  // Add practitioner ID filter if available
  if (practitionerId) {
    queryParts.push(`q[]=practitioner_id:=${practitionerId}`);
    console.log("[appointment] filtering by practitioner ID", { practitionerId });
  }

  const queryString = queryParts.join("&");
  const url = `https://api.${userDetails.apiRegion}.cliniko.com/v1/appointments?${queryString}`;

  console.log("[appointment] fetching appointments from Cliniko", {
    url,
    businessId: targetBusinessId,
    practitionerId: practitionerId || "none",
    apiRegion: userDetails.apiRegion,
  });

  try {
    // Fetch appointments
    const apptResponse = await clinikoAxios(url, {
      method: "GET",
      headers: {
        Authorization: userDetails.basicAuth,
        Accept: "application/json",
        "User-Agent": "MediScribeAI Backend",
      },
    });

    if (!apptResponse?.data?.appointments) {
      console.log("[appointment] no appointments found in Cliniko response");
      return [];
    }

    const appointments = apptResponse.data.appointments;
    console.log("[appointment] received appointments from Cliniko", {
      count: appointments.length,
      appointmentIds: appointments.map((a) => a.id),
    });

    // Fetch appointment types to get names and durations
    const typeUrl = `https://api.${userDetails.apiRegion}.cliniko.com/v1/appointment_types?page=1&per_page=100`;
    const typeResponse = await clinikoAxios(typeUrl, {
      method: "GET",
      headers: {
        Authorization: userDetails.basicAuth,
        Accept: "application/json",
        "User-Agent": "MediScribeAI Backend",
      },
    });

    const appointmentTypes = typeResponse?.data?.appointment_types || [];
    const typeMap = {};
    appointmentTypes.forEach((type) => {
      typeMap[type.id] = {
        name: type.name || "",
        duration: type.duration_in_minutes || 0,
      };
    });

    console.log("[appointment] mapped appointment types", {
      typesCount: Object.keys(typeMap).length,
    });

    // Map appointments and fetch patient details, then save to database
    const savedAppointments = await Promise.all(
      appointments
        .filter((appt) => {
          // Filter out appointments without required fields
          return (
            appt?.appointment_type?.links?.self &&
            appt?.patient?.links?.self &&
            appt?.starts_at
          );
        })
        .map(async (appt) => {
          // Extract appointment type ID and patient ID from links
          const apptTypeUrl = appt.appointment_type.links.self;
          const patientUrl = appt.patient.links.self;

          const apptTypeId = apptTypeUrl.substring(apptTypeUrl.lastIndexOf("/") + 1);
          const patientId = patientUrl.substring(patientUrl.lastIndexOf("/") + 1);

          const typeInfo = typeMap[apptTypeId] || { name: "", duration: 0 };

          // Fetch patient details from Cliniko
          let patientInfo = {
            id: patientId,
            name: appt.patient_name || "",
          };

          try {
            const patientUrlFull = `https://api.${userDetails.apiRegion}.cliniko.com/v1/patients/${patientId}`;
            const patientResponse = await clinikoAxios(patientUrlFull, {
              method: "GET",
              headers: {
                Authorization: userDetails.basicAuth,
                Accept: "application/json",
                "User-Agent": "MediScribeAI Backend",
              },
            });

            const patient = patientResponse.data || {};
            const addr = patient.address || {};

            patientInfo = {
              id: String(patient.id || patientId),
              name: patient.first_name || patient.last_name
                ? `${patient.first_name || ""} ${patient.last_name || ""}`.trim()
                : appt.patient_name || "",
              firstName: patient.first_name || "",
              lastName: patient.last_name || "",
              dateOfBirth: patient.date_of_birth || "",
              sex: patient.sex || "",
              email: patient.email || "",
              mobilePhone: patient.mobile_phone_number || "",
              homePhone: patient.home_phone_number || "",
              workPhone: patient.work_phone_number || "",
              address: {
                line1: addr.line_1 || "",
                line2: addr.line_2 || "",
                city: addr.city || "",
                state: addr.state || "",
                postalCode: addr.postcode || addr.postal_code || "",
                country: addr.country || "",
              },
            };
          } catch (error) {
            console.warn(`[appointment] unable to fetch patient ${patientId}:`, error.message);
            // Use basic patient info from appointment
          }

          // Prepare appointment data for database
          const appointmentData = {
            appointmentId: appt.id.toString(),
            user: userId,
            status: "not_recorded", // Default status for new appointments from Cliniko
            appointmentDate: new Date(appt.starts_at),
            patientInfo: patientInfo,
            // Keep existing treatmentNote and letter if appointment already exists
          };

          // Check if appointment already exists to preserve status
          const existingAppointment = await Appointment.findOne({ appointmentId: appt.id.toString() }).lean();
          const statusToSet = existingAppointment?.status || "not_recorded";

          // Save or update appointment in database (upsert)
          const savedAppointment = await Appointment.findOneAndUpdate(
            { appointmentId: appt.id.toString() },
            {
              $set: {
                appointmentId: appt.id.toString(),
                user: userId,
                status: statusToSet,
                appointmentDate: new Date(appt.starts_at),
                patientInfo: patientInfo,
              },
              $setOnInsert: {
                treatmentNote: {
                  additionalPrompts: [],
                },
                letter: {
                  additionalPrompts: [],
                },
              },
            },
            { upsert: true, new: true }
          );

          console.log("[appointment] saved appointment to database", {
            appointmentId: appt.id,
            patientName: patientInfo.name,
            status: savedAppointment.status,
          });

          // Return formatted appointment for response
          return {
            id: appt.id,
            appointmentId: appt.id.toString(),
            patientName: patientInfo.name || appt.patient_name || "",
            patientInfo: patientInfo,
            startsAt: appt.starts_at,
            appointmentDate: appt.starts_at,
            duration: typeInfo.duration,
            appointmentType: typeInfo.name,
            patientId: patientId,
            businessId: appt.business_id?.toString() || targetBusinessId,
            status: savedAppointment.status,
            _id: savedAppointment._id,
          };
        })
    );

    console.log("[appointment] saved appointments to database", {
      count: savedAppointments.length,
      appointments: savedAppointments.map((a) => ({
        id: a.id,
        patientName: a.patientName,
        startsAt: a.startsAt,
        status: a.status,
      })),
    });

    return savedAppointments;
  } catch (error) {
    console.error("[appointment] error fetching appointments from Cliniko", {
      error: error.message,
      stack: error.stack,
    });

    if (error.message?.includes("401")) {
      throw new ApiError(
        401,
        "Cliniko API token is invalid or has expired"
      );
    }

    throw new ApiError(
      400,
      error.message || "Failed to fetch appointments from Cliniko"
    );
  }
}

/**
 * Parse HTML note and upload to Cliniko as treatment note
 * Adapted from the old writeNotes function
 */
async function writeNotesToCliniko({ appointmentId, userId, noteId, noteBody, draft = true }) {
  // Get appointment with patient info
  const appointment = await Appointment.findOne({
    appointmentId,
    user: userId,
  })
    .populate({ path: "notes.templateId", select: "name type" })
    .lean();

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  const patientId = appointment.patientInfo?.id;
  if (!patientId) {
    throw new ApiError(400, "Patient ID not found in appointment");
  }

  // Get user's Cliniko credentials
  const userDetails = await clinikoService.getPractitionerDetails(userId);
  if (!userDetails || !userDetails.basicAuth || !userDetails.apiRegion) {
    throw new ApiError(400, "Cliniko API credentials not found");
  }

  // Get template ID - try from note, then from user settings (if available)
  let clinikoTemplateId = null;
  if (noteId) {
    const note = appointment.notes?.find((n) => n._id?.toString() === noteId?.toString());
    // Note: We don't store clinikoTemplateId in Template model, so we'd need to add it
    // For now, we'll use a default or get it from user settings if available
  }

  // STEP 1 — Decode HTML entities
  let html = he.decode(noteBody || "");

  // STEP 1.5 — Add <br> after each </p> tag before sanitization
  html = html.replace(/<\/p>/gi, "</p><br>");

  // STEP 2 — Normalize strong/em to b/i
  html = html
    .replace(/<strong>/gi, "<b>")
    .replace(/<\/strong>/gi, "</b>")
    .replace(/<em>/gi, "<i>")
    .replace(/<\/em>/gi, "</i>");

  // STEP 3 — Remove ALL tags except <i>, <b>, <br>
  html = html.replace(/<(?!\/?(i|b|br)\b)[^>]*>/gi, "");
  // Remove <p> tags specifically
  html = html.replace(/<\/?p[^>]*>/gi, "");
  html = html.trim();

  // Replace </b><br> with just </b>
  html = html.replace(/<\/b><br>/gi, "</b>");

  // STEP 4 — PARSER
  // <i> = section name
  // <b> = question name
  // text under <b> until next <b> or <i> = answer
  const sectionsArr = [];
  let currentSection = null;
  let currentQuestion = null;

  // Split by tags while keeping tags in the array
  const tokens = html.split(/(?=<i>|<b>)/gi);

  for (let token of tokens) {
    token = token.trim();
    if (!token) continue;

    // NEW SECTION (<i>)
    if (token.startsWith("<i>")) {
      const name = token.match(/^<i>(.*?)<\/i>/i)?.[1]?.trim() || "Section";
      currentSection = {
        name,
        questions: [],
      };
      sectionsArr.push(currentSection);
      currentQuestion = null;
      continue;
    }

    // NEW QUESTION (<b>)
    if (token.startsWith("<b>")) {
      const header = token.match(/^<b>(.*?)<\/b>/i)?.[1]?.trim() || "Question";
      const answerHtml = token.replace(/^<b>[\s\S]*?<\/b>/i, "").trim();

      // If no section yet, create default
      if (!currentSection) {
        currentSection = {
          name: "Clinic Notes",
          questions: [],
        };
        sectionsArr.push(currentSection);
      }

      const q = {
        name: header,
        answer: `<p>${answerHtml}</p>`,
        type: "paragraph",
      };

      currentSection.questions.push(q);
      currentQuestion = q;
      continue;
    }

    // ANSWER CONTINUATION
    if (currentQuestion) {
      currentQuestion.answer = currentQuestion.answer.replace("</p>", "") + "<br>" + token + "</p>";
    }
  }

  // FINAL FALLBACK — NO <i> or <b> at all
  if (sectionsArr.length === 0) {
    sectionsArr.push({
      name: "Clinic Notes",
      questions: [
        {
          name: "Details",
          answer: `<p>${html}</p>`,
          type: "paragraph",
        },
      ],
    });
  }

  const sections = sectionsArr;

  // Replace empty <p></p> tags with <br> in all answers
  sections.forEach((section) => {
    if (section.questions) {
      section.questions.forEach((question) => {
        if (question.answer) {
          question.answer = question.answer.replace(/<p>\s*<\/p>/gi, "<br>");
        }
      });
    }
  });

  // STEP 5 — Send to Cliniko
  try {
    const apiRegion = userDetails.apiRegion;
    const baseUrl = `https://api.${apiRegion}.cliniko.com/v1`;

    // Build request body - only include template_id if it's provided
    const requestBody = {
      booking_id: appointmentId,
      content: { sections },
      draft: draft ?? true,
      patient_id: patientId,
      title: "Treatment Note",
    };
    
    // Only include template_id if we have one (don't send empty string)
    if (clinikoTemplateId) {
      requestBody.treatment_note_template_id = clinikoTemplateId;
    }

    // Use axios directly like the old code, matching the exact format
    const response = await axios.post(
      `${baseUrl}/treatment_notes`,
      requestBody,
      {
        headers: {
          Authorization: userDetails.basicAuth,
          Accept: "application/json",
          "User-Agent": "MediScribeAI Backend",
        },
      }
    );

    const statusStr = draft ? "Draft" : "Final";

    // Update appointment status
    await Appointment.findOneAndUpdate(
      { appointmentId, user: userId },
      { $set: { status: statusStr } },
      { new: true }
    );

    return { message: "Success", data: response.data };
  } catch (error) {
    console.error("Cliniko Error:", error);
    console.log("Error Sections:", JSON.stringify(sections));
    console.log("Request details:", {
      appointmentId,
      patientId,
      hasTemplateId: !!clinikoTemplateId,
      draft,
    });
    
    // Handle axios errors
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const status = error.response.status;
      let message = "Unknown error";
      
      if (status === 403) {
        message = "Forbidden: The API key may not have permission to create treatment notes. Please check that the API key is associated with a practitioner who has permission to create treatment notes in Cliniko.";
      } else if (status === 401) {
        message = "Unauthorized: The API key is invalid or expired.";
      } else if (error.response.data) {
        // Try to extract error message from response
        if (typeof error.response.data === 'string') {
          message = error.response.data;
        } else if (error.response.data.message) {
          message = error.response.data.message;
        } else if (error.response.data.error) {
          message = error.response.data.error;
        }
      } else {
        message = error.message || "Unknown error";
      }
      
      throw new ApiError(status, `Cliniko API error (${status}): ${message}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new ApiError(500, "No response from Cliniko API");
    } else {
      // Something happened in setting up the request
      throw new ApiError(500, error.message || "Failed to upload note to Cliniko");
    }
  }
}

export {
  getAppointments,
  getAppointmentById,
  ensureReferralContactForAppointment,
  updateAppointment,
  deleteAppointment,
  updateAppointmentStatus,
  generateTreatmentNoteForAppointment,
  generateTreatmentNoteForAppointmentStream,
  addTreatmentPrompt,
  deleteTreatmentPrompt,
  addLetterPrompt,
  deleteLetterPrompt,
  fetchAppointmentsFromCliniko,
  writeNotesToCliniko,
};

