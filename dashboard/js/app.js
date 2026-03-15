/**
 * Main application wiring.
 */
(function () {
  var _propertyId = null;
  var _currentPreset = null;
  var _currentDateConfig = null;
  var _lastReport = null;        // single-range report
  var _lastComparison = null;    // multi-range comparison data
  var _isComparison = false;

  // ── Bootstrap ──────────────────────────────────────────────────────
  async function boot() {
    try {
      var config = await AppConfig.load();
      _propertyId = config.GA_PROPERTY_ID;
      await Auth.init(config.OAUTH_CLIENT_ID, onSignIn, onSignOut);
    } catch (e) {
      console.error('Config load failed:', e);
      document.querySelector('.auth-card p').textContent =
        'Failed to load config. Check Vercel environment variables.';
    }
  }

  function onSignIn(token, email) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-email').textContent = email;
    // Default to "this Sunday"
    selectPreset('this-sunday');
  }

  function onSignOut() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    Charts.destroyAll();
  }

  // ── Date preset handling ───────────────────────────────────────────
  function selectPreset(key) {
    _currentPreset = key;
    var all = document.querySelectorAll('.preset-btn');
    all.forEach(function (btn) { btn.classList.toggle('active', btn.dataset.preset === key); });

    var customEl = document.getElementById('custom-range');
    if (key === 'custom') {
      customEl.classList.remove('hidden');
      return; // wait for Apply
    }
    customEl.classList.add('hidden');

    var presets = Dates.presets();
    if (presets[key]) {
      _currentDateConfig = presets[key];
      fetchAndRender();
    }
  }

  function applyCustomRange() {
    var start = document.getElementById('date-start').value;
    var end = document.getElementById('date-end').value;
    if (!start || !end) return;
    _currentDateConfig = Dates.customRange(start, end);
    fetchAndRender();
  }

  // ── Data fetching ──────────────────────────────────────────────────
  async function fetchAndRender() {
    var token = Auth.getToken();
    if (!token || !_currentDateConfig) return;

    showLoading(true);
    hideDashboard();

    try {
      if (_currentDateConfig.comparison) {
        await fetchComparison(token);
      } else {
        await fetchSingle(token);
      }
    } catch (e) {
      console.error('Fetch error:', e);
      alert('Error fetching data: ' + e.message);
    } finally {
      showLoading(false);
    }
  }

  async function fetchSingle(token) {
    var range = _currentDateConfig.ranges[0];
    var report = await GA.fetchReport(_propertyId, range.start, range.end, token);
    _lastReport = report;
    _isComparison = false;

    if (report.rows.length === 0) {
      document.getElementById('no-data').classList.remove('hidden');
      return;
    }

    renderSingle(report);
  }

  async function fetchComparison(token) {
    var ranges = _currentDateConfig.ranges;
    var results = {};
    // Fetch all ranges in parallel
    var promises = ranges.map(function (r) {
      return GA.fetchReport(_propertyId, r.start, r.end, token).then(function (report) {
        results[r.start] = report;
      });
    });
    await Promise.all(promises);

    _lastComparison = results;
    _isComparison = true;

    // Check if any data exists
    var hasData = Object.values(results).some(function (r) { return r.rows.length > 0; });
    if (!hasData) {
      document.getElementById('no-data').classList.remove('hidden');
      return;
    }

    renderComparison(results);
  }

  // ── Rendering: single range ────────────────────────────────────────
  function renderSingle(report) {
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('comparison-section').classList.add('hidden');

    // Date label
    document.getElementById('date-label').textContent = _currentDateConfig.label;

    // Summary cards
    renderSummaryCards(report.totals);

    // Charts
    var byEvent = GA.aggregateBy(report.rows, 'eventName', 'label');
    var bySource = GA.aggregateBy(report.rows, 'source', 'sourceLabel');
    Charts.renderButtonsChart(byEvent);
    Charts.renderUsersChart(byEvent);
    Charts.renderSourcesChart(bySource);

    // Detail table
    renderDetailTable(report.rows);
  }

  function renderSummaryCards(totals) {
    var container = document.getElementById('summary-cards');
    container.innerHTML = [
      card('Total Clicks', totals.eventCount),
      card('Total Users', totals.totalUsers),
      card('New Users', totals.newUsers)
    ].join('');
  }

  function card(label, value) {
    return '<div class="summary-card">' +
      '<div class="label">' + label + '</div>' +
      '<div class="value">' + value.toLocaleString() + '</div>' +
      '</div>';
  }

  function renderDetailTable(rows) {
    // Group by event, then list sources
    var byEvent = {};
    rows.forEach(function (r) {
      if (!byEvent[r.eventName]) byEvent[r.eventName] = [];
      byEvent[r.eventName].push(r);
    });

    var html = '<table><thead><tr>' +
      '<th>Button</th><th>Source</th><th>Clicks</th><th>Users</th><th>New</th>' +
      '</tr></thead><tbody>';

    GA.EVENT_NAMES.forEach(function (name) {
      var group = byEvent[name];
      if (!group) return;
      group.sort(function (a, b) { return b.eventCount - a.eventCount; });
      group.forEach(function (r, i) {
        html += '<tr><td>' + (i === 0 ? r.label : '') + '</td>' +
          '<td>' + r.sourceLabel + '</td>' +
          '<td>' + r.eventCount + '</td>' +
          '<td>' + r.totalUsers + '</td>' +
          '<td>' + r.newUsers + '</td></tr>';
      });
    });

    html += '</tbody></table>';
    document.getElementById('detail-table-wrap').innerHTML = html;
  }

  // ── Rendering: comparison (multi-Sunday) ───────────────────────────
  function renderComparison(results) {
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('comparison-section').classList.remove('hidden');

    document.getElementById('date-label').textContent = _currentDateConfig.label;

    // Aggregate totals across all dates
    var combinedTotals = { eventCount: 0, totalUsers: 0, newUsers: 0 };
    Object.values(results).forEach(function (r) {
      combinedTotals.eventCount += r.totals.eventCount;
      combinedTotals.totalUsers += r.totals.totalUsers;
      combinedTotals.newUsers += r.totals.newUsers;
    });
    renderSummaryCards(combinedTotals);

    // Combined charts (aggregate all dates for the bar/doughnut)
    var allRows = [];
    Object.values(results).forEach(function (r) { allRows = allRows.concat(r.rows); });
    var byEvent = GA.aggregateBy(allRows, 'eventName', 'label');
    var bySource = GA.aggregateBy(allRows, 'source', 'sourceLabel');
    Charts.renderButtonsChart(byEvent);
    Charts.renderUsersChart(byEvent);
    Charts.renderSourcesChart(bySource);

    // Per-date aggregation for comparison chart
    var dataPerDate = {};
    var dates = Object.keys(results).sort();
    dates.forEach(function (d) {
      var map = {};
      var agg = GA.aggregateBy(results[d].rows, 'eventName', 'label');
      agg.forEach(function (e) { map[e.key] = e; });
      dataPerDate[d] = map;
    });

    // Determine which events appear in any date
    var eventSet = {};
    Object.values(dataPerDate).forEach(function (map) {
      Object.keys(map).forEach(function (k) { eventSet[k] = true; });
    });
    var eventNames = GA.EVENT_NAMES.filter(function (n) { return eventSet[n]; });

    Charts.renderComparisonChart(eventNames, dataPerDate);
    renderComparisonTable(eventNames, dataPerDate, dates);

    // Detail table with all rows combined
    renderDetailTable(allRows);
  }

  function renderComparisonTable(eventNames, dataPerDate, dates) {
    var html = '<table><thead><tr><th>Button</th>';
    dates.forEach(function (d) { html += '<th>' + Dates.shortLabel(d) + '</th>'; });
    html += '</tr></thead><tbody>';

    eventNames.forEach(function (name) {
      html += '<tr><td>' + (GA.LABELS[name] || name) + '</td>';
      dates.forEach(function (d) {
        var entry = dataPerDate[d][name];
        html += '<td>' + (entry ? entry.eventCount : 0) + '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('comparison-table-wrap').innerHTML = html;
  }

  // ── UI helpers ─────────────────────────────────────────────────────
  function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
  }

  function hideDashboard() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('no-data').classList.add('hidden');
  }

  // ── Event listeners ────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    boot();

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectPreset(btn.dataset.preset);
      });
    });

    // Custom range apply
    document.getElementById('btn-apply-range').addEventListener('click', applyCustomRange);

    // Exports
    document.getElementById('btn-export-png').addEventListener('click', function () {
      Export.toPNG().catch(function (e) { alert('PNG export failed: ' + e.message); });
    });

    document.getElementById('btn-export-pdf').addEventListener('click', function () {
      Export.toPDF().catch(function (e) { alert('PDF export failed: ' + e.message); });
    });

    document.getElementById('btn-export-sheets').addEventListener('click', function () {
      var token = Auth.getToken();
      if (!token) { alert('Please sign in first.'); return; }

      if (_isComparison && _lastComparison) {
        var dataPerDate = {};
        var dates = Object.keys(_lastComparison).sort();
        dates.forEach(function (d) {
          var map = {};
          GA.aggregateBy(_lastComparison[d].rows, 'eventName', 'label')
            .forEach(function (e) { map[e.key] = e; });
          dataPerDate[d] = map;
        });
        var eventSet = {};
        Object.values(dataPerDate).forEach(function (m) {
          Object.keys(m).forEach(function (k) { eventSet[k] = true; });
        });
        var eventNames = GA.EVENT_NAMES.filter(function (n) { return eventSet[n]; });
        Export.toSheetsComparison(token, eventNames, dataPerDate, _currentDateConfig.label)
          .catch(function (e) { alert('Sheets export failed: ' + e.message); });
      } else if (_lastReport) {
        Export.toSheets(token, _lastReport, _currentDateConfig.label)
          .catch(function (e) { alert('Sheets export failed: ' + e.message); });
      }
    });
  });
})();
