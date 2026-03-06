/**
 * update-plan-items.js
 *
 * Updates Planning Center plan items for the upcoming Sunday's service:
 *   1. Writes the moderator's name into items with "(Moderator...)" in the title
 *   2. Writes the sermon title + scripture into the "Sermon" item
 *      (reads from sermon-info.json, which is updated on Friday by update-sermon-info.js)
 *
 * Run directly:
 *   PLANNING_CENTER_APP_ID=... PLANNING_CENTER_SECRET=... node scripts/update-plan-items.js
 *
 * Or via the GitHub Actions workflows:
 *   - update-plan-items.yml  (Tuesday morning, Saturday evening, manual)
 *   - send-announcements.yml (Friday, after the editors email)
 *
 * Environment variables (required):
 *   PLANNING_CENTER_APP_ID  – Planning Center API application ID
 *   PLANNING_CENTER_SECRET  – Planning Center API secret
 */

const { updateModeratorInPlanItems, updateSermonInPlanItems } = require('./planning-center');

async function main() {
  // Update moderator name
  console.log('=== MODERATOR UPDATE ===');
  const { moderatorName, updatedCount } = await updateModeratorInPlanItems();

  if (moderatorName) {
    console.log(`\nModerator: ${moderatorName}. ${updatedCount} item(s) updated.`);
  } else {
    console.log(`\nNo moderator scheduled. ${updatedCount} item(s) updated.`);
  }

  // Update sermon title from newsletter
  console.log('\n=== SERMON UPDATE ===');
  const sermon = await updateSermonInPlanItems();

  if (sermon.formatted) {
    console.log(`\nSermon: ${sermon.formatted}. ${sermon.updatedCount} item(s) updated.`);
  } else {
    console.log('\nNo sermon info available.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
