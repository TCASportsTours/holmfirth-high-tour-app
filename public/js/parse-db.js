/* TCA Tours — App Database parser (v1)
   Turns the "Holmfirth NYC App Database" workbook into two objects:
     public  -> safe for anyone with the link (itinerary, flights, hostel, safety tips)
     private -> staff only (students, medical, dietary, rooms, contacts, transfers, meal orders)
   Used by admin.html in the browser (with SheetJS) and by dev/build-defaults.mjs in Node.
   Works on rows from XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false}). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TourDB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PARSER_VERSION = 'v1';

  function norm(x) { return String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function str(x) { return String(x == null ? '' : x).replace(/\r/g, '').trim(); }
  var EMPTY = /^\s*(n\/?a|na|none|nil|no|nine|nkda|none known|-|)\s*$/i;
  function val(x) { var s = str(x); return EMPTY.test(s) ? '' : s; }
  function isStaffOnly(x) { return /staff|tca/i.test(str(x)); }
  function isTcaOnly(x) { return /tca/i.test(str(x)); }

  function findSheet(wb, names) {
    var want = names.map(norm);
    for (var i = 0; i < wb.SheetNames.length; i++) if (want.indexOf(norm(wb.SheetNames[i])) >= 0) return wb.Sheets[wb.SheetNames[i]];
    return null;
  }
  /* Our sheets have a title, a sub-title and a blank row above the header. Find the header
     row as the first row containing the expected first column name. */
  function table(XLSX, ws, firstCol) {
    if (!ws) return [];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    var h = -1;
    for (var i = 0; i < Math.min(rows.length, 12); i++) if (norm(rows[i][0]) === norm(firstCol)) { h = i; break; }
    if (h < 0) return [];
    var heads = rows[h].map(norm);
    return rows.slice(h + 1).map(function (r) {
      var o = {}; heads.forEach(function (k, j) { if (k) o[k] = str(r[j]); }); return o;
    }).filter(function (o) { return Object.keys(o).some(function (k) { return o[k] !== ''; }); });
  }

  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* -> 'YYYY-MM-DD' or '' . Accepts dd/mm/yyyy, yyyy-mm-dd, '25 Oct 2026', 'Sun 25th October 2026', Excel serials. */
  function parseDate(s, fallbackYear) {
    s = str(s); if (!s) return '';
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/))) { var y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
    if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?\s*(\d{4})?/i)) && MON[m[2].toLowerCase()])
      return (m[3] || fallbackYear || new Date().getFullYear()) + '-' + pad(MON[m[2].toLowerCase()]) + '-' + pad(+m[1]);
    if (/^\d{5}(\.\d+)?$/.test(s)) { var d = new Date(Math.round((+s - 25569) * 864e5)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    return '';
  }
  /* -> 'HH:MM' or '' */
  function parseTime(s) {
    s = str(s); if (!s) return '';
    var m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (m) { var h = +m[1]; if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; } return pad(h) + ':' + m[2]; }
    var n = Number(s);
    if (!isNaN(n) && n >= 0 && n < 1) { var mm = Math.round(n * 1440); return pad(Math.floor(mm / 60) % 24) + ':' + pad(mm % 60); }
    return '';
  }
  function slug(s) { return norm(s).slice(0, 24) || 'x'; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  /* Links cell: one per line, either a bare URL or "Label | URL". */
  function parseLinks(cell) {
    return str(cell).split(/\n+/).map(function (line) {
      line = line.trim(); if (!line) return null;
      var m = line.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/i);
      if (m) return { label: m[1] || 'Website', url: m[2] };
      if (/^https?:\/\/\S+$/i.test(line)) return { label: line.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0], url: line };
      return null;
    }).filter(Boolean);
  }

  function parse(XLSX, wb) {
    var warnings = [];
    var pub = { parser: PARSER_VERSION, publishedAt: new Date().toISOString(), tour: {}, days: [], events: [], flights: [], more: [], links: [], staff: [], students: [] };
    var priv = { parser: PARSER_VERSION, details: {}, events: [], tcaEvents: [], students: [], staff: [], contacts: [], transfers: [], meals: [] };

    // ---- Tour Details (Field / Value / Who sees it)
    table(XLSX, findSheet(wb, ['tour details', 'tour', 'settings']), 'field').forEach(function (r) {
      if (!r.field || /^—/.test(r.field)) return;
      var key = r.field, v = r.value;
      if (/date$/i.test(key)) v = parseDate(v) || v;
      (isStaffOnly(r.whoseesit) ? priv.details : pub.tour)[key] = v;
    });
    var year = (pub.tour['Start Date'] || '').slice(0, 4) || String(new Date().getFullYear());

    // ---- Schedule
    var day = 0, dayDate = '', dayMap = {}, n = 0;
    table(XLSX, findSheet(wb, ['schedule', 'itinerary']), 'day').forEach(function (r) {
      if (str(r.day)) { var d = parseInt(r.day, 10); if (!isNaN(d) && d !== day) { day = d; dayDate = ''; } }
      var date = parseDate(r.date, year);
      if (date && !dayDate) dayDate = date;
      if (!date) date = dayDate;
      if (!r.title) return;
      if (!day) { warnings.push('Schedule: "' + r.title + '" has no Day number — skipped'); return; }
      if (!date) warnings.push('Schedule: "' + r.title + '" has no date');
      if (!dayMap[day]) dayMap[day] = dayDate || date;
      var ev = {
        id: 'e' + (++n) + '-' + slug(r.title), day: day, date: date, time: parseTime(r.time), end: parseTime(r.end),
        clock: /uk/i.test(r.clock) ? 'UK' : 'NY', type: str(r.type) || 'Activity', title: r.title,
        where: r.location || '', detail: r.detail || '', route: r.gettingthere || '', links: parseLinks(r.links || r.website)
      };
      if (str(r.time) && !ev.time) warnings.push('Schedule: could not read time "' + r.time + '" for "' + r.title + '"');
      (isTcaOnly(r.whoseesit) ? priv.tcaEvents : isStaffOnly(r.whoseesit) ? priv.events : pub.events).push(ev);
    });
    pub.days = Object.keys(dayMap).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return { n: k, date: dayMap[k] }; });
    if (!pub.events.length) warnings.push('Schedule: no events found — check the header row says Day, Date, Time …');

    // ---- Flights
    table(XLSX, findSheet(wb, ['flights']), 'date').forEach(function (r) {
      if (!r.flight) return;
      pub.flights.push({ date: parseDate(r.date, year), flight: r.flight, from: r.from, depart: parseTime(r.depart), to: r.to, arrive: parseTime(r.arrive), notes: r.notes || '' });
    });

    // ---- More content
    var tiles = {};
    table(XLSX, findSheet(wb, ['more content', 'more']), 'tile').forEach(function (r) {
      if (!r.tile) return;
      if (!tiles[r.tile]) { tiles[r.tile] = { tile: r.tile, icon: r.icon || '', sections: [] }; pub.more.push(tiles[r.tile]); }
      if (r.icon && !tiles[r.tile].icon) tiles[r.tile].icon = r.icon;
      tiles[r.tile].sections.push({ heading: r.heading || '', text: r.text || '' });
    });

    // ---- Links
    table(XLSX, findSheet(wb, ['links']), 'label').forEach(function (r) {
      if (!r.label || !/^https?:\/\//i.test(r.url)) return;
      if (isStaffOnly(r.whoseesit)) return; // staff links not supported yet: keep them off the public feed
      pub.links.push({ label: r.label, url: r.url, group: r.group || '' });
    });

    // ---- Staff (names public, phone/room private)
    table(XLSX, findSheet(wb, ['staff']), 'name').forEach(function (r) {
      if (!r.name) return;
      pub.staff.push({ name: r.name, role: r.role || '', group: r.group || '' });
      priv.staff.push({ name: r.name, role: r.role || '', group: r.group || '', phone: r.phone || '', room: r.roomnumber || '' });
    });

    // ---- Students (private)
    var ids = {};
    table(XLSX, findSheet(wb, ['students', 'pupils']), 'knownas').forEach(function (r) {
      if (!r.knownas) return;
      /* Opaque id: the public student list must not spell out full names */
      var id = 's' + hash(r.knownas.toLowerCase()), k = 1; while (ids[id]) id = 's' + hash(r.knownas.toLowerCase() + (++k)); ids[id] = 1;
      priv.students.push({
        id: id, name: r.knownas, surname: r.surname || '', forenames: r.forenames || '', dob: parseDate(r.dateofbirth),
        group: r.group || '', teacher: r.teacher || '', room: r.roomnumber || '',
        meds: val(r.medications), side: val(r.sideeffects), diet: val(r.dietaryrequirements), send: val(r.send), notes: val(r.notes)
      });
    });

    // ---- Emergency contacts (private)
    table(XLSX, findSheet(wb, ['emergency contacts', 'contacts']), 'name').forEach(function (r) {
      if (!r.name) return;
      priv.contacts.push({ name: r.name, role: r.role || '', where: r.where || '', phone: r.phone || '', notes: r.notes || '' });
    });

    // ---- Transfers (private)
    table(XLSX, findSheet(wb, ['transfers']), 'date').forEach(function (r) {
      if (!r.from && !r.to) return;
      priv.transfers.push({ date: parseDate(r.date, year), pickup: r.pickup || '', type: r.type || '', from: r.from || '', to: r.to || '',
        pax: r.pax || '', bags: r.bags || '', ref: r.confirmation || '', phones: r.phones || '', notes: r.notes || '' });
    });

    // ---- Meal orders (private): long format -> grouped by venue
    var venues = {};
    table(XLSX, findSheet(wb, ['meal orders', 'meals']), 'venue').forEach(function (r) {
      if (!r.venue || !r.name) return;
      if (!venues[r.venue]) { venues[r.venue] = { venue: r.venue, date: parseDate(r.date, year), orders: [] }; priv.meals.push(venues[r.venue]); }
      venues[r.venue].orders.push({ name: r.name, order: r.order || '', note: r.notes || '' });
    });

    if (!priv.students.length) warnings.push('Students: no students found');

    // Public sign-in list: first name + just enough of the surname to tell people apart ("Lucy A.", "Ruby Ea." / "Ruby Ev.")
    var split = function (n) { var w = n.trim().split(/\s+/); return { first: w.slice(0, -1).join(' ') || w[0], last: w.length > 1 ? w[w.length - 1] : '' }; };
    priv.students.forEach(function (st) {
      var me = split(st.name), same = priv.students.filter(function (o) { return o !== st && split(o.name).first.toLowerCase() === me.first.toLowerCase(); });
      var n = 1;
      while (n < me.last.length && same.some(function (o) { return split(o.name).last.slice(0, n).toLowerCase() === me.last.slice(0, n).toLowerCase(); })) n++;
      pub.students.push({ id: st.id, label: me.first + (me.last ? ' ' + me.last.slice(0, n) + '.' : '') });
    });
    pub.students.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return { public: pub, private: priv, warnings: warnings };
  }

  return { parse: parse, parseDate: parseDate, parseTime: parseTime, version: PARSER_VERSION };
});
