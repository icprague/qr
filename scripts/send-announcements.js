/**
 * send-announcements.js
 *
 * 1. Uses Mailchimp API to get the latest sent campaign and its HTML content.
 * 2. Parses the HTML to extract headings and content.
 * 3. Creates a public Google Doc with the announcements.
 * 4. Calls Planning Center API to find the upcoming Sunday moderator's email.
 * 5. Sends an email with the Google Doc link via Gmail SMTP.
 *
 * Environment variables (set as GitHub Secrets):
 *   MAILCHIMP_API_KEY            – Mailchimp API key (e.g. abc123def456-us7)
 *   PLANNING_CENTER_APP_ID       – Planning Center API application ID
 *   PLANNING_CENTER_SECRET       – Planning Center API secret
 *   GMAIL_USER                   – Gmail address used to send email
 *   GMAIL_APP_PASSWORD           – Gmail app password
 *   CC_EMAIL                     – Email address to CC on announcements
 *   GOOGLE_DOC_ID                – (optional) Reuse this doc instead of creating a new one
 *
 * Google auth is handled via Workload Identity Federation (ADC) —
 * the google-github-actions/auth step sets GOOGLE_APPLICATION_CREDENTIALS.
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
  'PLANNING_CENTER_APP_ID',
  'PLANNING_CENTER_SECRET',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Error: ${key} environment variable is not set.`);
    process.exit(1);
  }
}

const {
  MAILCHIMP_API_KEY,
  PLANNING_CENTER_APP_ID,
  PLANNING_CENTER_SECRET,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  CC_EMAIL,
} = process.env;

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

function fetch(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const reqOptions = { ...parseUrl(url), ...options };
    client
      .get(reqOptions, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let next = res.headers.location;
          if (next.startsWith('/')) next = `${reqOptions.protocol}//${reqOptions.hostname}` + next;
          return resolve(fetch(next, options, redirects + 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      })
      .on('error', reject);
  });
}

function parseUrl(url) {
  const u = new URL(url);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search };
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

// ---------------------------------------------------------------------------
// Step 1: Fetch latest campaign HTML
// ---------------------------------------------------------------------------

async function fetchLatestCampaignHtml() {
  console.log('Fetching most recent sent campaign from Mailchimp API...');
  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
  if (!data.campaigns || data.campaigns.length === 0) throw new Error('No sent campaigns found.');

  const campaign = data.campaigns[0];
  console.log(`Latest campaign: "${campaign.settings?.subject_line}" (ID: ${campaign.id})`);

  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) throw new Error('Campaign has no HTML content.');
  console.log(`Fetched ${content.html.length} bytes of campaign HTML.\n`);
  return content.html;
}

// ---------------------------------------------------------------------------
// Step 3: Get moderator email from Planning Center
// ---------------------------------------------------------------------------

async function getModeratorEmail() {
  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];
  const authHeader = 'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  console.log(`Looking up Planning Center service plans around ${dateStr}...`);

  const serviceTypesRaw = await fetch('https://api.planningcenteronline.com/services/v2/service_types', { headers });
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data || serviceTypes.data.length === 0) throw new Error('No service types found.');
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`Using service type: ${serviceTypes.data[0].attributes.name} (${serviceTypeId})`);

  const plansRaw = await fetch(`https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=5`, { headers });
  const plans = JSON.parse(plansRaw);
  if (!plans.data || plans.data.length === 0) throw new Error('No upcoming plans found.');

  let targetPlan = plans.data[0];
  for (const plan of plans.data) {
    const planDate = plan.attributes.sort_date || plan.attributes.dates;
    if (planDate && planDate.startsWith(dateStr)) { targetPlan = plan; break; }
  }
  console.log(`Using plan: ${targetPlan.attributes.dates} (ID: ${targetPlan.id})`);

  const teamMembersRaw = await fetch(`https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members`, { headers });
  const teamMembers = JSON.parse(teamMembersRaw);
  if (!teamMembers.data || teamMembers.data.length === 0) throw new Error('No team members found.');

  const moderatorKeywords = ['moderator', 'mc', 'host', 'emcee', 'worship leader'];
  let moderator = null;
  for (const member of teamMembers.data) {
    const position = (member.attributes.team_position_name || '').toLowerCase();
    if (moderatorKeywords.some((kw) => position.includes(kw))) { moderator = member; break; }
  }

  if (!moderator) {
    console.log('No moderator role found. Available positions:');
    teamMembers.data.forEach((m) => console.log(`  - ${m.attributes.name}: ${m.attributes.team_position_name}`));
    console.log('Falling back to CC_EMAIL as recipient.');
    return CC_EMAIL || GMAIL_USER;
  }

  const personId = moderator.relationships?.person?.data?.id;
  if (!personId) { console.log('No person ID for moderator. Falling back to CC_EMAIL.'); return CC_EMAIL || GMAIL_USER; }

  // Try services people endpoint
  try {
    const personRaw = await fetch(`https://api.planningcenteronline.com/services/v2/people/${personId}/emails`, { headers });
    const emails = JSON.parse(personRaw);
    if (emails.data?.length > 0) { const e = emails.data[0].attributes.address; console.log(`Found moderator: ${moderator.attributes.name} (${e})`); return e; }
  } catch {}

  // Try people endpoint
  try {
    const peopleEmailRaw = await fetch(`https://api.planningcenteronline.com/people/v2/people/${personId}/emails`, { headers });
    const peopleEmails = JSON.parse(peopleEmailRaw);
    if (peopleEmails.data?.length > 0) { const e = peopleEmails.data[0].attributes.address; console.log(`Found moderator: ${moderator.attributes.name} (${e})`); return e; }
  } catch (err) { console.log(`People API lookup failed: ${err.message}`); }

  console.log('Could not find email for moderator. Falling back to CC_EMAIL.');
  return CC_EMAIL || GMAIL_USER;
}

// ---------------------------------------------------------------------------
// Step 4: Send email with Google Doc link
// ---------------------------------------------------------------------------

async function sendEmail(recipientEmail, docUrl, sundayDate) {
  const dateStr = formatDateShort(sundayDate);
  const subject = `Sunday Announcements Ready – ${dateStr}`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const html = `
    <p>Hi,</p>
    <p>The Sunday announcements for <strong>${dateStr}</strong> are ready.</p>
    <p><a href="${docUrl}" style="display:inline-block;padding:12px 24px;background:#222a58;color:#f7f9fe;text-decoration:none;border-radius:8px;font-family:sans-serif;">View Announcements</a></p>
    <p>This document is viewable by anyone with the link.</p>
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Church Automation</p>
  `;

  const mailOptions = {
    from: `"International Church of Prague" <${GMAIL_USER}>`,
    to: recipientEmail,
    cc: CC_EMAIL || undefined,
    subject,
    html,
  };

  console.log(`Sending email to: ${recipientEmail}`);
  if (CC_EMAIL) console.log(`CC: ${CC_EMAIL}`);

  const info = await transporter.sendMail(mailOptions);
  console.log(`Email sent successfully. Message ID: ${info.messageId}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sundayDate = getUpcomingSunday();
  console.log(`Preparing announcements for ${formatDate(sundayDate)}\n`);

  // Step 1 & 2: Fetch and parse newsletter
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

  // Step 4: Get moderator email
  let moderatorEmail;
  try {
    moderatorEmail = await getModeratorEmail();
  } catch (err) {
    console.error(`Planning Center lookup failed: ${err.message}`);
    moderatorEmail = CC_EMAIL || GMAIL_USER;
  }
  console.log('');

  // Step 5: Send email with link
  await sendEmail(moderatorEmail, docUrl, sundayDate);

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
