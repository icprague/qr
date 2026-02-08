/**
 * update-newsletter-link.js
 *
 * Uses the Mailchimp Marketing API to fetch the most recent sent campaign
 * and writes its archive URL to newsletter-link.json.
 *
 * Environment variables:
 *   MAILCHIMP_API_KEY – Mailchimp API key (e.g. abc123def456-us7)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.MAILCHIMP_API_KEY;
const OUTPUT_FILE = path.resolve(__dirname, '..', 'newsletter-link.json');

if (!API_KEY) {
  console.error('Error: MAILCHIMP_API_KEY environment variable is not set.');
  process.exit(1);
}

// Extract data center from API key (the part after the dash, e.g. "us7")
const dc = API_KEY.split('-').pop();

function mailchimpGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${dc}.api.mailchimp.com`,
      path: `/3.0${endpoint}`,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    };

    https
      .get(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`Mailchimp API ${res.statusCode}: ${body}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse Mailchimp response: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

async function main() {
  console.log(`Using Mailchimp data center: ${dc}`);
  console.log('Fetching most recent sent campaign...');

  const data = await mailchimpGet(
    '/campaigns?sort_field=send_time&sort_dir=DESC&count=1&status=sent'
  );

  if (!data.campaigns || data.campaigns.length === 0) {
    console.error('Error: No sent campaigns found in Mailchimp.');
    process.exit(1);
  }

  const campaign = data.campaigns[0];
  const archiveUrl = campaign.archive_url;
  const subject = campaign.settings?.subject_line || '(no subject)';
  const sendTime = campaign.send_time || '';

  console.log(`Latest campaign: "${subject}"`);
  console.log(`  Sent: ${sendTime}`);
  console.log(`  Archive URL: ${archiveUrl}`);

  if (!archiveUrl) {
    console.error('Error: Campaign has no archive_url.');
    process.exit(1);
  }

  const result = {
    url: archiveUrl,
    subject: subject,
    sendTime: sendTime,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  console.log('\nUpdated newsletter-link.json successfully.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
