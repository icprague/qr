/**
 * restructure-plan.js
 *
 * Restructures a Planning Center Sunday plan to match the standard template.
 * Detects communion Sundays from the plan title and adds a Communion header.
 *
 * Rules:
 *   - Songs are NEVER touched.
 *   - Headers are renamed to match the standard template.
 *   - Items have person names stripped; special items get fixed titles.
 *   - If the plan title contains "communion", a Communion header is inserted
 *     between "Sermon title" and the last song before Benediction.
 *
 * Usage:
 *   TARGET_DATE=2026-03-15 node scripts/restructure-mar22-plan.js            # dry run
 *   TARGET_DATE=2026-03-15 node scripts/restructure-mar22-plan.js --apply    # apply
 *
 * Required environment variables:
 *   PLANNING_CENTER_APP_ID
 *   PLANNING_CENTER_SECRET
 *   TARGET_DATE  — the Sunday date to restructure (YYYY-MM-DD)
 */

'use strict';

const https = require('https');

const DRY_RUN = !process.argv.includes('--apply');
const TARGET_DATE = process.env.TARGET_DATE;
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('TARGET_DATE environment variable is required (format: YYYY-MM-DD).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(url, options = {}, redirects = 0) {
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
        return resolve(httpGet(next, options, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject);
  });
}

