// Email service stub - implement with your email provider (SendGrid, AWS SES, etc.)

export async function sendEmail(to, subject, text) {
  // TODO: Implement email sending
  console.log(`[Email Service] Would send email to ${to}: ${subject}`);
  console.log(`[Email Service] Body: ${text}`);
  return Promise.resolve();
}

export async function sendTemplateEmail(to, subject, template, data) {
  // TODO: Implement template email sending
  console.log(`[Email Service] Would send template email to ${to}: ${subject}`);
  console.log(`[Email Service] Template: ${template}, Data:`, data);
  return Promise.resolve();
}

export async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/verify-email?token=${token}`;
  const text = `Please verify your email by clicking this link: ${verificationUrl}`;
  return sendEmail(email, "Verify your email", text);
}

