/**
 * test-sermon-info.js
 *
 * Test script that fetches the latest newsletter from Mailchimp and extracts
 * the sermon title and scripture reference from the "This Sunday" section.
 *
 * Logs all findings so you can verify the extraction is correct before
 * integrating into the Planning Center plan-item update workflow.
 *
 * Environment variables:
 *   MAILCHIMP_API_KEY  – Mailchimp API key (e.g. abc123def456-us7)
 *   SKIP_DATE_CHECK    – Set to "true" to bypass the same-day check (default: true for testing)
 */

const https = require('https');
const { extractSermonInfo, formatSermonForPlanItem } = require('./parse-sermon-info');

const API_KEY = process.env.MAILCHIMP_API_KEY;
if (!API_KEY) {
  console.error('Error: MAILCHIMP_API_KEY environment variable is not set.');
  process.exit(1);
}

const dc = API_KEY.split('-').pop();

function mailchimpGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${dc}.api.mailchimp.com`,
      path: `/3.0${endpoint}`,
      headers: { Authorization: `Bearer ${API_KEY}` },
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

async function main() {
  console.log('=== SERMON INFO EXTRACTION TEST ===\n');
  console.log(`Using Mailchimp data center: ${dc}`);

  // Fetch latest sent campaign
  console.log('Fetching most recent sent campaign...');
  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
  if (!data.campaigns || data.campaigns.length === 0) {
    console.error('No sent campaigns found.');
    process.exit(1);
  }

  const campaign = data.campaigns[0];
  console.log(`Campaign: "${campaign.settings?.subject_line}" (ID: ${campaign.id})`);
  console.log(`  Sent: ${campaign.send_time}\n`);

  // Fetch campaign HTML content
  console.log('Fetching campaign HTML content...');
  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) {
    console.error('Campaign has no HTML content.');
    process.exit(1);
  }
  console.log(`  HTML length: ${content.html.length} bytes\n`);

  // Extract sermon info
  console.log('--- Extracting sermon info from "This Sunday" section ---\n');
  const { sermonTitle, scripture } = extractSermonInfo(content.html);

  if (sermonTitle) {
    console.log(`  Sermon Title (H2): "${sermonTitle}"`);
  } else {
    console.log('  Sermon Title (H2): NOT FOUND');
  }

  if (scripture) {
    console.log(`  Scripture (H3):    "${scripture}"`);
  } else {
    console.log('  Scripture (H3):    NOT FOUND');
  }

  console.log('');

  // Format as it would appear in the Planning Center plan item
  const formatted = formatSermonForPlanItem(sermonTitle, scripture);
  if (formatted) {
    console.log(`  Plan item format:  "Sermon - ${formatted}"`);
  } else {
    console.log('  Plan item format:  (nothing to append — no sermon info found)');
  }

  console.log('\n=== TEST COMPLETE ===');

  // Also dump nearby HTML context for debugging if title wasn't found
  if (!sermonTitle) {
    console.log('\n--- DEBUG: Searching for "This Sunday" in raw HTML ---');
    const idx = content.html.toLowerCase().indexOf('this sunday');
    if (idx >= 0) {
      const start = Math.max(0, idx - 200);
      const end = Math.min(content.html.length, idx + 800);
      console.log(`Found "This Sunday" at character ${idx}. Context:\n`);
      console.log(content.html.substring(start, end));
    } else {
      console.log('"This Sunday" not found anywhere in the newsletter HTML.');
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
