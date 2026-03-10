/**
 * update-plan-items.js
 *
 * Writes the moderator's name into every Planning Center plan item whose
 * title contains "(Moderator...)" for the upcoming Sunday's service.
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

const { updateModeratorInPlanItems } = require('./planning-center');

async function main() {
  const { moderatorName, worshipLeaderName, updatedCount } = await updateModeratorInPlanItems();

  console.log(`\nDone. Moderator: ${moderatorName || 'not assigned'}. Worship leader: ${worshipLeaderName || 'not assigned'}. ${updatedCount} item(s) updated.`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
