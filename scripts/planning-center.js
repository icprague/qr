/**
 * planning-center.js
 *
 * Shared module for looking up moderator/worship leader information from Planning Center.
 * Used by both the editors email (Friday) and the moderator email (Saturday).
 *
 * Requires environment variables:
 *   PLANNING_CENTER_APP_ID  – Planning Center API application ID
 *   PLANNING_CENTER_SECRET  – Planning Center API secret
 */

const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * HTTP PATCH using the Planning Center JSON:API format.
 * Returns the raw response body string.
 */
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
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getUpcomingSunday() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday;
}

// ---------------------------------------------------------------------------
// Planning Center moderator lookup
// ---------------------------------------------------------------------------

/**
 * Look up moderator info from Planning Center for the upcoming Sunday.
 *
 * @returns {{ found: boolean, name: string|null, email: string|null }}
 *   found  – true if a moderator role was matched in the service plan
 *   name   – moderator's full name (null when not found)
 *   email  – moderator's email address (null if lookup failed or not found)
 *
 * Throws if Planning Center credentials are missing or the API is unreachable.
 */
async function getModeratorInfo() {
  const { PLANNING_CENTER_APP_ID, PLANNING_CENTER_SECRET } = process.env;
  if (!PLANNING_CENTER_APP_ID || !PLANNING_CENTER_SECRET) {
    throw new Error('Planning Center credentials not configured');
  }

  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];
  const authHeader = 'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  console.log(`Looking up Planning Center service plans around ${dateStr}...`);

  // Get service types
  const serviceTypesRaw = await fetch('https://api.planningcenteronline.com/services/v2/service_types', { headers });
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data || serviceTypes.data.length === 0) throw new Error('No service types found.');
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`Using service type: ${serviceTypes.data[0].attributes.name} (${serviceTypeId})`);

  // Get upcoming plans
  const plansRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=5`,
    { headers }
  );
  const plans = JSON.parse(plansRaw);
  if (!plans.data || plans.data.length === 0) throw new Error('No upcoming plans found.');

  // Match to specific Sunday
  let targetPlan = plans.data[0];
  for (const plan of plans.data) {
    const planDate = plan.attributes.sort_date || plan.attributes.dates;
    if (planDate && planDate.startsWith(dateStr)) { targetPlan = plan; break; }
  }
  console.log(`Using plan: ${targetPlan.attributes.dates} (ID: ${targetPlan.id})`);

  // Get team members
  const teamMembersRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members?per_page=100`,
    { headers }
  );
  const teamMembers = JSON.parse(teamMembersRaw);
  if (!teamMembers.data || teamMembers.data.length === 0) throw new Error('No team members found.');

  // Search for moderator role
  const moderatorKeywords = ['moderator', 'mc', 'host', 'emcee', 'worship leader'];
  let moderator = null;
  for (const member of teamMembers.data) {
    const position = (member.attributes.team_position_name || '').toLowerCase();
    if (moderatorKeywords.some((kw) => position.includes(kw))) { moderator = member; break; }
  }

  if (!moderator) {
    console.log('No moderator role found. Available positions:');
    teamMembers.data.forEach((m) => console.log(`  - ${m.attributes.name}: ${m.attributes.team_position_name}`));
    return { found: false, name: null, email: null };
  }

  const name = moderator.attributes.name;
  const personId = moderator.relationships?.person?.data?.id;
  if (!personId) {
    console.log(`Found moderator ${name} but no person ID available.`);
    return { found: true, name, email: null };
  }

  // Try services people endpoint
  try {
    const personRaw = await fetch(`https://api.planningcenteronline.com/services/v2/people/${personId}/emails`, { headers });
    const emails = JSON.parse(personRaw);
    if (emails.data?.length > 0) {
      const email = emails.data[0].attributes.address;
      console.log(`Found moderator: ${name} (${email})`);
      return { found: true, name, email };
    }
  } catch {}

  // Try people endpoint
  try {
    const peopleEmailRaw = await fetch(`https://api.planningcenteronline.com/people/v2/people/${personId}/emails`, { headers });
    const peopleEmails = JSON.parse(peopleEmailRaw);
    if (peopleEmails.data?.length > 0) {
      const email = peopleEmails.data[0].attributes.address;
      console.log(`Found moderator: ${name} (${email})`);
      return { found: true, name, email };
    }
  } catch (err) {
    console.log(`People API lookup failed: ${err.message}`);
  }

  console.log(`Found moderator ${name} but could not retrieve email.`);
  return { found: true, name, email: null };
}

