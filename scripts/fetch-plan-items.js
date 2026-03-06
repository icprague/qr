/**
 * fetch-plan-items.js  (read-only diagnostic, not committed to production)
 *
 * Fetches all items from the next upcoming Sunday's plan in Planning Center
 * and prints their names, types, and IDs so we can identify which items
 * should receive the moderator / worship leader name.
 */

const https = require('https');

function fetch(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const reqOptions = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      ...options,
    };
    https.get(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let next = res.headers.location;
        if (next.startsWith('/')) next = `${u.protocol}//${u.hostname}` + next;
        return resolve(fetch(next, options, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject);
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

async function main() {
  const { PLANNING_CENTER_APP_ID, PLANNING_CENTER_SECRET } = process.env;
  if (!PLANNING_CENTER_APP_ID || !PLANNING_CENTER_SECRET) {
    throw new Error('PLANNING_CENTER_APP_ID and PLANNING_CENTER_SECRET must be set.');
  }

  const authHeader = 'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0];
  console.log(`Looking for plan for upcoming Sunday: ${dateStr}\n`);

  // 1. Get service types
  const stRaw = await fetch('https://api.planningcenteronline.com/services/v2/service_types', { headers });
  const serviceTypes = JSON.parse(stRaw);
  if (!serviceTypes.data?.length) throw new Error('No service types found.');

  for (const st of serviceTypes.data) {
    console.log(`Service type: ${st.attributes.name} (ID: ${st.id})`);
  }
  const serviceTypeId = serviceTypes.data[0].id;
  console.log('');

  // 2. Get upcoming plans
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
  console.log(`Plan: "${targetPlan.attributes.title || '(no title)'}" — ${targetPlan.attributes.dates} (ID: ${targetPlan.id})\n`);

  // 3. Fetch team members (all statuses) and needed positions in parallel
  const [tmRaw, npRaw] = await Promise.all([
    fetch(
      `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members?per_page=100&include=team`,
      { headers }
    ),
    fetch(
      `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/needed_positions`,
      { headers }
    ),
  ]);
  const teamMembers = JSON.parse(tmRaw);
  const neededPositions = JSON.parse(npRaw);

  // Status legend: C=Confirmed, U=Unconfirmed, D=Declined, P=Pending
  const statusLabels = { C: 'Confirmed', U: 'Unconfirmed', D: 'Declined', P: 'Pending' };

  console.log('=== ALL TEAM MEMBERS (any status) ===');
  if (teamMembers.data?.length) {
    for (const m of teamMembers.data) {
      const s = m.attributes.status || '?';
      const label = statusLabels[s] || s;
      const team = m.attributes.team_position_name || '(no position)';
      console.log(`  [${m.id}] [${s} - ${label}] ${m.attributes.name} — position: "${team}"`);
    }
    console.log(`\n  Total members: ${teamMembers.data.length}`);
    if (teamMembers.meta?.total_count) {
      console.log(`  API total_count: ${teamMembers.meta.total_count}`);
    }
    if (teamMembers.links?.next) {
      console.log(`  WARNING: More pages available (not all members shown)`);
    }
  } else {
    console.log('  (none found)');
  }
  console.log('');

  console.log('=== UNASSIGNED / NEEDED POSITIONS ===');
  if (neededPositions.data?.length) {
    for (const np of neededPositions.data) {
      const a = np.attributes;
      const qty = a.quantity > 1 ? ` (×${a.quantity})` : '';
      const team = a.team_name ? ` — team: "${a.team_name}"` : '';
      console.log(`  [${np.id}] position: "${a.team_position_name}"${qty}${team}`);
    }
  } else {
    console.log('  (all positions filled)');
  }
  console.log('');

  // 4. Fetch plan items
  const itemsRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
    { headers }
  );
  const items = JSON.parse(itemsRaw);
  console.log('=== PLAN ITEMS ===');
  if (items.data?.length) {
    for (const item of items.data) {
      const a = item.attributes;
      const type = a.item_type || a.type || '?';
      const seq = a.sequence != null ? `#${a.sequence}` : '';
      const desc = a.description ? ` — description: "${a.description}"` : '';
      console.log(`  [${item.id}] ${seq} type="${type}" title="${a.title || ''}"${desc}`);
    }
  } else {
    console.log('  (no items found)');
  }
  console.log('');
  console.log(`Total items: ${items.data?.length ?? 0}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
