/**
 * update-sermon-info.js
 *
 * Fetches the latest Mailchimp newsletter, extracts the sermon title and
 * scripture reference from the "This Sunday" section, and writes them to
 * sermon-info.json so the Planning Center plan-item update can use them
 * at any time during the week (without needing to re-fetch the newsletter).
 *
 * Runs on Friday alongside the other newsletter-dependent steps.
 *
 * Environment variables:
 *   MAILCHIMP_API_KEY  – Mailchimp API key (e.g. abc123def456-us7)
 *   SKIP_DATE_CHECK    – Set to "true" to bypass the same-day check (for testing)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { extractSermonInfo, formatSermonForPlanItem } = require('./parse-sermon-info');

const API_KEY = process.env.MAILCHIMP_API_KEY;
const SKIP_DATE_CHECK = process.env.SKIP_DATE_CHECK === 'true';
const OUTPUT_FILE = path.resolve(__dirname, '..', 'sermon-info.json');

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

function isSentToday(sendTimeStr) {
  const sendDate = new Date(sendTimeStr);
  const now = new Date();
  const pragueOpts = { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' };
  const sendDatePrague = sendDate.toLocaleDateString('en-CA', pragueOpts);
  const nowPrague = now.toLocaleDateString('en-CA', pragueOpts);
  return sendDatePrague === nowPrague;
}

async function main() {
  console.log('=== UPDATE SERMON INFO ===\n');
  console.log(`Using Mailchimp data center: ${dc}`);

  // Fetch latest sent campaign
  console.log('Fetching most recent sent campaign...');
  const data = await mailchimpGet('/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent');
  if (!data.campaigns || data.campaigns.length === 0) {
    console.error('No sent campaigns found.');
    process.exit(1);
  }

  const campaign = data.campaigns[0];
  const sendTime = campaign.send_time || '';
  console.log(`Campaign: "${campaign.settings?.subject_line}" (ID: ${campaign.id})`);
  console.log(`  Sent: ${sendTime}`);

  // Same-day check
  if (!SKIP_DATE_CHECK && sendTime && !isSentToday(sendTime)) {
    console.error('\nThe latest campaign was NOT sent today. Sermon info will not be updated.');
    process.exit(1);
  }

  // Fetch campaign HTML
  console.log('Fetching campaign HTML content...');
  const content = await mailchimpGet(`/campaigns/${campaign.id}/content`);
  if (!content.html) {
    console.error('Campaign has no HTML content.');
    process.exit(1);
  }
  console.log(`  HTML length: ${content.html.length} bytes\n`);

  // Extract sermon info
  const { sermonTitle, scripture } = extractSermonInfo(content.html);
  const formatted = formatSermonForPlanItem(sermonTitle, scripture);

  console.log(`  Sermon Title: ${sermonTitle || '(not found)'}`);
  console.log(`  Scripture:    ${scripture || '(not found)'}`);
  console.log(`  Formatted:    ${formatted || '(nothing to write)'}`);

  // Write to JSON
  const result = {
    sermonTitle: sermonTitle || null,
    scripture: scripture || null,
    formatted: formatted || null,
    campaignSubject: campaign.settings?.subject_line || null,
    sendTime: sendTime,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  console.log('\nUpdated sermon-info.json successfully.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
