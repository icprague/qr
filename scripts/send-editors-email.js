/**
 * send-editors-email.js
 *
 * Lightweight script that sends the Google Doc link to the editors group
 * WITHOUT re-processing the newsletter or updating the doc.
 * Useful for testing the editors email or re-sending after manual edits.
 *
 * If Planning Center credentials are available, the email will include
 * moderator details (name, email, and when they will be notified).
 * If no moderator is scheduled, a prominent warning is shown instead.
 *
 * Environment variables (set as GitHub Secrets):
 *   GMAIL_USER                – Gmail address used to send email
 *   GMAIL_APP_PASSWORD        – Gmail app password
 *   EDITOR_EMAILS             – Comma-separated list of editor email addresses
 *   GOOGLE_DOC_ID             – Google Doc ID (used to construct the URL)
 *   PLANNING_CENTER_APP_ID    – (Optional) Planning Center API application ID
 *   PLANNING_CENTER_SECRET    – (Optional) Planning Center API secret
 */

const nodemailer = require('nodemailer');
const { getModeratorInfo } = require('./planning-center');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'EDITOR_EMAILS',
  'GOOGLE_DOC_ID',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Error: ${key} environment variable is not set.`);
    process.exit(1);
  }
}

const {
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  EDITOR_EMAILS,
  GOOGLE_DOC_ID,
} = process.env;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUpcomingSunday() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday;
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Moderator section HTML builders
// ---------------------------------------------------------------------------

/**
 * Build an HTML block showing moderator details inside the editors email.
 * Uses a table-based layout for maximum email client compatibility.
 */
function buildModeratorInfoHtml(moderatorInfo) {
  if (!moderatorInfo) {
    // Planning Center lookup was not available – omit the section entirely
    return '';
  }

  if (!moderatorInfo.found) {
    // No moderator scheduled – show a prominent warning
    return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="background:#fdf0f3;padding:16px 20px;border-left:4px solid #6b1624;border-radius:8px;font-family:sans-serif;">
          <p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#6b1624;text-transform:uppercase;letter-spacing:0.5px;">Warning: No Moderator Scheduled</p>
          <p style="margin:0;font-size:14px;color:#4a0f1a;line-height:1.5;">No moderator has been scheduled in Planning Center for this Sunday. Please assign a moderator as soon as possible so they can receive the announcements on Saturday morning.</p>
        </td>
      </tr>
    </table>`;
  }

  // Moderator found – build details table
  const nameRow = moderatorInfo.name
    ? `<tr>
        <td style="padding:3px 12px 3px 0;color:#666;font-size:14px;vertical-align:top;">Name:</td>
        <td style="padding:3px 0;font-size:14px;"><strong>${moderatorInfo.name}</strong></td>
      </tr>`
    : '';

  const emailRow = moderatorInfo.email
    ? `<tr>
        <td style="padding:3px 12px 3px 0;color:#666;font-size:14px;vertical-align:top;">Email:</td>
        <td style="padding:3px 0;font-size:14px;"><strong>${moderatorInfo.email}</strong></td>
      </tr>`
    : '';

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="background:#f0f2f8;padding:16px 20px;border-left:4px solid #222a58;border-radius:8px;font-family:sans-serif;">
          <p style="margin:0 0 10px;font-size:15px;font-weight:bold;color:#222a58;">Moderator Details</p>
          <table cellpadding="0" cellspacing="0" border="0" style="color:#333;">
            ${nameRow}
            ${emailRow}
          </table>
          <p style="margin:12px 0 0;font-size:13px;color:#666;line-height:1.4;">The announcements will be emailed to the moderator on <strong>Saturday at 8:00 AM</strong> (Prague time).</p>
        </td>
      </tr>
    </table>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sundayDate = getUpcomingSunday();
  const dateStr = formatDateShort(sundayDate);
  const docUrl = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/edit?usp=sharing`;
  const editors = EDITOR_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);

  // Look up moderator info (optional – gracefully degrades if credentials missing)
  let moderatorInfo = null;
  try {
    moderatorInfo = await getModeratorInfo();
  } catch (err) {
    console.log(`Planning Center lookup skipped: ${err.message}`);
  }

  const moderatorHtml = buildModeratorInfoHtml(moderatorInfo);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const html = `
    <p>Hi,</p>
    <p>The Sunday announcements draft for <strong>${dateStr}</strong> has been updated and is ready for review.</p>
    <p><a href="${docUrl}" style="display:inline-block;padding:12px 24px;background:#222a58;color:#f7f9fe;text-decoration:none;border-radius:8px;font-family:sans-serif;">Review Announcements</a></p>
    <p>Please review and make any necessary edits before the document is sent to the moderator.</p>
    ${moderatorHtml}
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Automation</p>
  `;

  const mailOptions = {
    from: `"ICP Sunday Announcements" <${GMAIL_USER}>`,
    to: editors.join(', '),
    subject: `Sunday Announcements Draft Ready for Review – ${dateStr}`,
    html,
  };

  console.log(`Google Doc: ${docUrl}`);
  console.log(`Sending editors email to: ${editors.join(', ')}`);

  const info = await transporter.sendMail(mailOptions);
  console.log(`Email sent successfully. Message ID: ${info.messageId}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
