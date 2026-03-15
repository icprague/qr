/**
 * Export: PNG, PDF, Google Sheets.
 */
var Export = (function () {
  /** Export the dashboard div as a PNG download. */
  async function toPNG() {
    var el = document.getElementById('dashboard');
    var canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false
    });
    var link = document.createElement('a');
    link.download = 'icp-qr-analytics.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  /** Export the dashboard div as a PDF download. */
  async function toPDF() {
    var el = document.getElementById('dashboard');
    var canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false
    });
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
    var header = ['Button', 'Source', 'Clicks', 'Total Users', 'New Users'];
    var rows = [header];
    reportData.rows.forEach(function (r) {
      rows.push([r.label, r.sourceLabel, r.eventCount, r.totalUsers, r.newUsers]);
    });
    rows.push([]);
    rows.push(['Total', '', reportData.totals.eventCount, reportData.totals.totalUsers, reportData.totals.newUsers]);

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
    var range = 'Report!A1:E' + rows.length;
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
