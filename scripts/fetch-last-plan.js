/**
 * fetch-last-plan.js
 *
 * Fetches the most recently completed plan from Planning Center and logs
 * every heading, item, song, and description in order.
 *
 * Usage:
 *   PLANNING_CENTER_APP_ID=xxx PLANNING_CENTER_SECRET=yyy node scripts/fetch-last-plan.js
 *
 * Song details (key, author, CCLI) are included via ?include=song.
 */

const https = require('https');

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { PLANNING_CENTER_APP_ID, PLANNING_CENTER_SECRET } = process.env;
  if (!PLANNING_CENTER_APP_ID || !PLANNING_CENTER_SECRET) {
    throw new Error('PLANNING_CENTER_APP_ID and PLANNING_CENTER_SECRET must be set.');
  }

  const authHeader =
    'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');
  const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };

  // 1. Get the first service type
  const stRaw = await fetch('https://api.planningcenteronline.com/services/v2/service_types', { headers });
  const serviceTypes = JSON.parse(stRaw);
  if (!serviceTypes.data?.length) throw new Error('No service types found.');

  const serviceType = serviceTypes.data[0];
  console.log(`Service type: ${serviceType.attributes.name} (ID: ${serviceType.id})`);

  // 2. Get past plans, sorted descending — first result is the most recent
  const plansRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceType.id}/plans?filter=past&order=-sort_date&per_page=1`,
    { headers }
  );
  const plans = JSON.parse(plansRaw);
  if (!plans.data?.length) throw new Error('No past plans found.');

  const plan = plans.data[0];
  const planTitle = plan.attributes.title ? ` — "${plan.attributes.title}"` : '';
  console.log(`Last plan: ${plan.attributes.dates}${planTitle} (ID: ${plan.id})\n`);

  // 3. Fetch all plan items, including linked song records for song items
  const itemsRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceType.id}/plans/${plan.id}/items?per_page=100&include=song&order=sequence`,
    { headers }
  );
  const payload = JSON.parse(itemsRaw);

  // Build a lookup map for included song records (keyed by song ID)
  const songMap = {};
  for (const included of payload.included || []) {
    if (included.type === 'Song') {
      songMap[included.id] = included.attributes;
    }
  }

  // 4. Print the plan in order
  console.log('='.repeat(60));
  console.log(`PLAN: ${plan.attributes.dates}${planTitle}`);
  console.log('='.repeat(60));

  const items = payload.data || [];
  if (!items.length) {
    console.log('(no items found)');
    return;
  }

  for (const item of items) {
    const a = item.attributes;
    const type = a.item_type || '?';

    if (type === 'header') {
      // Section header
      console.log(`\n--- ${a.title || '(untitled header)'} ---`);

    } else if (type === 'song') {
      // Song item
      console.log(`\n[SONG] ${a.title || '(untitled song)'}`);

      // Extra song metadata from the included song record, if present
      const songId = item.relationships?.song?.data?.id;
      const song = songId ? songMap[songId] : null;
      if (song) {
        if (song.author)    console.log(`       Author : ${song.author}`);
        if (song.copyright) console.log(`       Copyright: ${song.copyright}`);
        if (song.ccli_number) console.log(`       CCLI  : ${song.ccli_number}`);
        if (song.themes)    console.log(`       Themes: ${song.themes}`);
      }

      // Key / arrangement from the item itself
      if (a.key_name)         console.log(`       Key   : ${a.key_name}`);

      // Description / notes on this song instance
      if (a.description && a.description.trim()) {
        console.log(`       Notes : ${a.description.trim()}`);
      }

    } else {
      // Regular item
      console.log(`\n[ITEM] ${a.title || '(untitled item)'}`);
      if (a.description && a.description.trim()) {
        // Indent multi-line descriptions
        const desc = a.description.trim().replace(/\n/g, '\n         ');
        console.log(`       Desc  : ${desc}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total items: ${items.length}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
