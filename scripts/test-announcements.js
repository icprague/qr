/**
 * test-announcements.js
 *
 * Dry-run version of send-announcements.js. Does everything EXCEPT send email.
 * - Fetches latest campaign from Mailchimp API
 * - Parses newsletter content
 * - Creates a public Google Doc with announcements
 * - Looks up moderator from Planning Center
 * - Prints all results to the log so you can verify before going live
 *
 * Environment variables:
 *   MAILCHIMP_API_KEY            – Mailchimp API key
 *   PLANNING_CENTER_APP_ID       – Planning Center API application ID
 *   PLANNING_CENTER_SECRET       – Planning Center API secret
 *   GOOGLE_DOC_ID                – (optional) Reuse this doc instead of creating a new one
 *
 * Google auth is handled via Workload Identity Federation (ADC).
 */

const https = require('https');
const http = require('http');
const { updateAnnouncementsDoc } = require('./google-docs');
const { parseNewsletter } = require('./parse-newsletter');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'MAILCHIMP_API_KEY',
  'PLANNING_CENTER_APP_ID',
  'PLANNING_CENTER_SECRET',
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
// Mailchimp: fetch latest campaign
// ---------------------------------------------------------------------------

async function fetchLatestCampaignHtml() {
  console.log('=== MAILCHIMP: Fetching latest sent campaign ===');
  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');

  if (!data.campaigns || data.campaigns.length === 0) throw new Error('No sent campaigns found.');

  const campaign = data.campaigns[0];
  console.log(`  Subject: "${campaign.settings?.subject_line}"`);
  console.log(`  Sent:    ${campaign.send_time}`);
  console.log(`  ID:      ${campaign.id}`);
  console.log(`  Archive: ${campaign.archive_url}`);

  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) throw new Error('Campaign has no HTML content.');
  console.log(`  HTML:    ${content.html.length} bytes\n`);
  return content.html;
}

// ---------------------------------------------------------------------------
// Planning Center: look up moderator
// ---------------------------------------------------------------------------

async function testPlanningCenterLookup() {
  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];

  const authHeader = 'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  console.log('=== PLANNING CENTER: Looking up moderator ===');
  console.log(`  Target Sunday: ${dateStr}\n`);

  const serviceTypesRaw = await fetch('https://api.planningcenteronline.com/services/v2/service_types', { headers });
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data || serviceTypes.data.length === 0) throw new Error('No service types found.');

  console.log('  Service types found:');
  serviceTypes.data.forEach((st) => console.log(`    - ${st.attributes.name} (ID: ${st.id})`));
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`\n  Using: ${serviceTypes.data[0].attributes.name}\n`);

  const plansRaw = await fetch(`https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=5`, { headers });
  const plans = JSON.parse(plansRaw);
  if (!plans.data || plans.data.length === 0) throw new Error('No upcoming plans found.');

  console.log('  Upcoming plans:');
  plans.data.forEach((p) => console.log(`    - ${p.attributes.dates} (ID: ${p.id})`));

  let targetPlan = plans.data[0];
  for (const plan of plans.data) {
    const planDate = plan.attributes.sort_date || plan.attributes.dates;
    if (planDate && planDate.startsWith(dateStr)) { targetPlan = plan; break; }
  }
  console.log(`\n  Selected plan: ${targetPlan.attributes.dates} (ID: ${targetPlan.id})\n`);

  const teamMembersRaw = await fetch(`https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members`, { headers });
  const teamMembers = JSON.parse(teamMembersRaw);
  if (!teamMembers.data || teamMembers.data.length === 0) throw new Error('No team members found.');

  console.log('  All team members for this plan:');
  teamMembers.data.forEach((m) => {
    console.log(`    - ${m.attributes.name} | Position: "${m.attributes.team_position_name}" | Status: ${m.attributes.status}`);
  });

  const moderatorKeywords = ['moderator', 'mc', 'host', 'emcee', 'worship leader'];
  let moderator = null;
  for (const member of teamMembers.data) {
    const position = (member.attributes.team_position_name || '').toLowerCase();
    if (moderatorKeywords.some((kw) => position.includes(kw))) { moderator = member; break; }
  }

  console.log(`\n  Moderator keywords searched: ${moderatorKeywords.join(', ')}`);

  if (!moderator) {
    console.log('  ** NO MODERATOR FOUND ** — would fall back to CC_EMAIL');
    return;
  }

  console.log(`  Matched moderator: ${moderator.attributes.name} (position: "${moderator.attributes.team_position_name}")`);

  const personId = moderator.relationships?.person?.data?.id;
  if (!personId) { console.log('  ** Could not get person ID — would fall back to CC_EMAIL'); return; }

  try {
    const personRaw = await fetch(`https://api.planningcenteronline.com/services/v2/people/${personId}/emails`, { headers });
    const emails = JSON.parse(personRaw);
    if (emails.data?.length > 0) { console.log(`  Email (services API): ${emails.data[0].attributes.address}`); return; }
  } catch {}

  try {
    const peopleEmailRaw = await fetch(`https://api.planningcenteronline.com/people/v2/people/${personId}/emails`, { headers });
    const peopleEmails = JSON.parse(peopleEmailRaw);
    if (peopleEmails.data?.length > 0) { console.log(`  Email (people API): ${peopleEmails.data[0].attributes.address}`); return; }
  } catch {}

  console.log('  ** Could not find email for moderator — would fall back to CC_EMAIL');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sundayDate = getUpcomingSunday();
  console.log(`\n========================================`);
  console.log(`  DRY RUN — Test Announcements`);
  console.log(`  Target Sunday: ${formatDate(sundayDate)}`);
  console.log(`========================================\n`);

  // --- Test 1: Mailchimp newsletter fetch + parse ---
  const campaignHtml = await fetchLatestCampaignHtml();

  console.log('=== NEWSLETTER PARSING ===');
  const sections = parseNewsletter(campaignHtml);
  console.log(`\n  Extracted ${sections.length} sections:\n`);
  sections.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.heading || '(no heading)'}`);
    s.content.forEach((c) => {
      const prefix = c.type === 'bullet' ? '      * ' : '      ';
      const text = c.text.length > 120 ? c.text.substring(0, 120) + '...' : c.text;
      console.log(`${prefix}${text}`);
    });
  });

  // --- Test 2: Update Google Doc ---
  console.log('\n=== UPDATING GOOGLE DOC ===');
  const { docUrl, docId } = await updateAnnouncementsDoc(
    process.env.GOOGLE_DOC_ID,
    sections,
    'SUNDAY ANNOUNCEMENTS',
    formatDate(sundayDate)
  );
  console.log(`\n  >> Open this link to preview: ${docUrl}`);
  console.log(`  >> Doc ID: ${docId}`);
  console.log('  >> Anyone with the link can view/edit it\n');

  // --- Test 3: Planning Center moderator lookup ---
  try {
    await testPlanningCenterLookup();
  } catch (err) {
    console.error(`\n  Planning Center error: ${err.message}`);
  }

  console.log(`\n========================================`);
  console.log(`  DRY RUN COMPLETE — No email was sent`);
  console.log(`  Google Doc: ${docUrl}`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
