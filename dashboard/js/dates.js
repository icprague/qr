/**
 * Date utilities and preset calculations.
 * All dates are in local time. GA API expects YYYY-MM-DD strings.
 */
var Dates = (function () {
  function fmt(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function today() { return new Date(); }

  function addDays(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  /** Most recent Sunday (today if Sunday). */
  function mostRecentSunday(from) {
    var d = from || today();
    var day = d.getDay(); // 0 = Sunday
    return addDays(d, -day);
  }

  function presets() {
    var now = today();
    var t = fmt(now);
    var y = fmt(addDays(now, -1));
    var thisSun = mostRecentSunday(now);
    var lastSun = addDays(thisSun, -7);

    return {
      'today':          { ranges: [{ start: t, end: t }], label: 'Today — ' + t },
      'yesterday':      { ranges: [{ start: y, end: y }], label: 'Yesterday — ' + y },
      'this-sunday':    { ranges: [{ start: fmt(thisSun), end: fmt(thisSun) }], label: 'This Sunday — ' + fmt(thisSun) },
      'last-sunday':    { ranges: [{ start: fmt(lastSun), end: fmt(lastSun) }], label: 'Last Sunday — ' + fmt(lastSun) },
      'last-4-sundays': (function () {
        var ranges = [];
        var labels = [];
        for (var i = 0; i < 4; i++) {
          var sun = addDays(thisSun, -7 * i);
          ranges.push({ start: fmt(sun), end: fmt(sun) });
          labels.push(fmt(sun));
        }
        ranges.reverse();
        labels.reverse();
        return { ranges: ranges, label: 'Last 4 Sundays: ' + labels.join(', '), comparison: true };
      })(),
      'last-7':         { ranges: [{ start: fmt(addDays(now, -6)), end: t }], label: 'Last 7 days' },
      'last-28':        { ranges: [{ start: fmt(addDays(now, -27)), end: t }], label: 'Last 28 days' },
      'this-month':     (function () {
        var first = new Date(now.getFullYear(), now.getMonth(), 1);
        return { ranges: [{ start: fmt(first), end: t }], label: now.toLocaleString('en', { month: 'long', year: 'numeric' }) };
      })()
    };
  }

  function customRange(start, end) {
    return { ranges: [{ start: start, end: end }], label: start + ' to ' + end };
  }

  /** Pretty label for a date range column header. */
  function shortLabel(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  return { fmt: fmt, presets: presets, customRange: customRange, shortLabel: shortLabel };
})();
