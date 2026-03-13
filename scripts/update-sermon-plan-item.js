/**
 * update-sermon-plan-item.js
 *
 * Self-contained script that:
 *   1. Fetches the latest Mailchimp newsletter
 *   2. Extracts the sermon title (H2) and scripture (H3) from "This Sunday"
 *   3. Looks up the preacher from the Planning Center schedule
 *   4. Writes the sermon title + preacher name into the "Sermon title" plan item
 *      e.g. "The Good Samaritan - Pastor Mike Weiglein"
 *   5. Writes the scripture reference into the "Scripture" plan item
 *      e.g. "Luke 10:25-37"
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
const { extractSermonInfo } = require('./parse-sermon-info');

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

/**
 * Check whether this is the last scheduled attempt.
 * The workflow passes ATTEMPT (1-based) and MAX_ATTEMPTS via env vars.
 * Manual triggers (no ATTEMPT set) are treated as the last attempt.
 */
function isLastAttempt() {
  const attempt = Number(process.env.ATTEMPT) || 0;
  const maxAttempts = Number(process.env.MAX_ATTEMPTS) || 0;
  return !attempt || !maxAttempts || attempt >= maxAttempts;
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

async function fetchSermonInfoFromNewsletter() {
  console.log('=== STEP 1: FETCH SERMON INFO FROM NEWSLETTER ===\n');
  console.log(`Using Mailchimp data center: ${mc_dc}`);

  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
  if (!data.campaigns || data.campaigns.length === 0) throw new Error('No sent campaigns found.');

  const campaign = data.campaigns[0];
  const sendTime = campaign.send_time || '';
  const subject = campaign.settings?.subject_line || '(no subject)';
  console.log(`Campaign: "${subject}" (ID: ${campaign.id})`);
  console.log(`  Sent: ${sendTime}`);

  // Same-day check
  if (!SKIP_DATE_CHECK && sendTime && !isSentToday(sendTime)) {
    if (isLastAttempt()) {
      console.error('\nNewsletter was not sent today (final attempt). Sending failure email.');
      await sendFailureEmail(subject, sendTime);
      process.exit(1);
    }
    console.log('\nNewsletter not sent yet. Will retry at next scheduled run.');
    process.exit(0);
  }

  console.log('Fetching campaign HTML...');
  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) throw new Error('Campaign has no HTML content.');
  console.log(`  HTML length: ${content.html.length} bytes\n`);

  const { sermonTitle, scripture } = extractSermonInfo(content.html);

  console.log(`  Sermon Title (H2): ${sermonTitle || '(not found)'}`);
  console.log(`  Scripture (H3):    ${scripture || '(not found)'}\n`);

  return { sermonTitle, scripture };
}

// ---------------------------------------------------------------------------
// Step 2: Write sermon info to Planning Center plan item
// ---------------------------------------------------------------------------

async function writeSermonToPlanningCenter(sermonTitle, scripture) {
  console.log('=== STEP 2: UPDATE PLANNING CENTER PLAN ITEMS ===\n');

  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];
  const authHeader =
    'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  console.log(`Updating plan items for upcoming Sunday: ${dateStr}`);

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

  // Look up preacher from team members
  const teamMembersRaw = await httpGet(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members?per_page=100`,
    { headers }
  );
  const teamMembers = JSON.parse(teamMembersRaw);

  const preacherKeywords = ['sermon', 'message', 'preacher', 'speaker', 'pastor'];
  let preacherName = null;
  let preacherPosition = null;
  for (const member of teamMembers.data || []) {
    const position = (member.attributes.team_position_name || '').toLowerCase();
    if (member.attributes.status === 'D') continue; // skip declined
    if (preacherKeywords.some((kw) => position.includes(kw))) {
      preacherName = member.attributes.name;
      preacherPosition = member.attributes.team_position_name || '';
      break;
    }
  }

  // Format preacher name: only Mike Weiglein gets the "Pastor" prefix
  let formattedPreacher = null;
  if (preacherName) {
    formattedPreacher = /^mike\s+weiglein$/i.test(preacherName)
      ? `Pastor ${preacherName}`
      : preacherName;
    console.log(`Preacher: ${formattedPreacher} (position: ${preacherPosition})`);
  } else {
    console.log('Preacher: not assigned');
  }

  // Fetch plan items
  const itemsRaw = await httpGet(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
    { headers }
  );
  const items = JSON.parse(itemsRaw);

  let updatedCount = 0;
  const allItems = items.data || [];

  // Helper: find the first item (not header/song) after a given header
  function findFirstItemAfterHeader(headerPattern) {
    const header = allItems.find(
      (it) => it.attributes.item_type === 'header' && headerPattern.test((it.attributes.title || '').trim())
    );
    if (!header) return null;
    const headerSeq = header.attributes.sequence;
    return allItems
      .filter((it) => it.attributes.item_type === 'item' && it.attributes.sequence > headerSeq)
      .sort((a, b) => a.attributes.sequence - b.attributes.sequence)[0] || null;
  }

  // --- Update sermon title item (first item under the "Sermon" header) ---
  if (sermonTitle) {
    const sermonItem = findFirstItemAfterHeader(/^sermon$/i);
    if (sermonItem) {
      const newSermonTitle = formattedPreacher
        ? `${sermonTitle} - ${formattedPreacher}`
        : sermonTitle;
      const currentTitle = (sermonItem.attributes.title || '').trim();

      if (currentTitle === newSermonTitle) {
        console.log(`  [${sermonItem.id}] "${currentTitle}" — already current, skipping`);
      } else {
        console.log(`  [${sermonItem.id}] "${currentTitle}"`);
        console.log(`       → "${newSermonTitle}"`);
        await httpPatch(
          `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items/${sermonItem.id}`,
          { data: { type: 'Item', id: sermonItem.id, attributes: { title: newSermonTitle } } },
          authHeader
        );
        console.log(`       ✓ Updated`);
        updatedCount++;
      }
    } else {
      console.log('  ⚠️  Could not find sermon title item (no item under "Sermon" header)');
    }
  }

  // --- Update scripture item (first item under the "Scripture Reading" header) ---
  if (scripture) {
    const scriptureItem = findFirstItemAfterHeader(/^scripture reading$/i);
    if (scriptureItem) {
      const currentTitle = (scriptureItem.attributes.title || '').trim();

      if (currentTitle === scripture) {
        console.log(`  [${scriptureItem.id}] "${currentTitle}" — already current, skipping`);
      } else {
        console.log(`  [${scriptureItem.id}] "${currentTitle}"`);
        console.log(`       → "${scripture}"`);
        await httpPatch(
          `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items/${scriptureItem.id}`,
          { data: { type: 'Item', id: scriptureItem.id, attributes: { title: scripture } } },
          authHeader
        );
        console.log(`       ✓ Updated`);
        updatedCount++;
      }
    } else {
      console.log('  ⚠️  Could not find scripture item (no item under "Scripture Reading" header)');
    }
  }

  if (updatedCount === 0) {
    console.log('No items needed updating.');
  } else {
    console.log(`\nUpdated ${updatedCount} plan item(s).`);
  }

  return updatedCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { sermonTitle, scripture } = await fetchSermonInfoFromNewsletter();

  if (!sermonTitle && !scripture) {
    console.log('No sermon info found in newsletter. Nothing to update in Planning Center.');
    return;
  }

  await writeSermonToPlanningCenter(sermonTitle, scripture);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
