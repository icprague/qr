/**
 * upcoming-preachers.js
 *
 * Prints who is scheduled to preach for the next six months,
 * fetched from Planning Center.
 *
 * Usage:
 *   PLANNING_CENTER_APP_ID=... PLANNING_CENTER_SECRET=... node scripts/upcoming-preachers.js
 *
 * Requires environment variables:
 *   PLANNING_CENTER_APP_ID  – Planning Center API application ID
 *   PLANNING_CENTER_SECRET  – Planning Center API secret
 */

const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// HTTP helper (copied from planning-center.js pattern)
// ---------------------------------------------------------------------------

function fetch(url, options = {}, redirects = 0) {
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
          return resolve(fetch(next, options, redirects + 1));
        }
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      })
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Planning Center date string (YYYY-MM-DD or full ISO) as a readable date. */
function formatDate(dateStr) {
  if (!dateStr) return '(no date)';
  const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00Z' : dateStr);
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Return a Date that is exactly 6 months from today. */
function sixMonthsFromNow() {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { PLANNING_CENTER_APP_ID, PLANNING_CENTER_SECRET } = process.env;
  if (!PLANNING_CENTER_APP_ID || !PLANNING_CENTER_SECRET) {
    console.error('Error: PLANNING_CENTER_APP_ID and PLANNING_CENTER_SECRET must be set.');
    process.exit(1);
  }

  const authHeader =
    'Basic ' +
    Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  const cutoff = sixMonthsFromNow();

  // Match the exact "Preacher" position name used in Planning Center
  const isPreacher = (position) => position.toLowerCase() === 'preacher';

  // 1. Get service types
  const serviceTypesRaw = await fetch(
    'https://api.planningcenteronline.com/services/v2/service_types',
    { headers }
  );
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data || serviceTypes.data.length === 0) {
    console.error('No service types found.');
    process.exit(1);
  }

  const serviceTypeId = serviceTypes.data[0].id;
  const serviceTypeName = serviceTypes.data[0].attributes.name;
  console.log(`Service type: ${serviceTypeName}\n`);

  // 2. Fetch all future plans (paginate until we pass the 6-month cutoff)
  const allPlans = [];
  let nextUrl = `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=25&order=sort_date`;

  while (nextUrl) {
    const raw = await fetch(nextUrl, { headers });
    const page = JSON.parse(raw);
    if (!page.data || page.data.length === 0) break;

    for (const plan of page.data) {
      const sortDate = plan.attributes.sort_date || plan.attributes.dates;
      if (!sortDate) { allPlans.push(plan); continue; }
      const planDate = new Date(sortDate.length === 10 ? sortDate + 'T12:00:00Z' : sortDate);
      if (planDate > cutoff) break;
      allPlans.push(plan);
    }

    // Stop paginating if the last plan on this page is already past our cutoff
    const last = page.data[page.data.length - 1];
    const lastDate = last.attributes.sort_date || last.attributes.dates;
    if (lastDate && new Date(lastDate.length === 10 ? lastDate + 'T12:00:00Z' : lastDate) > cutoff) break;

    nextUrl = page.links?.next || null;
  }

  if (allPlans.length === 0) {
    console.log('No upcoming plans found in the next 6 months.');
    return;
  }

  console.log(`Upcoming preachers for the next 6 months (${allPlans.length} services):`);
  console.log('='.repeat(60));

  // 3. For each plan, fetch team members and find the preacher
  for (const plan of allPlans) {
    const planDate = plan.attributes.sort_date || plan.attributes.dates;
    const displayDate = formatDate(planDate ? planDate.substring(0, 10) : null);
    const planTitle = plan.attributes.title ? ` — ${plan.attributes.title}` : '';

    const members = [];
    let teamUrl = `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/team_members?per_page=100`;
    while (teamUrl) {
      const teamRaw = await fetch(teamUrl, { headers });
      const teamData = JSON.parse(teamRaw);
      members.push(...(teamData.data || []));
      teamUrl = teamData.links?.next || null;
    }

    // Find preacher — check team_position_name against keywords
    let preacher = null;
    for (const member of members) {
      if (member.attributes.status === 'D') continue; // declined
      const position = member.attributes.team_position_name || '';
      if (isPreacher(position)) {
        preacher = member.attributes.name;
        break;
      }
    }

    if (preacher) {
      console.log(`${displayDate}${planTitle}`);
      console.log(`  Preacher: ${preacher}`);
    } else {
      // Print all available positions so the user can refine keywords
      console.log(`${displayDate}${planTitle}`);
      console.log(`  Preacher: (not assigned)`);
      if (members.length > 0) {
        const positions = [...new Set(members.map((m) => m.attributes.team_position_name).filter(Boolean))];
        console.log(`  Available positions: ${positions.join(', ')}`);
      }
    }
    console.log();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
