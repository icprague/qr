/**
 * Export: PNG, PDF, Google Sheets.
 */
var Export = (function () {
  var PADDING = 40; // px padding around exported content

  /** Get the date label currently shown in the dashboard. */
  function getDateLabel() {
    var el = document.getElementById('date-label');
    return el ? el.textContent : '';
  }

  /** Create a wrapper with title + padding for export, capture it, then clean up. */
  async function captureWithTitle() {
    var dashboard = document.getElementById('dashboard');
    var dateLabel = getDateLabel();

    // Create export wrapper
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: ' + PADDING + 'px; background: #fff; display: inline-block;';

    // Title
    var title = document.createElement('div');
    title.style.cssText = 'font-family: Inter, system-ui, sans-serif; margin-bottom: 24px; text-align: center;';
    title.innerHTML = '<div style="font-size: 24px; font-weight: 700; color: #1a1a2e;">QR Code Analytics</div>' +
      '<div style="font-size: 14px; color: #666; margin-top: 6px;">' + dateLabel + '</div>';

    wrapper.appendChild(title);

    // Clone the dashboard so we don't disturb the live DOM
    var clone = dashboard.cloneNode(true);
    clone.style.display = 'block';
    wrapper.appendChild(clone);

    // Append off-screen for html2canvas to render
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-9999px';
    wrapper.style.top = '0';
    document.body.appendChild(wrapper);

    // Need to re-draw charts on the cloned canvases — html2canvas can't capture
    // WebGL/canvas content from clones, so capture from the live dashboard instead.
    // Remove wrapper and use a different approach: inject title into live DOM temporarily.
    document.body.removeChild(wrapper);

    // Inject title before dashboard content temporarily
    var titleEl = document.createElement('div');
    titleEl.id = '_export-title';
    titleEl.style.cssText = 'text-align: center; margin-bottom: 24px;';
    titleEl.innerHTML = '<div style="font-size: 24px; font-weight: 700; color: #1a1a2e;">QR Code Analytics</div>' +
      '<div style="font-size: 14px; color: #666; margin-top: 6px;">' + dateLabel + '</div>';
    dashboard.insertBefore(titleEl, dashboard.firstChild);

    // Add padding to dashboard temporarily
    var origPadding = dashboard.style.padding;
    dashboard.style.padding = PADDING + 'px';

    var canvas = await html2canvas(dashboard, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false
    });

    // Clean up
    dashboard.removeChild(titleEl);
    dashboard.style.padding = origPadding;

    return canvas;
  }

  /** Export the dashboard div as a PNG download. */
  async function toPNG() {
    var canvas = await captureWithTitle();
    var link = document.createElement('a');
    link.download = 'icp-qr-analytics.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  /** Export the dashboard div as a PDF download. */
  async function toPDF() {
    var canvas = await captureWithTitle();
    var imgData = canvas.toDataURL('image/png');
    var pdf = new jspdf.jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height]
    });
    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save('icp-qr-analytics.pdf');
  }

  /**
   * Export data to a new Google Sheet.
   * Requires an active OAuth token with spreadsheets scope.
   */
  async function toSheets(token, reportData, dateLabel) {
    // Build rows for the sheet
    var header = ['Button', 'Source', 'Clicks', 'Total Users'];
    var rows = [header];
    reportData.rows.forEach(function (r) {
      rows.push([r.label, r.sourceLabel, r.eventCount, r.totalUsers]);
    });
    rows.push([]);
    rows.push(['Total', '', reportData.totals.eventCount, reportData.totals.totalUsers]);

    // Add new vs returning summary
    if (reportData.byButton && reportData.byButton.length > 0) {
      rows.push([]);
      rows.push(['Button', 'New Visitors', 'Returning']);
      reportData.byButton.forEach(function (b) {
        rows.push([b.label, b.newUsers || 0, b.returningUsers || 0]);
      });
      rows.push(['Total', reportData.totals.newUsers || 0, reportData.totals.returningUsers || 0]);
    }

    var title = 'ICP QR Analytics — ' + dateLabel;

    // Create spreadsheet
    var createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { title: title },
        sheets: [{ properties: { title: 'Report' } }]
      })
    });

    if (!createResp.ok) throw new Error('Failed to create spreadsheet');
    var sheet = await createResp.json();
    var spreadsheetId = sheet.spreadsheetId;

    // Write data
    // Determine widest row for range
    var maxCols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var range = 'Report!A1:' + String.fromCharCode(64 + maxCols) + rows.length;
    var updateResp = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId +
      '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW',
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ range: range, majorDimension: 'ROWS', values: rows })
      }
    );

    if (!updateResp.ok) throw new Error('Failed to write to spreadsheet');

    // Open the new sheet in a new tab
    window.open('https://docs.google.com/spreadsheets/d/' + spreadsheetId, '_blank');
  }

  /**
   * Export comparison data (multi-Sunday) to a Google Sheet.
   */
  async function toSheetsComparison(token, eventNames, dataPerDate, dateLabel) {
    var dates = Object.keys(dataPerDate).sort();
    var header = ['Button'].concat(dates.map(function (d) { return Dates.shortLabel(d) + ' clicks'; }));
    var rows = [header];

    eventNames.forEach(function (name) {
      var row = [GA.LABELS[name] || name];
      dates.forEach(function (d) {
        var entry = dataPerDate[d][name];
        row.push(entry ? entry.eventCount : 0);
      });
      rows.push(row);
    });

    var title = 'ICP QR Analytics — ' + dateLabel;
    var createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { title: title },
        sheets: [{ properties: { title: 'Comparison' } }]
      })
    });

    if (!createResp.ok) throw new Error('Failed to create spreadsheet');
    var sheet = await createResp.json();
    var spreadsheetId = sheet.spreadsheetId;

    var range = 'Comparison!A1:' + String.fromCharCode(65 + dates.length) + rows.length;
    var updateResp = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId +
      '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW',
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ range: range, majorDimension: 'ROWS', values: rows })
      }
    );

    if (!updateResp.ok) throw new Error('Failed to write to spreadsheet');
    window.open('https://docs.google.com/spreadsheets/d/' + spreadsheetId, '_blank');
  }

  return { toPNG: toPNG, toPDF: toPDF, toSheets: toSheets, toSheetsComparison: toSheetsComparison };
})();
