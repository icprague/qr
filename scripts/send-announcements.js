/**
 * send-announcements.js
 *
 * 1. Fetches the latest Mailchimp newsletter from the campaign archive.
 * 2. Parses the HTML to extract headings and content.
 * 3. Calls Planning Center API to find the upcoming Sunday moderator's email.
 * 4. Generates a styled HTML announcements document.
 * 5. Sends the document as an email via Gmail SMTP.
 *
 * Environment variables (set as GitHub Secrets):
 *   MAILCHIMP_ARCHIVE_URL    – Campaign archive page URL
 *   PLANNING_CENTER_APP_ID   – Planning Center API application ID
 *   PLANNING_CENTER_SECRET   – Planning Center API secret
 *   GMAIL_USER               – Gmail address used to send email
 *   GMAIL_APP_PASSWORD       – Gmail app password
 *   CC_EMAIL                 – Email address to CC on announcements
 */

const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'MAILCHIMP_ARCHIVE_URL',
  'PLANNING_CENTER_APP_ID',
  'PLANNING_CENTER_SECRET',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Error: ${key} environment variable is not set.`);
    process.exit(1);
  }
}

const {
  MAILCHIMP_ARCHIVE_URL,
  PLANNING_CENTER_APP_ID,
  PLANNING_CENTER_SECRET,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  CC_EMAIL,
} = process.env;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple HTTP(S) GET with redirect following. */
function fetch(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const reqOptions = { ...parseUrl(url), ...options };
    client
      .get(reqOptions, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let next = res.headers.location;
          if (next.startsWith('/')) {
            const base = `${reqOptions.protocol || 'https:'}//${reqOptions.hostname}`;
            next = base + next;
          }
          return resolve(fetch(next, options, redirects + 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
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

/** Get the date of the upcoming Sunday (or today if already Sunday). */
function getUpcomingSunday() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Step 1: Fetch latest newsletter URL from Mailchimp archive
// ---------------------------------------------------------------------------

async function fetchLatestNewsletterUrl() {
  console.log('Fetching Mailchimp campaign archive...');
  const html = await fetch(MAILCHIMP_ARCHIVE_URL);

  const linkPatterns = [
    /href="(https?:\/\/mailchi\.mp\/[^"]+)"/i,
    /href="(https?:\/\/[^"]*campaign-archive\.com\/\?[^"]+)"/i,
  ];

  for (const pattern of linkPatterns) {
    const match = pattern.exec(html);
    if (match) return match[1];
  }

  throw new Error('Could not find latest newsletter link on archive page.');
}

// ---------------------------------------------------------------------------
// Step 2: Fetch newsletter and extract content
// ---------------------------------------------------------------------------

async function parseNewsletter(url) {
  console.log(`Fetching newsletter: ${url}`);
  const html = await fetch(url);
  const $ = cheerio.load(html);

  const sections = [];

  // Mailchimp newsletters typically use <h1>–<h4> for section headings
  // and <p>, <ul>/<li> for content. We walk through the body content.
  const contentSelectors = [
    'td.mcnTextContent',         // Classic Mailchimp templates
    '.templateContainer',         // Newer templates
    '#templateBody',              // Another common wrapper
    'body',                       // Fallback to full body
  ];

  let $content = null;
  for (const sel of contentSelectors) {
    if ($(sel).length) {
      $content = $(sel);
      break;
    }
  }

  if (!$content) {
    throw new Error('Could not locate content in newsletter HTML.');
  }

  // Walk through headings and collect their following content
  $content.find('h1, h2, h3, h4, strong').each((_, el) => {
    const $el = $(el);
    const headingText = $el.text().trim();
    if (!headingText || headingText.length > 200) return;

    const contentParts = [];
    let $next = $el.parent().is('td, div') ? $el.nextAll() : $el.parent().nextAll();

    $next.each((__, sibling) => {
      const $sib = $(sibling);
      const tagName = $sib.prop('tagName');

      // Stop when we hit the next heading
      if (tagName && /^H[1-4]$/.test(tagName)) return false;
      if ($sib.find('h1, h2, h3, h4').length) return false;

      const text = $sib.text().trim();
      if (text) {
        // Check if it's a list
        if (tagName === 'UL' || tagName === 'OL') {
          $sib.find('li').each((___, li) => {
            const liText = $(li).text().trim();
            if (liText) contentParts.push({ type: 'bullet', text: liText });
          });
        } else {
          contentParts.push({ type: 'paragraph', text });
        }
      }
    });

    if (contentParts.length > 0 || headingText.length > 3) {
      sections.push({ heading: headingText, content: contentParts });
    }
  });

  // Fallback: if no structured sections found, grab all text blocks
  if (sections.length === 0) {
    console.log('No structured sections found. Extracting raw text blocks...');
    $content.find('p, li').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 10) {
        sections.push({
          heading: '',
          content: [{ type: 'paragraph', text }],
        });
      }
    });
  }

  console.log(`Extracted ${sections.length} sections from newsletter.`);
  return sections;
}

