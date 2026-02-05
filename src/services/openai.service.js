import ApiError from "../utils/ApiError.js";
import fetch from "node-fetch";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function computeVisitDateParts(context = {}) {
  const date =
    context.appointmentDate != null
      ? new Date(context.appointmentDate)
      : new Date();
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return { day, month, year };
}

function buildPatientAndReferralContext(context = {}) {
  const patient = context.patient || {};
  const referral = context.referralContact || {};

  const parts = [];

  if (
    patient.name ||
    patient.firstName ||
    patient.lastName ||
    patient.dateOfBirth ||
    patient.sex ||
    patient.email ||
    patient.mobilePhone ||
    patient.homePhone ||
    patient.workPhone
  ) {
    parts.push("PATIENT INFORMATION:");
    if (patient.name || patient.firstName || patient.lastName) {
      const fullName =
        patient.name ||
        [patient.firstName, patient.lastName].filter(Boolean).join(" ");
      parts.push(`- Name: ${fullName}`);
    }
    if (patient.dateOfBirth) parts.push(`- DOB: ${patient.dateOfBirth}`);
    if (patient.sex) parts.push(`- Sex: ${patient.sex}`);
    if (patient.email) parts.push(`- Email: ${patient.email}`);
    if (patient.mobilePhone) parts.push(`- Mobile: ${patient.mobilePhone}`);
    if (patient.homePhone) parts.push(`- Home: ${patient.homePhone}`);
    if (patient.workPhone) parts.push(`- Work: ${patient.workPhone}`);

    const addr = patient.address || {};
    const addrParts = [
      addr.line1,
      addr.line2,
      addr.city,
      addr.state,
      addr.postalCode,
      addr.country,
    ].filter(Boolean);
    if (addrParts.length) {
      parts.push(`- Address: ${addrParts.join(", ")}`);
    }
    parts.push(""); // blank line
  }

  if (
    referral.fullName ||
    referral.companyName ||
    referral.title ||
    referral.email ||
    referral.mobilePhone ||
    referral.homePhone ||
    referral.workPhone
  ) {
    parts.push("REFERRAL CONTACT:");
    if (referral.fullName) parts.push(`- Name: ${referral.fullName}`);
    if (referral.title) parts.push(`- Title: ${referral.title}`);
    if (referral.companyName) parts.push(`- Organisation: ${referral.companyName}`);
    if (referral.email) parts.push(`- Email: ${referral.email}`);
    if (referral.mobilePhone) parts.push(`- Mobile: ${referral.mobilePhone}`);
    if (referral.homePhone) parts.push(`- Home: ${referral.homePhone}`);
    if (referral.workPhone) parts.push(`- Work: ${referral.workPhone}`);

    const addr = referral.address || {};
    const addrParts = [
      addr.line1,
      addr.line2,
      addr.city,
      addr.state,
      addr.postalCode,
      addr.country,
    ].filter(Boolean);
    if (addrParts.length) {
      parts.push(`- Address: ${addrParts.join(", ")}`);
    }
  }

  return parts.length ? parts.join("\n") : "";
}

