/**
 * send-announcements.js
 *
 * Friday step (Step 1 of 2):
 * 1. Checks that the latest Mailchimp campaign was sent today (Prague time).
 *    If not, sends a failure/reminder email to FAIL_EMAIL and exits.
 * 2. Parses the campaign HTML to extract announcement sections.
 * 3. Updates a Google Doc with the formatted announcements.
 * 4. Sends an email to the editors group with the Google Doc link for review.
 *
 * Step 2 (Saturday) is handled by send-moderator-email.js.
 *
 * Environment variables (set as GitHub Secrets):
 *   MAILCHIMP_API_KEY  – Mailchimp API key (e.g. abc123def456-us7)
 *   GMAIL_USER         – Gmail address used to send email
 *   GMAIL_APP_PASSWORD – Gmail app password
 *   GOOGLE_DOC_ID      – Google Doc ID to update
 *   EDITOR_EMAILS      – Comma-separated list of editor email addresses
 *   FAIL_EMAIL         – Recipient for failure/reminder notifications
 *   SKIP_DATE_CHECK    – Set to "true" to bypass the same-day check (for testing)
 *
 * Google auth is handled via Workload Identity Federation (ADC) —
 * the google-github-actions/auth step sets GOOGLE_ACCESS_TOKEN.
 */

const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');
const { updateAnnouncementsDoc } = require('./google-docs');
const { parseNewsletter } = require('./parse-newsletter');

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
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Church Automation</p>
  `;

  await transporter.sendMail({
    from: `"ICP Church Automation" <${GMAIL_USER}>`,
    to: FAIL_EMAIL,
    subject: 'Reminder: Newsletter not sent yet – run announcements workflow manually',
    html,
  });

  console.log(`Failure/reminder email sent to ${FAIL_EMAIL}`);
}

// ---------------------------------------------------------------------------
// Step 3: Send editors email with Google Doc link
// ---------------------------------------------------------------------------

async function sendEditorsEmail(docUrl, sundayDate) {
  const dateStr = formatDateShort(sundayDate);
  const subject = `Sunday Announcements Draft Ready for Review – ${dateStr}`;
  const editors = EDITOR_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const html = `
    <p>Hi,</p>
    <p>The Sunday announcements draft for <strong>${dateStr}</strong> has been updated and is ready for review.</p>
    <p><a href="${docUrl}" style="display:inline-block;padding:12px 24px;background:#222a58;color:#f7f9fe;text-decoration:none;border-radius:8px;font-family:sans-serif;">Review Announcements</a></p>
    <p>Please review and make any necessary edits before the document is sent to the moderator.</p>
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Church Automation</p>
  `;

  const mailOptions = {
    from: `"International Church of Prague" <${GMAIL_USER}>`,
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
  const sections = parseNewsletter(campaignHtml);

  if (sections.length === 0) {
    console.log('Warning: No content sections extracted from newsletter.');
  }

  // Step 3: Update Google Doc
  console.log('=== UPDATING GOOGLE DOC ===');
  const { docUrl } = await updateAnnouncementsDoc(
    process.env.GOOGLE_DOC_ID,
    sections,
    'SUNDAY ANNOUNCEMENTS',
    formatDate(sundayDate)
  );
  console.log('');

  // Step 4: Send email to editors
  await sendEditorsEmail(docUrl, sundayDate);

  console.log('\nDone! Editors have been notified. Moderator email will be sent separately.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
