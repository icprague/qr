/**
 * planning-center.js
 *
 * Shared module for looking up moderator information from Planning Center.
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
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members`,
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

  // Look up email via the People module (the Services /people endpoint is a
  // singleton "me" resource and would return the API token owner's email)
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

module.exports = { getModeratorInfo };
