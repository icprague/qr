/**
 * Chart.js rendering for the dashboard.
 */
var Charts = (function () {
  var PURPLE = '#7c6cbc';
  var PURPLE_LIGHT = '#b8aed8';
  var COLORS = [
    '#7c6cbc', '#4d6fff', '#36b37e', '#ff9f43',
    '#eb4d4b', '#8854d0', '#20bf6b', '#778ca3'
  ];

  var _charts = {};

  function destroy(id) {
    if (_charts[id]) {
      _charts[id].destroy();
      delete _charts[id];
    }
  }

  function destroyAll() {
    Object.keys(_charts).forEach(destroy);
  }

  var GREEN = '#36b37e';

  /**
   * Vertical bar chart: users per button.
   * showNvr = false → single "Total users" bar
   * showNvr = true  → grouped "New users" + "Returning users"
   */
  function renderUsersChart(byEvent, showNvr, averages) {
    destroy('chart-users');
    var ctx = document.getElementById('chart-users').getContext('2d');

    // Build percentage change arrays for bar labels
    var pctData = null;
    if (averages && averages.byButton) {
      pctData = byEvent.map(function (e) {
        var avg = averages.byButton[e.key];
        if (!avg) return { total: null, newU: null, ret: null };
        var totalAvg = avg.totalUsers || 0;
        var newAvg = avg.newUsers || 0;
        var retAvg = avg.returningUsers || 0;
        return {
          total: totalAvg ? Math.round(((e.totalUsers - totalAvg) / totalAvg) * 100) : null,
          newU: newAvg ? Math.round((((e.newUsers || 0) - newAvg) / newAvg) * 100) : null,
          ret: retAvg ? Math.round((((e.returningUsers || 0) - retAvg) / retAvg) * 100) : null
        };
      });
    }

    var datasets;
    if (showNvr) {
      datasets = [{
        label: 'New visitors',
        data: byEvent.map(function (e) { return e.newUsers || 0; }),
        backgroundColor: GREEN,
        borderRadius: 4,
        maxBarThickness: 36
      }, {
        label: 'Returning',
        data: byEvent.map(function (e) { return e.returningUsers || 0; }),
        backgroundColor: PURPLE,
        borderRadius: 4,
        maxBarThickness: 36
      }];
    } else {
      datasets = [{
        label: 'Total users',
        data: byEvent.map(function (e) { return e.totalUsers; }),
        backgroundColor: PURPLE,
        borderRadius: 4,
        maxBarThickness: 48
      }];
    }

    // Custom plugin for bar values with percentage change
    var barValueWithPctPlugin = {
      id: 'barValuesWithPct',
      afterDatasetsDraw: function (chart) {
        var chartCtx = chart.ctx;
        chart.data.datasets.forEach(function (dataset, di) {
          var meta = chart.getDatasetMeta(di);
          meta.data.forEach(function (bar, index) {
            var val = dataset.data[index];
            if (val === 0) return;
            chartCtx.save();
            chartCtx.font = '500 12px Inter, sans-serif';
            chartCtx.textAlign = 'center';
            chartCtx.textBaseline = 'bottom';

            var label = '' + val;
            var pct = null;
            if (pctData && pctData[index]) {
              if (!showNvr) {
                pct = pctData[index].total;
              } else if (di === 0) {
                pct = pctData[index].newU;
              } else {
                pct = pctData[index].ret;
              }
            }

            // Draw value
            chartCtx.fillStyle = '#666';
            chartCtx.fillText(val, bar.x, bar.y - (pct !== null ? 16 : 4));

            // Draw percentage below value
            if (pct !== null) {
              var sign = pct >= 0 ? '+' : '';
              chartCtx.fillStyle = pct >= 0 ? '#1a8a4a' : '#c53030';
              chartCtx.font = '600 11px Inter, sans-serif';
              chartCtx.fillText(sign + pct + '%', bar.x, bar.y - 3);
            }

            chartCtx.restore();
          });
        });
      }
    };

    _charts['chart-users'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: byEvent.map(function (e) { return e.label; }),
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 36 } },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'start',
            labels: { boxWidth: 12, font: { size: 12 }, padding: 16 }
          },
          datalabels: false
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grace: '20%', ticks: { precision: 0 }, grid: { color: '#f0f0f5' } }
        }
      },
      plugins: [barValueWithPctPlugin]
    });
  }

  /**
   * Sources chart.
   * bySourceOnly = true  → horizontal bar of users per source
   * bySourceOnly = false → grouped bar: each source has bars per button
   */
  function renderSourcesChart(bySource, rows, bySourceOnly) {
    destroy('chart-sources');
    var ctx = document.getElementById('chart-sources').getContext('2d');

    if (bySourceOnly) {
      // Simple horizontal bar: users per source
      _charts['chart-sources'] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: bySource.map(function (s) { return s.label; }),
          datasets: [{
            label: 'Users',
            data: bySource.map(function (s) { return s.totalUsers; }),
            backgroundColor: COLORS.slice(0, bySource.length),
            borderRadius: 4,
            maxBarThickness: 40
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 30 } },
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { beginAtZero: true, grace: '10%', ticks: { precision: 0 }, grid: { color: '#f0f0f5' } },
            y: { grid: { display: false } }
          }
        },
        plugins: [hBarValuePlugin]
      });
    } else {
      // Grouped bar: source × button
      var sourceMap = buildSourceButtonMap(rows);
      var sourceLabels = bySource.map(function (s) { return s.label; });
      var sourceKeys = bySource.map(function (s) { return s.key; });

      // One dataset per button
      var buttonNames = GA.EVENT_NAMES.filter(function (n) {
        return sourceKeys.some(function (sk) { return sourceMap[sk] && sourceMap[sk][n]; });
      });

      var datasets = buttonNames.map(function (name, i) {
        return {
          label: GA.LABELS[name] || name,
          data: sourceKeys.map(function (sk) {
            return sourceMap[sk] && sourceMap[sk][name] ? sourceMap[sk][name].totalUsers : 0;
          }),
          backgroundColor: COLORS[i % COLORS.length],
          borderRadius: 2,
          barPercentage: 0.85,
          categoryPercentage: 0.9
        };
      });

      _charts['chart-sources'] = new Chart(ctx, {
        type: 'bar',
        data: { labels: sourceLabels, datasets: datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 30 } },
          plugins: {
            legend: {
              position: 'top',
              align: 'start',
              labels: { boxWidth: 12, font: { size: 11 }, padding: 12 }
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ctx.dataset.label + ': ' + ctx.raw + ' users';
                }
              }
            }
          },
          scales: {
            x: { beginAtZero: true, stacked: true, grace: '10%', ticks: { precision: 0 }, grid: { color: '#f0f0f5' } },
            y: { stacked: true, grid: { display: false } }
          }
        },
        plugins: [stackedBarLabelPlugin]
      });
    }
  }

  /** Build { sourceKey: { buttonName: { eventCount, ... } } } from raw rows. */
  function buildSourceButtonMap(rows) {
    var map = {};
    rows.forEach(function (r) {
      var sk = r.source;
      if (!map[sk]) map[sk] = {};
      if (!map[sk][r.eventName]) {
        map[sk][r.eventName] = { eventCount: 0, totalUsers: 0 };
      }
      map[sk][r.eventName].eventCount += r.eventCount;
      map[sk][r.eventName].totalUsers += r.totalUsers;
    });
    return map;
  }

  /**
   * Grouped bar chart comparing event counts across multiple Sundays.
   */
  function renderComparisonChart(eventNames, dataPerDate) {
    destroy('chart-comparison');
    var ctx = document.getElementById('chart-comparison').getContext('2d');

    var labels = eventNames.map(function (n) { return GA.LABELS[n] || n; });
    var dates = Object.keys(dataPerDate).sort();
    var datasets = dates.map(function (dateStr, i) {
      var byEvent = dataPerDate[dateStr];
      return {
        label: Dates.shortLabel(dateStr),
        data: eventNames.map(function (n) { return byEvent[n] ? byEvent[n].eventCount : 0; }),
        backgroundColor: COLORS[i % COLORS.length],
        borderRadius: 4,
        maxBarThickness: 32
      };
    });

    _charts['chart-comparison'] = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f5' } }
        }
      }
    });
  }

  /** Plugin that draws the value above each bar. */
  var stackedBarLabelPlugin = {
    id: 'stackedBarLabels',
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      // Per-segment labels (white, inside each segment)
      chart.data.datasets.forEach(function (dataset, di) {
        var meta = chart.getDatasetMeta(di);
        meta.data.forEach(function (bar, index) {
          var val = dataset.data[index];
          if (!val) return;
          var props = bar.getProps(['x', 'y', 'base', 'height'], true);
          var segWidth = Math.abs(props.x - props.base);
          if (segWidth < 20) return;
          var cx = (props.x + props.base) / 2;
          var cy = bar.y;
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(val, cx, cy);
          ctx.restore();
        });
      });
      // Totals at the end of each stacked bar
      var numLabels = chart.data.labels.length;
      for (var i = 0; i < numLabels; i++) {
        var total = 0;
        var maxX = 0;
        var barY = 0;
        chart.data.datasets.forEach(function (dataset, di) {
          total += (dataset.data[i] || 0);
          var bar = chart.getDatasetMeta(di).data[i];
          if (bar && bar.x > maxX) { maxX = bar.x; barY = bar.y; }
        });
        if (total === 0) continue;
        ctx.save();
        ctx.fillStyle = '#666';
        ctx.font = '500 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(total, maxX + 6, barY);
        ctx.restore();
      }
    }
  };

  var hBarValuePlugin = {
    id: 'hBarValues',
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      chart.data.datasets.forEach(function (dataset, di) {
        var meta = chart.getDatasetMeta(di);
        meta.data.forEach(function (bar, index) {
          var val = dataset.data[index];
          if (val === 0) return;
          ctx.save();
          ctx.fillStyle = '#666';
          ctx.font = '500 11px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(val, bar.x + 6, bar.y);
          ctx.restore();
        });
      });
    }
  };

  var barValuePlugin = {
    id: 'barValues',
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      chart.data.datasets.forEach(function (dataset, di) {
        var meta = chart.getDatasetMeta(di);
        meta.data.forEach(function (bar, index) {
          var val = dataset.data[index];
          if (val === 0) return;
          ctx.save();
          ctx.fillStyle = '#666';
          ctx.font = '500 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(val, bar.x, bar.y - 4);
          ctx.restore();
        });
      });
    }
  };

  return {
    renderUsersChart: renderUsersChart,
    renderSourcesChart: renderSourcesChart,
    renderComparisonChart: renderComparisonChart,
    destroyAll: destroyAll
  };
})();
