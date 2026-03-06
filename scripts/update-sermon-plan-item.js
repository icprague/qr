/**
 * update-sermon-plan-item.js
 *
 * Self-contained script that:
 *   1. Fetches the latest Mailchimp newsletter
 *   2. Extracts the sermon title (H2) and scripture (H3) from "This Sunday"
 *   3. Writes "Sermon - Title (Scripture)" into the Planning Center plan item
 *
 * Runs on Friday (alongside the newsletter link update) since it depends on
 * the newsletter being available. Separate from the moderator update which
 * reads from the Planning Center schedule and can run anytime.
 *
 * Environment variables:
 *   MAILCHIMP_API_KEY        – Mailchimp API key (e.g. abc123def456-us7)
 *   PLANNING_CENTER_APP_ID   – Planning Center API application ID
 *   PLANNING_CENTER_SECRET   – Planning Center API secret
 *   GMAIL_USER               – Gmail address used to send failure email
 *   GMAIL_APP_PASSWORD       – Gmail app password
 *   FAIL_EMAIL               – Recipient for failure/reminder notifications
 *   SKIP_DATE_CHECK          – Set to "true" to bypass the same-day check
 */

const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');
const { extractSermonInfo, formatSermonForPlanItem } = require('./parse-sermon-info');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
const PLANNING_CENTER_APP_ID = process.env.PLANNING_CENTER_APP_ID;
const PLANNING_CENTER_SECRET = process.env.PLANNING_CENTER_SECRET;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const FAIL_EMAIL = process.env.FAIL_EMAIL;
const SKIP_DATE_CHECK = process.env.SKIP_DATE_CHECK === 'true';

const MAX_RETRIES = 6;
const RETRY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

if (!MAILCHIMP_API_KEY) { console.error('Error: MAILCHIMP_API_KEY is not set.'); process.exit(1); }
if (!PLANNING_CENTER_APP_ID || !PLANNING_CENTER_SECRET) {
  console.error('Error: PLANNING_CENTER_APP_ID and PLANNING_CENTER_SECRET must be set.');
  process.exit(1);
}

const mc_dc = MAILCHIMP_API_KEY.split('-').pop();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const reqOptions = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      ...options,
    };
    client
      .get(reqOptions, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let next = res.headers.location;
          if (next.startsWith('/')) next = `${u.protocol}//${u.hostname}` + next;
          return resolve(httpGet(next, options, redirects + 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      })
      .on('error', reject);
  });
}

function httpPatch(url, body, authHeader) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        port: Number(u.port) || 443,
        path: u.pathname + u.search,
        method: 'PATCH',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} PATCH ${url}: ${text}`));
          }
          resolve(text);
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

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

function isSentToday(sendTimeStr) {
  const sendDate = new Date(sendTimeStr);
  const now = new Date();
  const pragueOpts = { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' };
  const sendDatePrague = sendDate.toLocaleDateString('en-CA', pragueOpts);
  const nowPrague = now.toLocaleDateString('en-CA', pragueOpts);
  return sendDatePrague === nowPrague;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    <p>The <strong>Update Sermon Plan Item</strong> script ran but no newsletter was sent today.</p>
    <p>The most recent campaign found:</p>
    <ul>
      <li><strong>Subject:</strong> ${campaignSubject}</li>
      <li><strong>Sent:</strong> ${campaignSendTime}</li>
    </ul>
    <p>Please send the newsletter and then run the workflow manually.</p>
    <p style="color:#999;font-size:12px;">Auto-generated by ICP Automation</p>
  `;

  await transporter.sendMail({
    from: `"ICP Automation" <${GMAIL_USER}>`,
    to: FAIL_EMAIL,
    subject: 'Reminder: Newsletter not sent yet – sermon plan item not updated',
    html,
  });

  console.log(`Failure/reminder email sent to ${FAIL_EMAIL}`);
}

// ---------------------------------------------------------------------------
// Step 1: Fetch newsletter and extract sermon info
// ---------------------------------------------------------------------------

/**
 * Try to fetch today's newsletter. Returns the campaign if sent today, null otherwise.
 */
async function tryFetchTodaysCampaign() {
  console.log(`Using Mailchimp data center: ${mc_dc}`);

  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
  if (!data.campaigns || data.campaigns.length === 0) throw new Error('No sent campaigns found.');

  const campaign = data.campaigns[0];
  const sendTime = campaign.send_time || '';
  console.log(`Campaign: "${campaign.settings?.subject_line}" (ID: ${campaign.id})`);
  console.log(`  Sent: ${sendTime}`);

  if (!SKIP_DATE_CHECK && sendTime && !isSentToday(sendTime)) {
    return null;
  }

  return campaign;
}