function httpDelete(url, authHeader) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: Number(u.port) || 443,
        path: u.pathname + u.search,
        method: 'DELETE',
        headers: { Authorization: authHeader },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          // 204 No Content is the expected success response for DELETE
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} DELETE ${url}: ${Buffer.concat(chunks).toString('utf-8')}`));
          }
          resolve();
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, body, authHeader) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        port: Number(u.port) || 443,
        path: u.pathname + u.search,
        method: 'POST',
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
            return reject(new Error(`HTTP ${res.statusCode} POST ${url}: ${text}`));
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

// ---------------------------------------------------------------------------
// Transformation rules
// ---------------------------------------------------------------------------

// Items whose titles match these patterns are DELETED (type=item or type=header).
// Songs are never deleted regardless.
const DELETE_RULES = [
  /^pre service$/i,
  /^pre-?service slides?$/i,        // matches "slides" and "slide"
  /^countdown$/i,
  /^congregational prayer.*ushers/i, // item form — the header is kept & renamed
  /^post service$/i,
  /^exit song$/i,
  /^post-?service slides?$/i,        // matches "slides" and "slide"
];

// These patterns delete ONLY items of type 'item', never headers.
// (Prevents deleting a correctly-named header on re-runs.)
const DELETE_ITEM_ONLY_RULES = [
  /^benediction$/i, // extra Benediction item — the Benediction *header* comes from renaming "Final Part"
];

// Each rule: { match (regex on title), newTitle, newDescription (optional) }
// Applied only to items of the matching type. Songs are always skipped.

const HEADER_RULES = [
  // "Worship" → "Welcome"
  { match: /^worship$/i, newTitle: 'Welcome' },
  // "Scripture reading / Prayer / Sunday School" → "Congregational Prayer"
  { match: /scripture reading.*sunday school/i, newTitle: 'Congregational Prayer' },
  // "Message" → "Sermon"
  { match: /^message$/i, newTitle: 'Sermon' },
  // "Final Part" → "Benediction"
  { match: /^final part$/i, newTitle: 'Benediction' },
];

const ITEM_RULES = [
  // "Welcome + Prayer (Moderator)" → "Worship Leader"
  { match: /welcome.*prayer.*moderator/i, newTitle: 'Worship Leader' },
  // "Announcements + Welcome Guests (Moderator)" → "Moderator"
  { match: /announcements.*moderator/i, newTitle: 'Moderator' },
  // "Sunday School (Ushers)" → invisible character title with children-dismissed note
  // (Planning Center rejects truly blank titles, so we use a word joiner U+2060)
  {
    match: /sunday school.*ushers/i,
    newTitle: '\u2060',
    newDescription: '(Children are dismissed for Sunday School)',
  },
  // "Scripture reading (Ushers)" → "Scripture"
  { match: /scripture reading.*ushers/i, newTitle: 'Scripture' },
  // "Sermon" (exact item, not header) → "Sermon title"
  { match: /^sermon$/i, newTitle: 'Sermon title' },
  // "Benediction (Moderator)" → "Benediction"
  { match: /benediction.*moderator/i, newTitle: 'Benediction' },
];

function applyRule(rules, title) {
  for (const rule of rules) {
    if (rule.match.test(title)) return rule;
  }
  return null;
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

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Restructuring plan for ${TARGET_DATE}.\n`);

  // 1. Get service type
  const stRaw = await httpGet('https://api.planningcenteronline.com/services/v2/service_types', { headers });
  const serviceTypes = JSON.parse(stRaw);
  if (!serviceTypes.data?.length) throw new Error('No service types found.');
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`Service type: ${serviceTypes.data[0].attributes.name} (${serviceTypeId})\n`);

  // 2. Find the plan for TARGET_DATE — check future plans first, then recent past
  //    Match against sort_date (YYYY-MM-DDTHH:MM:SS) or the human-readable dates field.
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, mon, day] = TARGET_DATE.split('-');
  const shortDate = `${monthNames[parseInt(mon, 10) - 1]} ${parseInt(day, 10)}`;

  let targetPlan = null;

  for (const filter of ['future', 'past']) {
    const plansRaw = await httpGet(
      `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=${filter}&per_page=10`,
      { headers }
    );
    const plans = JSON.parse(plansRaw);
    for (const plan of plans.data || []) {
      const planDate = plan.attributes.sort_date || plan.attributes.dates || '';
      if (planDate.startsWith(TARGET_DATE) || planDate.includes(shortDate)) {
        targetPlan = plan;
        break;
      }
    }
    if (targetPlan) break;
  }

  if (!targetPlan) {
    throw new Error(
      `Could not find a plan for ${TARGET_DATE}. ` +
      'Check the date or run fetch-plan-items.js to see available plans.'
    );
  }

  const planTitle = targetPlan.attributes.title || '(no title)';
  const isCommunionSunday = /communion/i.test(planTitle);
  console.log(`Found plan: "${planTitle}" — ${targetPlan.attributes.dates} (ID: ${targetPlan.id})`);
  if (isCommunionSunday) {
    console.log('  → Communion Sunday detected — will add Communion header');
  }
  console.log();

  // 3. Fetch plan items
  const itemsRaw = await httpGet(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
    { headers }
  );
  const items = JSON.parse(itemsRaw);
  const allItems = items.data || [];

  console.log(`Current plan has ${allItems.length} items. Analyzing...\n`);

  // 4. Process each item
  let updatedCount = 0;
  let deletedCount = 0;
  let createdCount = 0;
  let skippedSongs = 0;

  // Check which headers already exist (before any changes) so we know what to create.
  const hasAnnouncementsHeader = allItems.some(
    (item) => item.attributes.item_type === 'header' && /^announcements/i.test(item.attributes.title)
  );
  const hasScriptureReadingHeader = allItems.some(
    (item) => item.attributes.item_type === 'header' && /^scripture reading$/i.test(item.attributes.title)
  );
  const hasCommunionHeader = allItems.some(
    (item) => item.attributes.item_type === 'header' && /^communion$/i.test(item.attributes.title)
  );

  // Find the Benediction header (titled "Final Part" or already "Benediction") so we can
  // delete everything that comes after it, regardless of title.
  const benedictionHeader = allItems.find(
    (item) => item.attributes.item_type === 'header' &&
              (/^final part$/i.test(item.attributes.title) || /^benediction$/i.test(item.attributes.title))
  );
  const benedictionSeq = benedictionHeader ? benedictionHeader.attributes.sequence : Infinity;

  for (const item of allItems) {
    const attrs = item.attributes;
    const type = attrs.item_type || '';
    const title = attrs.title || '';
    const seq = attrs.sequence != null ? `#${attrs.sequence}` : '';

    // Songs are NEVER touched
    if (type === 'song') {
      skippedSongs++;
      console.log(`  ${seq} [SONG] "${title}" — skipped (songs are never modified)`);
      continue;
    }

    // Delete anything that appears after the Benediction header
    if (attrs.sequence > benedictionSeq) {
      console.log(`  ${seq} [${type.toUpperCase()}] "${title}" — DELETE (after Benediction)`);
      if (!DRY_RUN) {
        await httpDelete(
          `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items/${item.id}`,
          authHeader
        );
        console.log('         ✓ Deleted');
      }
      deletedCount++;
      continue;
    }

    // Check if this item should be deleted (by title)
    const shouldDelete =
      DELETE_RULES.some((re) => re.test(title)) ||
      (type === 'item' && DELETE_ITEM_ONLY_RULES.some((re) => re.test(title)));
    if (shouldDelete) {
      console.log(`  ${seq} [${type.toUpperCase()}] "${title}" — DELETE`);
      if (!DRY_RUN) {
        await httpDelete(
          `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items/${item.id}`,
          authHeader
        );
        console.log(`         ✓ Deleted`);
      }
      deletedCount++;
      continue;
    }

    // Apply rename rules
    const rules = type === 'header' ? HEADER_RULES : ITEM_RULES;
    const rule = applyRule(rules, title);

    if (!rule) {
      console.log(`  ${seq} [${type.toUpperCase()}] "${title}" — no change needed`);
      continue;
    }

    const newTitle = rule.newTitle;
    const newDescription = rule.newDescription;

    // Build the attributes object for the PATCH
    const patchAttrs = {};
    if (newTitle !== title) patchAttrs.title = newTitle;
    if (newDescription !== undefined && newDescription !== (attrs.description || '')) {
      patchAttrs.description = newDescription;
    }

    if (Object.keys(patchAttrs).length === 0) {
      console.log(`  ${seq} [${type.toUpperCase()}] "${title}" — already correct, no change needed`);
      continue;
    }

    const titleChange = patchAttrs.title !== undefined
      ? `title: "${title}" → "${patchAttrs.title}"`
      : `title unchanged: "${title}"`;
    const descChange = patchAttrs.description !== undefined
      ? `  description → "${patchAttrs.description}"`
      : '';

    console.log(`  ${seq} [${type.toUpperCase()}] ${titleChange}`);
    if (descChange) console.log(`         ${descChange}`);

    if (!DRY_RUN) {
      await httpPatch(
        `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items/${item.id}`,
        { data: { type: 'Item', id: item.id, attributes: patchAttrs } },
        authHeader
      );
      console.log(`         ✓ Updated`);
    }

    updatedCount++;
  }

  // 5. Create missing headers
  // Template requires:
  //   - "Announcements + Welcome Guests" header before the Moderator item
  //   - "Scripture Reading" header before the Scripture item
  const headersToCreate = [];
  if (!hasAnnouncementsHeader) {
    headersToCreate.push({ title: 'Announcements + Welcome Guests', beforeItem: /^moderator$/i, label: 'Moderator' });
  }
  if (!hasScriptureReadingHeader) {
    headersToCreate.push({ title: 'Scripture Reading', beforeItem: /^scripture$/i, label: 'Scripture' });
  }
  if (isCommunionSunday && !hasCommunionHeader) {
    headersToCreate.push({ title: 'Communion', beforeItem: /^benediction$/i, label: 'Benediction', matchType: 'header' });
  }

  if (headersToCreate.length > 0) {
    if (DRY_RUN) {
      for (const h of headersToCreate) {
        console.log(`\n  [CREATE HEADER] "${h.title}" before ${h.label} item — dry run, would POST`);
        createdCount++;
      }
    } else {
      // Re-fetch so sequence numbers reflect the deletions we just made
      let refreshedRaw = await httpGet(
        `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
        { headers }
      );
      let refreshedItems = JSON.parse(refreshedRaw).data || [];

      for (const h of headersToCreate) {
        const anchorType = h.matchType || 'item';
        const anchor = refreshedItems.find(
          (item) => item.attributes.item_type === anchorType && h.beforeItem.test(item.attributes.title)
        );
        if (!anchor) {
          console.log(`\n  ⚠️  Could not find "${h.label}" item after processing — add "${h.title}" header manually`);
          continue;
        }
        const seq = anchor.attributes.sequence;
        console.log(`\n  [CREATE HEADER] "${h.title}" at sequence ${seq} (before ${h.label})`);
        await httpPost(
          `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items`,
          { data: { type: 'Item', attributes: { title: h.title, item_type: 'header', sequence: seq } } },
          authHeader
        );
        console.log('         ✓ Created');
        createdCount++;

        // Re-fetch after each insert so the next header gets correct sequences
        refreshedRaw = await httpGet(
          `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/items?per_page=100`,
          { headers }
        );
        refreshedItems = JSON.parse(refreshedRaw).data || [];
      }
    }
  }

  // 6. Summary
  console.log('\n' + '─'.repeat(60));
  console.log(`Songs skipped (untouched): ${skippedSongs}`);
  console.log(`Items ${DRY_RUN ? 'that would be deleted' : 'deleted'}: ${deletedCount}`);
  console.log(`Items ${DRY_RUN ? 'that would be updated' : 'updated'}: ${updatedCount}`);
  console.log(`Headers ${DRY_RUN ? 'that would be created' : 'created'}: ${createdCount}`);
  if (DRY_RUN) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log(`To apply: TARGET_DATE=${TARGET_DATE} node scripts/restructure-mar22-plan.js --apply`);
  } else {
    console.log('\nDone. Plan has been restructured.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
