/**
 * Main application wiring.
 */
(function () {
  var _propertyId = null;
  var _currentPreset = null;
  var _currentDateConfig = null;
  var _lastReport = null;
  var _lastComparison = null;
  var _isComparison = false;

  // Cached aggregations for toggle re-renders
  var _byEvent = null;
  var _bySource = null;
  var _visitorsBySource = null;
  var _allRows = null;

  // Toggle state
  var _showNvr = false;
  var _sourcesView = 'sessions'; // 'sessions' | 'users' | 'buttons'

  // ── Bootstrap ──────────────────────────────────────────────────────
  async function boot() {
    try {
      var config = await AppConfig.load();
      _propertyId = config.GA_PROPERTY_ID;
      await Auth.init(config.OAUTH_CLIENT_ID, onSignIn, onSignOut);
    } catch (e) {
      console.error('Boot failed:', e);
      document.querySelector('.auth-card p').textContent =
        'Error: ' + e.message;
    }
  }

  function onSignIn(token, email) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-email').textContent = email;
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
      return;
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

    // Fetch averages for sunday/midweek presets
    var averages = null;
    if (_currentPreset === 'this-sunday' || _currentPreset === 'last-sunday') {
      averages = await fetchAverages(token, 'sunday', _currentDateConfig.ranges[0]);
    } else if (_currentPreset === 'this-midweek' || _currentPreset === 'last-midweek') {
      averages = await fetchAverages(token, 'midweek', _currentDateConfig.ranges[0]);
    }

    renderSingle(report, averages);
  }

  async function fetchAverages(token, type, currentRange) {
    var ranges = type === 'sunday' ? Dates.allSundayRanges() : Dates.allMidweekRanges();

    // Only average dates strictly before the current date being viewed so that
    // (a) the current week is never part of its own baseline, and
    // (b) the very first Sunday has no prior data → returns null → no % badges.
    if (currentRange) {
      ranges = ranges.filter(function (r) { return r.start < currentRange.start; });
    }

    if (ranges.length === 0) return null;

    var results = [];
    for (var i = 0; i < ranges.length; i++) {
      results.push(await GA.fetchReport(_propertyId, ranges[i].start, ranges[i].end, token));
    }

    var count = results.length;
    var avgTotals = { eventCount: 0, totalUsers: 0, newUsers: 0, returningUsers: 0 };
    var avgVisitors = { totalUsers: 0, newUsers: 0, returningUsers: 0 };
    var buttonSums = {};

    results.forEach(function (r) {
      avgTotals.eventCount += r.totals.eventCount;
      avgTotals.totalUsers += r.totals.totalUsers;
      avgTotals.newUsers += (r.totals.newUsers || 0);
      avgTotals.returningUsers += (r.totals.returningUsers || 0);
      if (r.visitors) {
        avgVisitors.totalUsers += r.visitors.totalUsers;
        avgVisitors.newUsers += r.visitors.newUsers;
        avgVisitors.returningUsers += r.visitors.returningUsers;
      }
      (r.byButton || []).forEach(function (b) {
        if (!buttonSums[b.key]) {
          buttonSums[b.key] = { totalUsers: 0, newUsers: 0, returningUsers: 0, eventCount: 0 };
        }
        buttonSums[b.key].totalUsers += b.totalUsers;
        buttonSums[b.key].newUsers += (b.newUsers || 0);
        buttonSums[b.key].returningUsers += (b.returningUsers || 0);
        buttonSums[b.key].eventCount += b.eventCount;
      });
    });

    avgTotals.eventCount /= count;
    avgTotals.totalUsers /= count;
    avgTotals.newUsers /= count;
    avgTotals.returningUsers /= count;
    avgVisitors.totalUsers /= count;
    avgVisitors.newUsers /= count;
    avgVisitors.returningUsers /= count;

    var avgByButton = {};
    Object.keys(buttonSums).forEach(function (k) {
      avgByButton[k] = {
        totalUsers: buttonSums[k].totalUsers / count,
        newUsers: buttonSums[k].newUsers / count,
        returningUsers: buttonSums[k].returningUsers / count,
        eventCount: buttonSums[k].eventCount / count
      };
    });

    return { totals: avgTotals, visitors: avgVisitors, byButton: avgByButton, count: count };
  }

  async function fetchComparison(token) {
    var ranges = _currentDateConfig.ranges;
    var results = {};
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      results[r.start] = await GA.fetchReport(_propertyId, r.start, r.end, token);
    }

    _lastComparison = results;
    _isComparison = true;

    var hasData = Object.values(results).some(function (r) { return r.rows.length > 0; });
    if (!hasData) {
      document.getElementById('no-data').classList.remove('hidden');
      return;
    }

    renderComparison(results);
  }

  // ── Rendering: single range ────────────────────────────────────────
  // Store current averages for toggle re-renders
  var _currentAverages = null;

  function renderSingle(report, averages) {
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('comparison-section').classList.add('hidden');
    document.getElementById('date-label').textContent = _currentDateConfig.label;

    _byEvent = report.byButton.length > 0
      ? report.byButton
      : GA.aggregateBy(report.rows, 'eventName', 'label');
    _bySource = report.bySource.length > 0
      ? report.bySource
      : GA.aggregateBy(report.rows, 'source', 'sourceLabel');
    _visitorsBySource = report.visitorsBySource || [];
    _allRows = report.rows;
    _currentAverages = averages;

    renderSummaryCards(report.totals, _byEvent, report.visitors, averages);
    Charts.renderUsersChart(_byEvent, _showNvr, averages);
    renderSourcesView();
  }

  // ── Rendering: comparison ──────────────────────────────────────────
  function renderComparison(results) {
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('comparison-section').classList.remove('hidden');
    document.getElementById('date-label').textContent = _currentDateConfig.label;
    _currentAverages = null;

    var combinedTotals = { eventCount: 0, totalUsers: 0, newUsers: 0, returningUsers: 0 };
    var combinedVisitors = { totalUsers: 0, newUsers: 0, returningUsers: 0 };
    var allRows = [];
    var allByButton = [];
    var allBySource = [];
    var allVisitorsBySource = [];
    Object.values(results).forEach(function (r) {
      combinedTotals.eventCount += r.totals.eventCount;
      combinedTotals.totalUsers += r.totals.totalUsers;
      combinedTotals.newUsers += (r.totals.newUsers || 0);
      combinedTotals.returningUsers += (r.totals.returningUsers || 0);
      if (r.visitors) {
        combinedVisitors.totalUsers += r.visitors.totalUsers;
        combinedVisitors.newUsers += r.visitors.newUsers;
        combinedVisitors.returningUsers += r.visitors.returningUsers;
      }
      allRows = allRows.concat(r.rows);
      if (r.byButton) allByButton = allByButton.concat(r.byButton);
      if (r.bySource) allBySource = allBySource.concat(r.bySource);
      if (r.visitorsBySource) allVisitorsBySource = allVisitorsBySource.concat(r.visitorsBySource);
    });

    // Aggregate deduplicated per-button data across dates
    var byButtonMap = {};
    allByButton.forEach(function (b) {
      if (!byButtonMap[b.key]) {
        byButtonMap[b.key] = { key: b.key, label: b.label, eventCount: 0, totalUsers: 0, newUsers: 0, returningUsers: 0 };
      }
      byButtonMap[b.key].eventCount += b.eventCount;
      byButtonMap[b.key].totalUsers += b.totalUsers;
      byButtonMap[b.key].newUsers += (b.newUsers || 0);
      byButtonMap[b.key].returningUsers += (b.returningUsers || 0);
    });
    var combinedByButton = GA.EVENT_NAMES.filter(function (n) { return byButtonMap[n]; })
      .map(function (n) { return byButtonMap[n]; });

    // Aggregate deduplicated per-source data across dates
    var bySourceMap = {};
    allBySource.forEach(function (s) {
      if (!bySourceMap[s.key]) {
        bySourceMap[s.key] = { key: s.key, label: s.label, eventCount: 0, totalUsers: 0 };
      }
      bySourceMap[s.key].eventCount += s.eventCount;
      bySourceMap[s.key].totalUsers += s.totalUsers;
    });
    var combinedBySource = Object.values(bySourceMap).sort(function (a, b) {
      return b.eventCount - a.eventCount;
    });

    // Aggregate visitor-by-source across dates
    var visBySourceMap = {};
    allVisitorsBySource.forEach(function (s) {
      if (!visBySourceMap[s.key]) {
        visBySourceMap[s.key] = { key: s.key, label: s.label, eventCount: 0, totalUsers: 0 };
      }
      visBySourceMap[s.key].eventCount += s.eventCount;
      visBySourceMap[s.key].totalUsers += s.totalUsers;
    });
    var combinedVisitorsBySource = Object.values(visBySourceMap).sort(function (a, b) {
      return b.totalUsers - a.totalUsers;
    });

    _byEvent = combinedByButton.length > 0
      ? combinedByButton
      : GA.aggregateBy(allRows, 'eventName', 'label');
    _bySource = combinedBySource.length > 0
      ? combinedBySource
      : GA.aggregateBy(allRows, 'source', 'sourceLabel');
    _visitorsBySource = combinedVisitorsBySource;
    _allRows = allRows;

    renderSummaryCards(combinedTotals, _byEvent, combinedVisitors);
    Charts.renderUsersChart(_byEvent, _showNvr);
    renderSourcesView();

    // Per-date comparison chart
    var dataPerDate = {};
    var dates = Object.keys(results).sort();
    dates.forEach(function (d) {
      var map = {};
      GA.aggregateBy(results[d].rows, 'eventName', 'label')
        .forEach(function (e) { map[e.key] = e; });
      dataPerDate[d] = map;
    });

    var eventSet = {};
    Object.values(dataPerDate).forEach(function (map) {
      Object.keys(map).forEach(function (k) { eventSet[k] = true; });
    });
    var eventNames = GA.EVENT_NAMES.filter(function (n) { return eventSet[n]; });

    Charts.renderComparisonChart(eventNames, dataPerDate);
    renderComparisonTable(eventNames, dataPerDate, dates);
  }

  // ── Summary cards ──────────────────────────────────────────────────
  function pctChange(current, average) {
    if (!average || average === 0) return null;
    return Math.round(((current - average) / average) * 100);
  }

  function pctBadge(pct) {
    if (pct === null || pct === undefined) return '';
    var sign = pct >= 0 ? '+' : '';
    var cls = pct >= 0 ? 'pct-up' : 'pct-down';
    return ' <span class="pct-badge ' + cls + '">' + sign + pct + '%</span>';
  }

  function renderSummaryCards(totals, byEvent, visitors, averages) {
    var topButton = byEvent.length > 0
      ? byEvent.reduce(function (a, b) { return a.totalUsers > b.totalUsers ? a : b; })
      : null;
    var v = visitors || { totalUsers: 0, newUsers: 0, returningUsers: 0 };

    var container = document.getElementById('summary-cards');

    var totalVisitedPct = null, totalClickedPct = null;
    var newVisitedPct = null, newClickedPct = null;
    var retVisitedPct = null, retClickedPct = null;
    if (averages) {
      totalVisitedPct = pctChange(v.totalUsers, averages.visitors.totalUsers);
      totalClickedPct = pctChange(totals.totalUsers, averages.totals.totalUsers);
      newVisitedPct = pctChange(v.newUsers, averages.visitors.newUsers);
      newClickedPct = pctChange(totals.newUsers || 0, averages.totals.newUsers);
      retVisitedPct = pctChange(v.returningUsers, averages.visitors.returningUsers);
      retClickedPct = pctChange(totals.returningUsers || 0, averages.totals.returningUsers);
    }

    var html =
      cardDual('Total', v.totalUsers, 'visited', totals.totalUsers, 'clicked', totalVisitedPct, totalClickedPct) +
      cardDual('New', v.newUsers, 'visited', totals.newUsers || 0, 'clicked', newVisitedPct, newClickedPct) +
      cardDual('Returning', v.returningUsers, 'visited', totals.returningUsers || 0, 'clicked', retVisitedPct, retClickedPct);

    if (topButton) {
      html += card('Top button', topButton.totalUsers, topButton.label);
    }

    container.innerHTML = html;
  }

  function card(label, value, sub) {
    return '<div class="summary-card">' +
      '<div class="label">' + label + '</div>' +
      '<div class="value">' + value.toLocaleString() + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function cardDual(label, primary, primarySub, secondary, secondarySub, primaryPct, secondaryPct) {
    return '<div class="summary-card">' +
      '<div class="label">' + label + '</div>' +
      '<div class="value">' + primary.toLocaleString() + pctBadge(primaryPct) + '</div>' +
      '<div class="sub">' + primarySub + '</div>' +
      '<div class="value-secondary">' + secondary.toLocaleString() + pctBadge(secondaryPct) + ' <span>' + secondarySub + '</span></div>' +
      '</div>';
  }

  // ── Comparison table ───────────────────────────────────────────────
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

  function renderSourcesView() {
    if (_sourcesView === 'sessions') {
      Charts.renderSourcesChart(_visitorsBySource || [], _allRows, true);
    } else if (_sourcesView === 'users') {
      Charts.renderSourcesChart(_bySource, _allRows, true);
    } else {
      Charts.renderSourcesChart(_bySource, _allRows, false);
    }
  }

  // ── UI helpers ─────────────────────────────────────────────────────
  function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
  }

  function hideDashboard() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('no-data').classList.add('hidden');
  }

  function setToggleActive(activeBtn, inactiveBtn) {
    activeBtn.classList.add('active');
    inactiveBtn.classList.remove('active');
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

    // Users chart toggle
    var btnUsersOnly = document.getElementById('toggle-users-only');
    var btnUsersNvr = document.getElementById('toggle-users-nvr');
    btnUsersOnly.addEventListener('click', function () {
      _showNvr = false;
      setToggleActive(btnUsersOnly, btnUsersNvr);
      if (_byEvent) Charts.renderUsersChart(_byEvent, false, _currentAverages);
    });
    btnUsersNvr.addEventListener('click', function () {
      _showNvr = true;
      setToggleActive(btnUsersNvr, btnUsersOnly);
      if (_byEvent) Charts.renderUsersChart(_byEvent, true, _currentAverages);
    });

    // Sources chart toggle (3 buttons)
    var btnSourcesSessions = document.getElementById('toggle-sources-sessions');
    var btnSourcesOnly = document.getElementById('toggle-sources-only');
    var btnSourcesButtons = document.getElementById('toggle-sources-buttons');
    var sourceBtns = [btnSourcesSessions, btnSourcesOnly, btnSourcesButtons];

    function setSourcesToggle(activeBtn) {
      sourceBtns.forEach(function (b) { b.classList.toggle('active', b === activeBtn); });
    }

    btnSourcesSessions.addEventListener('click', function () {
      _sourcesView = 'sessions';
      setSourcesToggle(btnSourcesSessions);
      renderSourcesView();
    });
    btnSourcesOnly.addEventListener('click', function () {
      _sourcesView = 'users';
      setSourcesToggle(btnSourcesOnly);
      renderSourcesView();
    });
    btnSourcesButtons.addEventListener('click', function () {
      _sourcesView = 'buttons';
      setSourcesToggle(btnSourcesButtons);
      renderSourcesView();
    });

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
