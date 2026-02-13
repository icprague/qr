/**
 * send-announcements.js
 *
 * Friday step (Step 1 of 2):
 * 1. Checks that the latest Mailchimp campaign was sent today (Prague time).
 *    If not, sends a failure/reminder email to FAIL_EMAIL and exits.
 * 2. Parses the campaign HTML to extract announcement sections.
 * 3. Separates missionary prayer sections from weekly announcements.
 * 4. Fetches regular reminders from a Google Spreadsheet (4-week rotation).
 * 5. Updates a Google Doc with the structured announcements:
 *    - Title + date
 *    - Missionary Prayers (special formatting)
 *    - Permanent Announcements (from config.js)
 *    - Weekly Announcements (newsletter minus prayers)
 *    - Regular Reminders (from spreadsheet)
 * 6. Sends an email to the editors group with the Google Doc link for review.
 *
 * Step 2 (Saturday) is handled by send-moderator-email.js.
 *
 * Environment variables (set as GitHub Secrets):
 *   MAILCHIMP_API_KEY        – Mailchimp API key (e.g. abc123def456-us7)
 *   GMAIL_USER               – Gmail address used to send email
 *   GMAIL_APP_PASSWORD       – Gmail app password
 *   GOOGLE_DOC_ID            – Google Doc ID to update
 *   EDITOR_EMAILS            – Comma-separated list of editor email addresses
 *   FAIL_EMAIL               – Recipient for failure/reminder notifications
 *   GOOGLE_SPREADSHEET_ID    – (Optional) Google Spreadsheet ID for regular reminders
 *   SKIP_DATE_CHECK          – Set to "true" to bypass the same-day check (for testing)
 *   PLANNING_CENTER_APP_ID   – (Optional) Planning Center API application ID
 *   PLANNING_CENTER_SECRET   – (Optional) Planning Center API secret
 *
 * Google auth is handled via Workload Identity Federation (ADC) —
 * the google-github-actions/auth step sets GOOGLE_ACCESS_TOKEN.
 */