// ---------------------------------------------------------------------------
// Step 3: Get moderator email from Planning Center
// ---------------------------------------------------------------------------

async function getModeratorEmail() {
  const sunday = getUpcomingSunday();
  const dateStr = sunday.toISOString().split('T')[0]; // YYYY-MM-DD

  const authHeader =
    'Basic ' + Buffer.from(`${PLANNING_CENTER_APP_ID}:${PLANNING_CENTER_SECRET}`).toString('base64');

  const headers = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
  };

  console.log(`Looking up Planning Center service plans around ${dateStr}...`);

  // 1. Get service types
  const serviceTypesRaw = await fetch(
    'https://api.planningcenteronline.com/services/v2/service_types',
    { headers }
  );
  const serviceTypes = JSON.parse(serviceTypesRaw);
  if (!serviceTypes.data || serviceTypes.data.length === 0) {
    throw new Error('No service types found in Planning Center.');
  }

  // Use the first service type (primary worship service)
  const serviceTypeId = serviceTypes.data[0].id;
  console.log(`Using service type: ${serviceTypes.data[0].attributes.name} (${serviceTypeId})`);

  // 2. Get upcoming plans
  const plansRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=5`,
    { headers }
  );
  const plans = JSON.parse(plansRaw);

  if (!plans.data || plans.data.length === 0) {
    throw new Error('No upcoming plans found in Planning Center.');
  }

  // Find the plan closest to the upcoming Sunday
  let targetPlan = plans.data[0]; // Default to first upcoming plan
  for (const plan of plans.data) {
    const planDate = plan.attributes.sort_date || plan.attributes.dates;
    if (planDate && planDate.startsWith(dateStr)) {
      targetPlan = plan;
      break;
    }
  }

  console.log(`Using plan: ${targetPlan.attributes.dates} (ID: ${targetPlan.id})`);

  // 3. Get team members for this plan
  const teamMembersRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${targetPlan.id}/team_members`,
    { headers }
  );
  const teamMembers = JSON.parse(teamMembersRaw);

  if (!teamMembers.data || teamMembers.data.length === 0) {
    throw new Error('No team members found for the upcoming plan.');
  }

  // Look for someone with a "Moderator" or "MC" or "Host" position
  const moderatorKeywords = ['moderator', 'mc', 'host', 'emcee', 'worship leader'];
  let moderator = null;

  for (const member of teamMembers.data) {
    const position = (member.attributes.team_position_name || '').toLowerCase();
    if (moderatorKeywords.some((kw) => position.includes(kw))) {
      moderator = member;
      break;
    }
  }

  if (!moderator) {
    console.log('No moderator role found. Available positions:');
    teamMembers.data.forEach((m) => {
      console.log(`  - ${m.attributes.name}: ${m.attributes.team_position_name}`);
    });
    // Fall back to first team member or CC_EMAIL
    console.log('Falling back to CC_EMAIL as recipient.');
    return CC_EMAIL || GMAIL_USER;
  }

  // 4. Get the person's email from their People record
  const personId = moderator.relationships?.person?.data?.id;
  if (!personId) {
    console.log('Could not find person ID for moderator. Falling back to CC_EMAIL.');
    return CC_EMAIL || GMAIL_USER;
  }

  const personRaw = await fetch(
    `https://api.planningcenteronline.com/services/v2/people/${personId}/emails`,
    { headers }
  );

  // Try the services people endpoint first
  let emails;
  try {
    emails = JSON.parse(personRaw);
  } catch {
    emails = { data: [] };
  }

  if (emails.data && emails.data.length > 0) {
    const email = emails.data[0].attributes.address;
    console.log(`Found moderator: ${moderator.attributes.name} (${email})`);
    return email;
  }

  // Try the People API for email
  try {
    const peopleEmailRaw = await fetch(
      `https://api.planningcenteronline.com/people/v2/people/${personId}/emails`,
      { headers }
    );
    const peopleEmails = JSON.parse(peopleEmailRaw);
    if (peopleEmails.data && peopleEmails.data.length > 0) {
      const email = peopleEmails.data[0].attributes.address;
      console.log(`Found moderator: ${moderator.attributes.name} (${email})`);
      return email;
    }
  } catch (err) {
    console.log(`People API lookup failed: ${err.message}`);
  }

  console.log('Could not find email for moderator. Falling back to CC_EMAIL.');
  return CC_EMAIL || GMAIL_USER;
}