async function callOpenAI({ system, user }) {
  const apiKey = process.env.OPEN_AI_KEY;
  if (!apiKey) {
    throw new ApiError(500, "OPEN_AI_KEY is not configured on the server");
  }

  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[openai] API error", response.status, errorText);
    throw new ApiError(
      502,
      "Failed to generate note. Please try again or adjust your template."
    );
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new ApiError(502, "OpenAI did not return valid content for the note.");
  }

  return (
    content
      // Best-effort: strip surrounding code fences if any slipped through.
      .replace(/^\s*```(?:html)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim()
  );
}

function stripCodeFences(content) {
  return content
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Call OpenAI with streaming. Yields content deltas via onChunk, returns full content when done.
 */
async function callOpenAIStream({ system, user, onChunk }) {
  const apiKey = process.env.OPEN_AI_KEY;
  if (!apiKey) {
    throw new ApiError(500, "OPEN_AI_KEY is not configured on the server");
  }

  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  // Prefer native fetch (Node 18+) for streaming; returns proper Web ReadableStream
  const fetchFn = typeof globalThis.fetch === "function" ? globalThis.fetch : fetch;
  const response = await fetchFn(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[openai] API error", response.status, errorText);
    throw new ApiError(
      502,
      "Failed to generate note. Please try again or adjust your template."
    );
  }

  const readable = response.body;
  if (!readable) {
    throw new ApiError(502, "OpenAI did not return a readable stream.");
  }

  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  const processChunk = (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const content = json?.choices?.[0]?.delta?.content;
          if (typeof content === "string") {
            fullContent += content;
            onChunk(content);
          }
        } catch {
          // ignore parse errors for non-JSON lines
        }
      }
    }
  };

  if (readable.getReader) {
    // Web ReadableStream (Node 18+ fetch, node-fetch with undici)
    const reader = readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processChunk(value);
    }
  } else if (typeof readable[Symbol.asyncIterator] === "function") {
    // Node.js Readable stream (for-await-of)
    for await (const chunk of readable) {
      processChunk(chunk);
    }
  } else {
    throw new ApiError(502, "OpenAI did not return a readable stream.");
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    const lines = buffer.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const content = json?.choices?.[0]?.delta?.content;
          if (typeof content === "string") {
            fullContent += content;
            onChunk(content);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return stripCodeFences(fullContent);
}

/**
 * Treatment note prompt (SOAP-style, template-driven)
 */
export async function generateTreatmentNoteHtml({
  templateHtml,
  transcriptText,
  context = {},
  additionalPrompts = [],
}) {
  if (!templateHtml || !templateHtml.trim()) {
    throw new ApiError(400, "Template HTML is required to generate a treatment note");
  }
  if (!transcriptText || !transcriptText.trim()) {
    throw new ApiError(400, "No transcript text available for this appointment");
  }

  const safeTranscript = transcriptText.slice(0, 24000);
  const additional =
    additionalPrompts && additionalPrompts.length
      ? additionalPrompts.join("\n- ")
      : "";
  const patientReferralBlock = buildPatientAndReferralContext(context);

  const system = `
You are an AI Medical Scribe. Your primary function is to process a conversation transcript between a clinician and a patient and transform it into a structured, concise, and accurate medical note.

You must adhere strictly to:
- The provided HTML template (TEMPLATE_HTML).
- The core rules and formatting rules below.

CORE RULES (Crucial Constraints):
1. Accuracy: The note must be entirely accurate and based exclusively on information present in the transcript.
2. Precision Over Brevity: Capture specific, quantitative, and nuanced details. Do not generalize or omit important data.
3. Data Extraction & Interpretation: Meticulously extract and structure clinical data. Interpret conversational descriptions of physical tests to identify them by their clinical name and record their specific results.
4. Holistic Context: Identify and document functional goals, psychosocial factors, and personal context.
5. No Fabrication: Do not add, infer, or fabricate any information not explicitly stated in the conversation.
6. No Repetition: Do not repeat the same piece of information in different sections.
7. No Recommendations: Do not make any medical recommendations or suggestions.
8. Use Abbreviations: Use standard medical abbreviations where appropriate (e.g., "c/o", "s/p", "HPI").
9. Transcript Order & Corrections: The transcript is chronological. If later statements correct earlier ones (e.g., "right leg" then "actually left leg"), ALWAYS treat the later statement as the true and final version and override the earlier detail.

TEMPLATE & HTML CONSTRAINTS:
- Follow TEMPLATE_HTML exactly for structure and section ordering.
- Preserve intended <br> tags and layout where present.
- Do NOT add new structural sections that do not exist in TEMPLATE_HTML.
- The final output must be RAW HTML only (no <html> or <body> tags).
- Use <b> tags ONLY for section headers and labels (e.g., "Subjective", "CC:", "HPI:").
- Narrative text must NOT be bold.
- Every narrative line should be inside <p>...</p>.
- Do NOT include any instructional or placeholder text from the template itself.
- Do NOT output code fences or explanations, only the final HTML.
`.trim();

  const user = [
    "TRANSCRIPT:",
    safeTranscript,
    "",
    "TEMPLATE_HTML:",
    templateHtml,
    "",
    additional
      ? "ADDITIONAL INSTRUCTIONS (highest priority, apply when structuring the note):\n- " +
        additional
      : "",
    patientReferralBlock
      ? "\nPATIENT & REFERRAL CONTEXT (use to enrich sections, but do NOT invent data):\n" +
        patientReferralBlock
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return await callOpenAI({ system, user });
}

export async function generateTreatmentNoteHtmlStream({
  templateHtml,
  transcriptText,
  context = {},
  additionalPrompts = [],
  onChunk,
}) {
  if (!templateHtml || !templateHtml.trim()) {
    throw new ApiError(400, "Template HTML is required to generate a treatment note");
  }
  if (!transcriptText || !transcriptText.trim()) {
    throw new ApiError(400, "No transcript text available for this appointment");
  }

  const safeTranscript = transcriptText.slice(0, 24000);
  const additional =
    additionalPrompts && additionalPrompts.length
      ? additionalPrompts.join("\n- ")
      : "";
  const patientReferralBlock = buildPatientAndReferralContext(context);

  const system = `
You are an AI Medical Scribe. Your primary function is to process a conversation transcript between a clinician and a patient and transform it into a structured, concise, and accurate medical note.

You must adhere strictly to:
- The provided HTML template (TEMPLATE_HTML).
- The core rules and formatting rules below.

CORE RULES (Crucial Constraints):
1. Accuracy: The note must be entirely accurate and based exclusively on information present in the transcript.
2. Precision Over Brevity: Capture specific, quantitative, and nuanced details. Do not generalize or omit important data.
3. Data Extraction & Interpretation: Meticulously extract and structure clinical data. Interpret conversational descriptions of physical tests to identify them by their clinical name and record their specific results.
4. Holistic Context: Identify and document functional goals, psychosocial factors, and personal context.
5. No Fabrication: Do not add, infer, or fabricate any information not explicitly stated in the conversation.
6. No Repetition: Do not repeat the same piece of information in different sections.
7. No Recommendations: Do not make any medical recommendations or suggestions.
8. Use Abbreviations: Use standard medical abbreviations where appropriate (e.g., "c/o", "s/p", "HPI").
9. Transcript Order & Corrections: The transcript is chronological. If later statements correct earlier ones (e.g., "right leg" then "actually left leg"), ALWAYS treat the later statement as the true and final version and override the earlier detail.

TEMPLATE & HTML CONSTRAINTS:
- Follow TEMPLATE_HTML exactly for structure and section ordering.
- Preserve intended <br> tags and layout where present.
- Do NOT add new structural sections that do not exist in TEMPLATE_HTML.
- The final output must be RAW HTML only (no <html> or <body> tags).
- Use <b> tags ONLY for section headers and labels (e.g., "Subjective", "CC:", "HPI:").
- Narrative text must NOT be bold.
- Every narrative line should be inside <p>...</p>.
- Do NOT include any instructional or placeholder text from the template itself.
- Do NOT output code fences or explanations, only the final HTML.
`.trim();

  const user = [
    "TRANSCRIPT:",
    safeTranscript,
    "",
    "TEMPLATE_HTML:",
    templateHtml,
    "",
    additional
      ? "ADDITIONAL INSTRUCTIONS (highest priority, apply when structuring the note):\n- " +
        additional
      : "",
    patientReferralBlock
      ? "\nPATIENT & REFERRAL CONTEXT (use to enrich sections, but do NOT invent data):\n" +
        patientReferralBlock
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return await callOpenAIStream({ system, user, onChunk });
}

/**
 * Referral letter prompt
 */
export async function generateLetterHtml({
  templateHtml,
  transcriptText,
  context = {},
  additionalPrompts = [],
}) {
  if (!templateHtml || !templateHtml.trim()) {
    throw new ApiError(400, "Template HTML is required to generate a letter");
  }
  if (!transcriptText || !transcriptText.trim()) {
    throw new ApiError(400, "No transcript text available for this appointment");
  }

  const safeTranscript = transcriptText.slice(0, 24000);
  const { day, month, year } = computeVisitDateParts(context);
  const additional =
    additionalPrompts && additionalPrompts.length
      ? additionalPrompts.join("\n- ")
      : "";
  const patientReferralBlock = buildPatientAndReferralContext(context);

  const system = `
You are an AI assistant that writes professional, medically accurate referral letters strictly from a consultation transcript.

- Use only information present in the transcript (no inference or fabrication).
- The final output must be RAW HTML (no <html> or <body> tags).
- Use <b> for headings, and <br> only where intentional line breaks are needed.
- Do not add bullets or extra headings beyond the provided template.
- Do not output code fences or explanations, only the final HTML.
 - The transcript is chronological: when there is a correction later in the conversation (e.g., side of the body or other details are revised), ALWAYS treat the later statement as authoritative and override earlier conflicting information.
`.trim();

  const userLines = [
    "Create a professional, medically accurate referral letter strictly from the conversation transcript.",
    "",
    "Transcript:",
    safeTranscript,
    "",
    "Template to follow (HTML):",
    templateHtml,
    "",
    "Rules:",
    "- Do not infer or add any information not present in the transcript.",
    "- Follow Additional Instructions as highest priority.",
    "- If there's a translation instruction, translate everything (headings and body).",
    "- Omit any placeholder lines if you have no data for them.",
    "- Use <br> only for intentional breaks; no extra spacing.",
    "- No bullets or extra headings.",
    `- Include Date of visit: ${day}/${month}/${year}`,
    "- Return only the final HTML (no <html> tags).",
  ];

  if (additional) {
    userLines.push("", "Additional Instructions:", additional);
  }

  if (patientReferralBlock) {
    userLines.push(
      "",
      "Patient & Referral Context (from appointment metadata):",
      patientReferralBlock
    );
  }

  const user = userLines.join("\n");

  return await callOpenAI({ system, user });
}

export async function generateLetterHtmlStream({
  templateHtml,
  transcriptText,
  context = {},
  additionalPrompts = [],
  onChunk,
}) {
  if (!templateHtml || !templateHtml.trim()) {
    throw new ApiError(400, "Template HTML is required to generate a letter");
  }
  if (!transcriptText || !transcriptText.trim()) {
    throw new ApiError(400, "No transcript text available for this appointment");
  }

  const safeTranscript = transcriptText.slice(0, 24000);
  const { day, month, year } = computeVisitDateParts(context);
  const additional =
    additionalPrompts && additionalPrompts.length
      ? additionalPrompts.join("\n- ")
      : "";
  const patientReferralBlock = buildPatientAndReferralContext(context);

  const system = `
You are an AI assistant that writes professional, medically accurate referral letters strictly from a consultation transcript.

- Use only information present in the transcript (no inference or fabrication).
- The final output must be RAW HTML (no <html> or <body> tags).
- Use <b> for headings, and <br> only where intentional line breaks are needed.
- Do not add bullets or extra headings beyond the provided template.
- Do not output code fences or explanations, only the final HTML.
 - The transcript is chronological: when there is a correction later in the conversation (e.g., side of the body or other details are revised), ALWAYS treat the later statement as authoritative and override earlier conflicting information.
`.trim();

  const userLines = [
    "Create a professional, medically accurate referral letter strictly from the conversation transcript.",
    "",
    "Transcript:",
    safeTranscript,
    "",
    "Template to follow (HTML):",
    templateHtml,
    "",
    "Rules:",
    "- Do not infer or add any information not present in the transcript.",
    "- Follow Additional Instructions as highest priority.",
    "- If there's a translation instruction, translate everything (headings and body).",
    "- Omit any placeholder lines if you have no data for them.",
    "- Use <br> only for intentional breaks; no extra spacing.",
    "- No bullets or extra headings.",
    `- Include Date of visit: ${day}/${month}/${year}`,
    "- Return only the final HTML (no <html> tags).",
  ];

  if (additional) {
    userLines.push("", "Additional Instructions:", additional);
  }

  if (patientReferralBlock) {
    userLines.push(
      "",
      "Patient & Referral Context (from appointment metadata):",
      patientReferralBlock
    );
  }

  const user = userLines.join("\n");

  return await callOpenAIStream({ system, user, onChunk });
}

/**
 * Patient summary / After-Visit summary prompt
 */
export async function generateSummaryHtml({
  templateHtml,
  transcriptText,
  context = {},
  additionalPrompts = [],
}) {
  if (!transcriptText || !transcriptText.trim()) {
    throw new ApiError(400, "No transcript text available for this appointment");
  }

  const safeTranscript = transcriptText.slice(0, 24000);
  const { day, month, year } = computeVisitDateParts(context);
  const additional =
    additionalPrompts && additionalPrompts.length
      ? additionalPrompts.join("\n- ")
      : "";
  const patientReferralBlock = buildPatientAndReferralContext(context);

  const system = `
You are an AI assistant that writes clear, friendly After-Visit Summaries for patients.

- Use only information present in the transcript (no inference or fabrication).
- The final output must be RAW HTML snippets (no <html> or <body> tags).
- Use <b> for headings and <br> only for intentional breaks.
- Omit any section that has no content in the transcript.
- Do not output code fences or explanations, only the HTML.
 - The transcript is chronological: if the clinician or patient corrects earlier information later in the visit, ALWAYS trust the later correction and ignore the superseded detail.
`.trim();

  const userLines = [
    "You are writing a clear, friendly 'After-Visit Summary' for a patient, based on the following transcript of their appointment:",
    "",
    safeTranscript,
    "",
    templateHtml
      ? "Use this HTML template to guide structure (headings/order):\n" + templateHtml
      : "",
    "",
    "Rules:",
    "- Follow Additional Instructions as highest priority.",
    "- Omit any section with no content in the transcript.",
    "- Use <b> for headings, <br> only for intentional breaks.",
    `- Include Date of visit: ${day}/${month}/${year}`,
    "- Return only HTML snippets (no <html>/<body> tags).",
  ];

  if (additional) {
    userLines.push("", "Additional Instructions:", additional);
  }

  if (patientReferralBlock) {
    userLines.push(
      "",
      "Patient & Referral Context (from appointment metadata):",
      patientReferralBlock
    );
  }

  const user = userLines.filter(Boolean).join("\n");

  return await callOpenAI({ system, user });
}

export async function generateSummaryHtmlStream({
  templateHtml,
  transcriptText,
  context = {},
  additionalPrompts = [],
  onChunk,
}) {
  if (!transcriptText || !transcriptText.trim()) {
    throw new ApiError(400, "No transcript text available for this appointment");
  }

  const safeTranscript = transcriptText.slice(0, 24000);
  const { day, month, year } = computeVisitDateParts(context);
  const additional =
    additionalPrompts && additionalPrompts.length
      ? additionalPrompts.join("\n- ")
      : "";
  const patientReferralBlock = buildPatientAndReferralContext(context);

  const system = `
You are an AI assistant that writes clear, friendly After-Visit Summaries for patients.

- Use only information present in the transcript (no inference or fabrication).
- The final output must be RAW HTML snippets (no <html> or <body> tags).
- Use <b> for headings and <br> only for intentional breaks.
- Omit any section that has no content in the transcript.
- Do not output code fences or explanations, only the HTML.
 - The transcript is chronological: if the clinician or patient corrects earlier information later in the visit, ALWAYS trust the later correction and ignore the superseded detail.
`.trim();

  const userLines = [
    "You are writing a clear, friendly 'After-Visit Summary' for a patient, based on the following transcript of their appointment:",
    "",
    safeTranscript,
    "",
    templateHtml
      ? "Use this HTML template to guide structure (headings/order):\n" + templateHtml
      : "",
    "",
    "Rules:",
    "- Follow Additional Instructions as highest priority.",
    "- Omit any section with no content in the transcript.",
    "- Use <b> for headings, <br> only for intentional breaks.",
    `- Include Date of visit: ${day}/${month}/${year}`,
    "- Return only HTML snippets (no <html>/<body> tags).",
  ];

  if (additional) {
    userLines.push("", "Additional Instructions:", additional);
  }

  if (patientReferralBlock) {
    userLines.push(
      "",
      "Patient & Referral Context (from appointment metadata):",
      patientReferralBlock
    );
  }

  const user = userLines.filter(Boolean).join("\n");

  return await callOpenAIStream({ system, user, onChunk });
}

