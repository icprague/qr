/**
 * send-moderator-email.js
 *
 * Saturday step (Step 2 of 2):
 * 1. Looks up the upcoming Sunday's moderator from Planning Center.
 * 2. Sends an email with the Google Doc link to the moderator.
 *
 * Step 1 (Friday) is handled by send-announcements.js, which updates
 * the Google Doc and emails the editors for review.
 *
 * Environment variables (set as GitHub Secrets):
 *   PLANNING_CENTER_APP_ID  – Planning Center API application ID
 *   PLANNING_CENTER_SECRET  – Planning Center API secret
 *   GMAIL_USER              – Gmail address used to send email
 *   GMAIL_APP_PASSWORD      – Gmail app password
 *   CC_EMAIL                – Email address to CC on the moderator email
 *   GOOGLE_DOC_ID           – Google Doc ID (used to construct the URL)
 */

const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'PLANNING_CENTER_APP_ID',
  'PLANNING_CENTER_SECRET',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'GOOGLE_DOC_ID',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Error: ${key} environment variable is not set.`);
    process.exit(1);
  }
}

const {
  PLANNING_CENTER_APP_ID,
  PLANNING_CENTER_SECRET,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  CC_EMAIL,
  GOOGLE_DOC_ID,
} = process.env;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Get moderator email from Planning Center
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
// Send email with Google Doc link
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
  const docUrl = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/edit?usp=sharing`;

  console.log(`Sending moderator email for ${formatDate(sundayDate)}`);
  console.log(`Google Doc: ${docUrl}\n`);

  // Step 1: Get moderator email
  let moderatorEmail;
  try {
    moderatorEmail = await getModeratorEmail();
  } catch (err) {
    console.error(`Planning Center lookup failed: ${err.message}`);
    moderatorEmail = CC_EMAIL || GMAIL_USER;
  }
  console.log('');

  // Step 2: Send email with link
  await sendEmail(moderatorEmail, docUrl, sundayDate);

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