// ---------------------------------------------------------------------------
// Step 4: Generate HTML announcements document
// ---------------------------------------------------------------------------

function generateAnnouncementsHtml(sections, sundayDate) {
  const dateFormatted = formatDate(sundayDate);

  const sectionHtml = sections
    .map((s) => {
      const heading = s.heading
        ? `<h2 style="font-family:'Raleway',sans-serif;font-weight:700;font-size:14pt;color:#222A58;margin:20px 0 8px 0;">${escapeHtml(s.heading)}</h2>`
        : '';
      const content = s.content
        .map((c) => {
          if (c.type === 'bullet') {
            return `<li style="font-family:'Lato',sans-serif;font-size:11pt;color:#181C3A;margin-bottom:4px;">${escapeHtml(c.text)}</li>`;
          }
          return `<p style="font-family:'Lato',sans-serif;font-size:11pt;color:#181C3A;margin:0 0 8px 0;">${escapeHtml(c.text)}</p>`;
        })
        .join('\n');

      // Wrap bullet items in <ul>
      const hasBullets = s.content.some((c) => c.type === 'bullet');
      const wrappedContent = hasBullets
        ? `<ul style="margin:8px 0 8px 20px;padding:0;">${content}</ul>`
        : content;

      return heading + wrappedContent;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sunday Announcements – ${escapeHtml(formatDateShort(sundayDate))}</title>
  <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
</head>
<body style="max-width:700px;margin:0 auto;padding:30px 20px;background:#ffffff;">
  <h1 style="font-family:'Raleway',sans-serif;font-weight:700;font-size:16pt;color:#222A58;text-align:center;margin:0 0 4px 0;">
    SUNDAY ANNOUNCEMENTS
  </h1>
  <p style="font-family:'Lato',sans-serif;font-size:12pt;color:#444;text-align:center;font-style:italic;margin:0 0 30px 0;">
    ${escapeHtml(dateFormatted)}
  </p>
  <hr style="border:none;border-top:2px solid #222A58;margin:0 0 20px 0;">
  ${sectionHtml}
  <hr style="border:none;border-top:1px solid #ccc;margin:30px 0 10px 0;">
  <p style="font-family:'Lato',sans-serif;font-size:9pt;color:#999;text-align:center;">
    Auto-generated from the weekly newsletter &bull; International Church of Prague
  </p>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Step 5: Send email via Gmail SMTP
// ---------------------------------------------------------------------------

async function sendEmail(recipientEmail, htmlContent, sundayDate) {
  const dateStr = formatDateShort(sundayDate);
  const subject = `Sunday Announcements Ready – ${dateStr}`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  const mailOptions = {
    from: `"International Church of Prague" <${GMAIL_USER}>`,
    to: recipientEmail,
    cc: CC_EMAIL || undefined,
    subject,
    html: htmlContent,
  };

  console.log(`Sending email to: ${recipientEmail}`);
  if (CC_EMAIL) console.log(`CC: ${CC_EMAIL}`);

  const info = await transporter.sendMail(mailOptions);
  console.log(`Email sent successfully. Message ID: ${info.messageId}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sundayDate = getUpcomingSunday();
  console.log(`Preparing announcements for ${formatDate(sundayDate)}\n`);

  // Step 1 & 2: Fetch and parse newsletter
  const newsletterUrl = await fetchLatestNewsletterUrl();
  const sections = await parseNewsletter(newsletterUrl);

  if (sections.length === 0) {
    console.log('Warning: No content sections extracted from newsletter.');
    console.log('Sending a notification email about the empty extraction.');
  }

  // Step 3: Get moderator email
  let moderatorEmail;
  try {
    moderatorEmail = await getModeratorEmail();
  } catch (err) {
    console.error(`Planning Center lookup failed: ${err.message}`);
    console.log('Falling back to CC_EMAIL / GMAIL_USER as recipient.');
    moderatorEmail = CC_EMAIL || GMAIL_USER;
  }

  // Step 4: Generate HTML
  const htmlContent = generateAnnouncementsHtml(sections, sundayDate);

  // Step 5: Send email
  await sendEmail(moderatorEmail, htmlContent, sundayDate);

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
