import { Appointment } from "../models/Appointment.js";
// import { TranscriptionGeneration } from "../models/index.js"; // Uncomment when model exists
import clinikoAxios from "../utils/clinikoAxios.js";
import * as clinikoService from "./cliniko.service.js";
import ApiError from "../utils/ApiError.js";

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
  const appointment = await Appointment.findOne({ appointmentId: id });
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

export {
  getAppointments,
  getAppointmentById,
  ensureReferralContactForAppointment,
  updateAppointment,
  deleteAppointment,
  updateAppointmentStatus,
  addTreatmentPrompt,
  deleteTreatmentPrompt,
  addLetterPrompt,
  deleteLetterPrompt,
  fetchAppointmentsFromCliniko,
};

