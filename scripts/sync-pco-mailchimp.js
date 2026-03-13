/**
 * sync-pco-mailchimp.js
 *
 * Fetches people from a Planning Center People list (newsletter opt-in)
 * and upserts them as subscribers in a Mailchimp audience.
 *
 * Only syncs first name, last name, and email address.
 * Handles PCO pagination (max 100 per page) and Mailchimp upsert
 * (add new subscribers or update existing ones without error).
 *
 * Environment variables:
 *   PLANNING_CENTER_APP_ID  – Planning Center API application ID
 *   PLANNING_CENTER_SECRET  – Planning Center API secret
 *   MAILCHIMP_API_KEY       – Mailchimp API key (e.g. abc123def456-us7)
 *   DRY_RUN                – Set to "true" to only log who would be synced
 */

const https = require('https');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PCO_LIST_ID = '4883625';
const MAILCHIMP_AUDIENCE_ID = 'c35238d169';

const PCO_APP_ID = process.env.PLANNING_CENTER_APP_ID;
const PCO_APP_SECRET = process.env.PLANNING_CENTER_SECRET;
const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;

const DRY_RUN = process.env.DRY_RUN === 'true';

if (!PCO_APP_ID || !PCO_APP_SECRET) {
  console.error('Error: PLANNING_CENTER_APP_ID and PLANNING_CENTER_SECRET must be set.');
  process.exit(1);
}
if (!DRY_RUN && !MAILCHIMP_API_KEY) {
  console.error('Error: MAILCHIMP_API_KEY must be set (or set DRY_RUN=true).');
  process.exit(1);
}

const PCO_AUTH = 'Basic ' + Buffer.from(`${PCO_APP_ID}:${PCO_APP_SECRET}`).toString('base64');
const MC_DC = MAILCHIMP_API_KEY ? MAILCHIMP_API_KEY.split('-').pop() : null;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: { ...headers },
    };
    if (payload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pcoGet(url) {
  const res = await httpsRequest('GET', url, { Authorization: PCO_AUTH });
  if (res.status !== 200) {
    throw new Error(`PCO API ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body);
}

async function mailchimpPut(endpoint, body) {
  const url = `https://${MC_DC}.api.mailchimp.com/3.0${endpoint}`;
  const res = await httpsRequest('PUT', url, { Authorization: `Bearer ${MAILCHIMP_API_KEY}` }, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Mailchimp API ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------
// Planning Center: fetch all people from the newsletter opt-in list
// ---------------------------------------------------------------------------

async function fetchPCOListPeople() {
  const people = [];
  let url = `https://api.planningcenteronline.com/people/v2/lists/${PCO_LIST_ID}/people?per_page=100&include=emails`;
  let page = 1;

  while (url) {
    console.log(`  Fetching PCO page ${page}...`);
    const data = await pcoGet(url);

    // Build a map of included emails keyed by person ID
    const emailMap = {};
    if (data.included) {
      for (const inc of data.included) {
        if (inc.type === 'Email') {
          const personId = inc.relationships?.person?.data?.id;
          if (personId && inc.attributes.address) {
            // Prefer primary email; otherwise take the first one we find
            if (!emailMap[personId] || inc.attributes.primary) {
              emailMap[personId] = inc.attributes.address;
            }
          }
        }
      }
    }

    for (const person of data.data || []) {
      const email = emailMap[person.id];
      if (!email) {
        console.log(`    Skipping ${person.attributes.first_name} ${person.attributes.last_name} (no email)`);
        continue;
      }
      people.push({
        firstName: person.attributes.first_name || '',
        lastName: person.attributes.last_name || '',
        email: email.toLowerCase().trim(),
      });
    }

    // Follow pagination
    url = data.links?.next || null;
    page++;
  }

  return people;
}

// ---------------------------------------------------------------------------
// Mailchimp: upsert subscribers
// ---------------------------------------------------------------------------

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

async function upsertToMailchimp(people) {
  let added = 0;
  let updated = 0;
  let errors = 0;

  for (const person of people) {
    const subscriberHash = md5(person.email);
    const endpoint = `/lists/${MAILCHIMP_AUDIENCE_ID}/members/${subscriberHash}`;

    try {
      const result = await mailchimpPut(endpoint, {
        email_address: person.email,
        status_if_new: 'subscribed',
        status: 'subscribed',
        merge_fields: {
          FNAME: person.firstName,
          LNAME: person.lastName,
        },
      });

      if (result.status === 'subscribed') {
        // Mailchimp doesn't distinguish add vs update in the response status,
        // but we can check if the member was just created vs already existed
        // by looking at whether last_changed equals the timestamps. For logging
        // purposes we just count total processed.
        console.log(`    ${person.email} — synced (${person.firstName} ${person.lastName})`);
        added++;
      } else {
        console.log(`    ${person.email} — status: ${result.status}`);
        updated++;
      }
    } catch (err) {
      console.error(`    ${person.email} — ERROR: ${err.message}`);
      errors++;
    }
  }

  return { added, updated, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Planning Center → Mailchimp Sync ===\n');
  if (DRY_RUN) console.log('*** DRY RUN — no changes will be made to Mailchimp ***\n');
  console.log(`PCO List ID: ${PCO_LIST_ID}`);
  console.log(`Mailchimp Audience ID: ${MAILCHIMP_AUDIENCE_ID}`);
  if (!DRY_RUN) console.log(`Mailchimp DC: ${MC_DC}`);
  console.log();

  console.log('Step 1: Fetching people from Planning Center list...');
  const people = await fetchPCOListPeople();
  console.log(`\n  Found ${people.length} people with email addresses.\n`);

  if (people.length === 0) {
    console.log('No people to sync. Exiting.');
    return;
  }

  if (DRY_RUN) {
    console.log('People who would be synced to Mailchimp:\n');
    console.log('  #   Email                                  First Name       Last Name');
    console.log('  --- ---------------------------------------- ---------------- ----------------');
    people.forEach((p, i) => {
      const num = String(i + 1).padStart(3);
      const email = p.email.padEnd(40);
      const first = p.firstName.padEnd(16);
      console.log(`  ${num} ${email} ${first} ${p.lastName}`);
    });
    console.log(`\n=== Dry Run Complete — ${people.length} subscriber(s) would be synced ===`);
    return;
  }

  console.log('Step 2: Upserting subscribers to Mailchimp...');
  const { added, updated, errors } = await upsertToMailchimp(people);

  console.log(`\n=== Sync Complete ===`);
  console.log(`  Synced: ${added}`);
  console.log(`  Other status: ${updated}`);
  console.log(`  Errors: ${errors}`);

  if (errors > 0) {
    console.error(`\n${errors} error(s) occurred during sync.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