// ---------------------------------------------------------------------------
// Planning Center plan-item write-back
// ---------------------------------------------------------------------------

/**
 * Look up the moderator and worship leader for the upcoming Sunday and write
 * their names into the matching plan items.
 *
 *   "Moderator"      → "Moderator - Jane Smith"
 *   "Worship Leader" → "Worship Leader - John Doe"
 *
 * Also handles the old announcements format:
 *   "Announcements + Welcome Guests (Moderator)" → "... (Moderator - Jane Smith)"
 *
 * Subsequent runs safely overwrite whatever name was written previously.
 * Worship leader is looked up via the "#Music leader" position in Planning Center.
 *
 * @returns {{ moderatorName: string|null, worshipLeaderName: string|null, updatedCount: number }}
 */
async function updateModeratorInPlanItems() {
  const { PLANNING_CENTER_APP_ID, PLANNING_CENTER_SECRET } = process.env;
  if (!PLANNING_CENTER_APP_ID || !PLANNING_CENTER_SECRET) {
    throw new Error('Planning Center credentials not configured');
  }

  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];
  const authHeader =
    'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  console.log(`Updating plan items for upcoming Sunday: ${dateStr}`);

  // Get service type
  const serviceTypesRaw = await fetch(
    'https://api.planningcenteronline.com/services/v2/service_types',
    { headers }
  );
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data?.length) throw new Error('No service types found.');
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`Service type: ${serviceTypes.data[0].attributes.name} (${serviceTypeId})`);

  // Get upcoming plans
  const plansRaw = await fetch(
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

  // Find the moderator and worship leader from assigned team members (skip status 'D' = declined)
  const teamMembersRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members?per_page=100`,
    { headers }
  );
  const teamMembers = JSON.parse(teamMembersRaw);

  let moderatorName = null;
  let worshipLeaderName = null;
  for (const member of teamMembers.data || []) {
    if (member.attributes.status === 'D') continue; // skip declined
    const position = (member.attributes.team_position_name || '').toLowerCase();
    if (!moderatorName && position.includes('moderator')) {
      moderatorName = member.attributes.name;
    }
    if (!worshipLeaderName && position.includes('music leader')) {
      worshipLeaderName = member.attributes.name;
    }
    if (moderatorName && worshipLeaderName) break;
  }

  console.log(`Moderator:      ${moderatorName || 'not assigned'}`);
  console.log(`Worship leader: ${worshipLeaderName || 'not assigned'}`);

  // Fetch plan items
  const itemsRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
    { headers }
  );
  const items = JSON.parse(itemsRaw);

  // Match either the old format "Announcements + Welcome Guests (Moderator...)"
  // or the new restructured format where the item is just titled "Moderator" / "Moderator - Name".
  const oldPattern = /\(Moderator[^)]*\)/i;
  const newModeratorPattern = /^Moderator(?: - .*)?$/i;
  const newWorshipPattern = /^Worship Leader(?: - .*)?$/i;
  let updatedCount = 0;

  const moderatorReplacement = moderatorName
    ? `Moderator - ${moderatorName}`
    : 'Moderator - no moderator scheduled';
  const moderatorOldReplacement = moderatorName
    ? `(Moderator - ${moderatorName})`
    : '(Moderator - no moderator scheduled)';
  const worshipLeaderReplacement = worshipLeaderName
    ? `Worship Leader - ${worshipLeaderName}`
    : 'Worship Leader - no worship leader scheduled';

  for (const item of items.data || []) {
    const title = item.attributes.title || '';
    let newTitle;

    if (/announcements/i.test(title) && oldPattern.test(title)) {
      // Old format: "Announcements + Welcome Guests (Moderator)" → replace parenthetical
      newTitle = title.replace(oldPattern, moderatorOldReplacement);
    } else if (newModeratorPattern.test(title)) {
      // New format: "Moderator" → "Moderator - Name"
      newTitle = moderatorReplacement;
    } else if (newWorshipPattern.test(title)) {
      // New format: "Worship Leader" → "Worship Leader - Name"
      newTitle = worshipLeaderReplacement;
    } else {
      continue;
    }

    if (newTitle === title) {
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
    console.log('No items needed updating.');
  } else {
    console.log(`\nUpdated ${updatedCount} plan item(s).`);
  }

  return { moderatorName, worshipLeaderName, updatedCount };
}

module.exports = { getModeratorInfo, updateModeratorInPlanItems };