async function fetchSermonInfoFromNewsletter() {
  console.log('=== STEP 1: FETCH SERMON INFO FROM NEWSLETTER ===\n');

  let campaign = await tryFetchTodaysCampaign();

  // Retry loop: check every 30 minutes, up to 6 times
  if (!campaign && !SKIP_DATE_CHECK) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`\nNewsletter not sent yet. Retry ${attempt}/${MAX_RETRIES} in 30 minutes...`);
      await sleep(RETRY_INTERVAL_MS);
      campaign = await tryFetchTodaysCampaign();
      if (campaign) break;
    }
  }

  if (!campaign) {
    const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
    const latest = data.campaigns?.[0];
    const subject = latest?.settings?.subject_line || '(no subject)';
    const sendTime = latest?.send_time || '';
    console.error(`\nNewsletter was not sent today after ${MAX_RETRIES} retries. Sending failure email.`);
    await sendFailureEmail(subject, sendTime);
    process.exit(1);
  }

  console.log('Fetching campaign HTML...');
  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) throw new Error('Campaign has no HTML content.');
  console.log(`  HTML length: ${content.html.length} bytes\n`);

  const { sermonTitle, scripture } = extractSermonInfo(content.html);
  const formatted = formatSermonForPlanItem(sermonTitle, scripture);

  console.log(`  Sermon Title (H2): ${sermonTitle || '(not found)'}`);
  console.log(`  Scripture (H3):    ${scripture || '(not found)'}`);
  console.log(`  Formatted:         ${formatted || '(nothing to write)'}\n`);

  return { sermonTitle, scripture, formatted };
}

// ---------------------------------------------------------------------------
// Step 2: Write sermon info to Planning Center plan item
// ---------------------------------------------------------------------------

async function writeSermonToPlanningCenter(formatted) {
  console.log('=== STEP 2: UPDATE PLANNING CENTER PLAN ITEM ===\n');

  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];
  const authHeader =
    'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  console.log(`Updating sermon plan item for upcoming Sunday: ${dateStr}`);

  // Get service type
  const serviceTypesRaw = await httpGet(
    'https://api.planningcenteronline.com/services/v2/service_types',
    { headers }
  );
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data?.length) throw new Error('No service types found.');
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`Service type: ${serviceTypes.data[0].attributes.name} (${serviceTypeId})`);

  // Get upcoming plans
  const plansRaw = await httpGet(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=5`,
    { headers }
  );
  const plans = JSON.parse(plansRaw);
  if (!plans.data?.length) throw new Error('No upcoming plans found.');

  let targetPlan = plans.data[0];
  for (const plan of plans.data) {
    const planDate = plan.attributes.sort_date || plan.attributes.dates;
    if (planDate && planDate.startsWith(dateStr)) { targetPlan = plan; break; }
  }
  console.log(`Plan: ${targetPlan.attributes.dates} (ID: ${targetPlan.id})`);

  // Fetch plan items
  const itemsRaw = await httpGet(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
    { headers }
  );
  const items = JSON.parse(itemsRaw);

  // Match items whose title starts with "Sermon" (case-insensitive)
  // Handles: "Sermon", "Sermon - Previous Title (Previous Scripture)"
  const sermonPattern = /^Sermon(\s*-\s*.*)?$/i;
  const newTitle = `Sermon - ${formatted}`;
  let updatedCount = 0;

  for (const item of items.data || []) {
    const title = item.attributes.title || '';
    if (!sermonPattern.test(title.trim())) continue;

    if (title.trim() === newTitle) {
      console.log(`  [${item.id}] "${title}" — already current, skipping`);
      continue;
    }

    console.log(`  [${item.id}] "${title}"`);
    console.log(`       → "${newTitle}"`);

    await httpPatch(
      `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items/${item.id}`,
      { data: { type: 'Item', id: item.id, attributes: { title: newTitle } } },
      authHeader
    );

    console.log(`       ✓ Updated`);
    updatedCount++;
  }

  if (updatedCount === 0) {
    console.log('No sermon items needed updating.');
  } else {
    console.log(`\nUpdated ${updatedCount} sermon plan item(s).`);
  }

  return updatedCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { formatted } = await fetchSermonInfoFromNewsletter();

  if (!formatted) {
    console.log('No sermon info found in newsletter. Nothing to update in Planning Center.');
    return;
  }

  await writeSermonToPlanningCenter(formatted);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