const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');
const { updateAnnouncementsDoc } = require('./google-docs');
const { parseNewsletter, separatePrayerSections } = require('./parse-newsletter');
const { getModeratorInfo } = require('./planning-center');
const { fetchRegularReminders } = require('./google-sheets');
const {
  MISSIONARY_PRAYER_HEADING_PATTERNS,
  PERMANENT_ANNOUNCEMENTS,
  REMINDERS_SHEET_NAME,
  getSpreadsheetId,
  getCurrentCycleWeek,
} = require('./config');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'MAILCHIMP_API_KEY',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'EDITOR_EMAILS',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Error: ${key} environment variable is not set.`);
    process.exit(1);
  }
}

const {
  MAILCHIMP_API_KEY,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  EDITOR_EMAILS,
  FAIL_EMAIL,
} = process.env;

const SKIP_DATE_CHECK = process.env.SKIP_DATE_CHECK === 'true';
const mc_dc = MAILCHIMP_API_KEY.split('-').pop();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mailchimpGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${mc_dc}.api.mailchimp.com`,
      path: `/3.0${endpoint}`,
      headers: { Authorization: `Bearer ${MAILCHIMP_API_KEY}` },
    };
    https
      .get(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) return reject(new Error(`Mailchimp API ${res.statusCode}: ${body}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
        });
      })
      .on('error', reject);
  });
}

function getUpcomingSunday() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Check whether a date string falls on "today" in the Europe/Prague timezone.
 */
function isSentToday(sendTimeStr) {
  const sendDate = new Date(sendTimeStr);
  const now = new Date();
  const pragueOpts = { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' };
  const sendDatePrague = sendDate.toLocaleDateString('en-CA', pragueOpts);
  const nowPrague = now.toLocaleDateString('en-CA', pragueOpts);
  return sendDatePrague === nowPrague;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch latest campaign HTML + same-day check
// ---------------------------------------------------------------------------

async function fetchLatestCampaignHtml() {
  console.log('Fetching most recent sent campaign from Mailchimp API...');
  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
  if (!data.campaigns || data.campaigns.length === 0) throw new Error('No sent campaigns found.');

  const campaign = data.campaigns[0];
  const sendTime = campaign.send_time || '';
  console.log(`Latest campaign: "${campaign.settings?.subject_line}" (ID: ${campaign.id})`);
  console.log(`  Sent: ${sendTime}`);

  // --- Same-day check ---
  if (!SKIP_DATE_CHECK && sendTime && !isSentToday(sendTime)) {
    console.error('\nThe latest campaign was NOT sent today.');
    await sendFailureEmail(campaign.settings?.subject_line || '(no subject)', sendTime);
    process.exit(1);
  }

  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) throw new Error('Campaign has no HTML content.');
  console.log(`Fetched ${content.html.length} bytes of campaign HTML.\n`);
  return content.html;
}

// ---------------------------------------------------------------------------
// Failure email
// ---------------------------------------------------------------------------

async function sendFailureEmail(campaignSubject, campaignSendTime) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !FAIL_EMAIL) {
    console.error('Cannot send failure email: GMAIL_USER, GMAIL_APP_PASSWORD, or FAIL_EMAIL is not set.');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const html = `
    <p>The <strong>Send Announcements</strong> script ran but no newsletter was sent today.</p>
    <p>The most recent campaign found:</p>
    <ul>
      <li><strong>Subject:</strong> ${campaignSubject}</li>
      <li><strong>Sent:</strong> ${campaignSendTime}</li>
    </ul>
    <p>Please send the newsletter and then run the announcements workflow manually.</p>
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Automation</p>
  `;

  await transporter.sendMail({
    from: `"ICP Automation" <${GMAIL_USER}>`,
    to: FAIL_EMAIL,
    subject: 'Reminder: Newsletter not sent yet – run announcements workflow manually',
    html,
  });

  console.log(`Failure/reminder email sent to ${FAIL_EMAIL}`);
}

// ---------------------------------------------------------------------------
// Moderator section HTML builders
// ---------------------------------------------------------------------------

function buildModeratorInfoHtml(moderatorInfo) {
  if (!moderatorInfo) {
    return '';
  }

  if (!moderatorInfo.found) {
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
// Regular reminders info HTML builder
// ---------------------------------------------------------------------------

function buildRemindersInfoHtml(regularReminders, spreadsheetId) {
  if (!spreadsheetId) return '';

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  const remindersList = regularReminders.length > 0
    ? `<p style="margin:8px 0 0;font-size:14px;color:#333;line-height:1.5;">This week's regular reminders: ${regularReminders.map(r => `<strong>${r.heading}</strong>`).join(', ')}.</p>`
    : `<p style="margin:8px 0 0;font-size:14px;color:#666;font-style:italic;line-height:1.5;">No regular reminders are scheduled for this week.</p>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="background:#D3EFBD;padding:16px 20px;border-left:4px solid #5a9a3a;border-radius:8px;font-family:sans-serif;">
          <p style="margin:0;font-size:15px;font-weight:bold;color:#3a6b24;">Regular Reminders</p>
          ${remindersList}
          <p style="margin:10px 0 0;font-size:13px;color:#666;line-height:1.4;">These are sourced from the <a href="${spreadsheetUrl}" style="color:#222a58;">regular reminders spreadsheet</a>, which rotates announcements on a 4-week cycle.</p>
        </td>
      </tr>
    </table>`;
}

// ---------------------------------------------------------------------------
// Step 5: Send editors email with Google Doc link
// ---------------------------------------------------------------------------

async function sendEditorsEmail(docUrl, sundayDate, regularReminders, spreadsheetId) {
  const dateStr = formatDateShort(sundayDate);
  const subject = `Sunday Announcements Draft Ready for Review – ${dateStr}`;
  const editors = EDITOR_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);

  // Look up moderator info (optional – gracefully degrades if credentials missing)
  let moderatorInfo = null;
  try {
    moderatorInfo = await getModeratorInfo();
  } catch (err) {
    console.log(`Planning Center lookup skipped: ${err.message}`);
  }

  const moderatorHtml = buildModeratorInfoHtml(moderatorInfo);
  const remindersHtml = buildRemindersInfoHtml(regularReminders || [], spreadsheetId || '');

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
    ${remindersHtml}
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Automation</p>
  `;

  const mailOptions = {
    from: `"ICP Sunday Announcements" <${GMAIL_USER}>`,
    to: editors.join(', '),
    subject,
    html,
  };

  console.log(`Sending editors email to: ${editors.join(', ')}`);

  const info = await transporter.sendMail(mailOptions);
  console.log(`Editors email sent successfully. Message ID: ${info.messageId}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sundayDate = getUpcomingSunday();
  console.log(`Preparing announcements for ${formatDate(sundayDate)}\n`);

  // Step 1 & 2: Fetch and parse newsletter (includes same-day check)
  const campaignHtml = await fetchLatestCampaignHtml();
  const allSections = parseNewsletter(campaignHtml);

  if (allSections.length === 0) {
    console.log('Warning: No content sections extracted from newsletter.');
  }

  // Step 3: Separate missionary prayers from weekly announcements
  const { prayerSections, weeklySections } = separatePrayerSections(
    allSections,
    MISSIONARY_PRAYER_HEADING_PATTERNS
  );
  console.log(`  Prayer sections: ${prayerSections.length}`);
  console.log(`  Weekly sections: ${weeklySections.length}\n`);

  // Step 4: Fetch regular reminders from Google Spreadsheet
  console.log('=== FETCHING REGULAR REMINDERS ===');
  const spreadsheetId = getSpreadsheetId();
  const cycleWeek = getCurrentCycleWeek(sundayDate);
  console.log(`  Current 4-week cycle week: ${cycleWeek}`);

  let regularReminders = [];
  try {
    regularReminders = await fetchRegularReminders(spreadsheetId, REMINDERS_SHEET_NAME, cycleWeek);
  } catch (err) {
    console.log(`  Regular reminders fetch failed: ${err.message}`);
    console.log('  Continuing without regular reminders.');
  }
  console.log('');

  // Step 5: Update Google Doc with all sections
  console.log('=== UPDATING GOOGLE DOC ===');
  const { docUrl } = await updateAnnouncementsDoc(
    process.env.GOOGLE_DOC_ID,
    {
      title: 'Sunday Announcements',
      subtitle: formatDate(sundayDate),
      prayerSections,
      permanentAnnouncements: PERMANENT_ANNOUNCEMENTS,
      weeklySections,
      regularReminders,
    }
  );
  console.log('');

  // Step 6: Send email to editors
  await sendEditorsEmail(docUrl, sundayDate, regularReminders, spreadsheetId);

  console.log('\nDone! Editors have been notified. Moderator email will be sent separately.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
