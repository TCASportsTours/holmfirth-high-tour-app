/**
 * TCA Tours — Tour Feedback Hub, v1
 * ---------------------------------
 * Paste this into the MASTER feedback Google Sheet (Extensions → Apps Script), then Deploy → New deployment →
 * Web app (Execute as: Me · Who has access: Anyone). Every tour app sends its questionnaire answers here, so all
 * tours, teachers and students end up in this one spreadsheet. Photos are saved to a Google Drive folder.
 *
 * The tour app sends: { token, action: "ping" | "photo" | "rows", ... }
 *   ping  -> creates the tabs if they're missing; returns the spreadsheet's link
 *   photo -> { id, name, mime, data (base64), tour } saves one photo to Drive; returns its link
 *   rows  -> { id, rows: { "<tab name>": [ { "<column>": value, ... } ] } } adds the rows to each tab.
 *            New columns are added at the end of a tab automatically, so future questionnaires can ask new
 *            questions without breaking anything. A response already in a tab (same Response ID) isn't added twice.
 *
 * TOKEN must match FEEDBACK_HUB_TOKEN in each tour site's Netlify environment variables. Keep it private:
 * don't put the real value in a public repository.
 */
var TOKEN = 'PASTE_TOKEN_HERE';
var PHOTO_FOLDER = 'TCA Tours — Tour Feedback Photos';

/* The tabs, in order, and their starting columns. More columns are added automatically when needed. */
var TABS = [
  ['Website reviews', ['Response ID', 'Received', 'Tour', 'Who', 'Review', 'Credit line', 'Permission']],
  ['Teachers', ['Response ID', 'Received', 'Tour', 'Destination', 'Tour dates', 'School / Organisation', 'Name', 'Source', 'Test?']],
  ['Students', ['Response ID', 'Received', 'Tour', 'Destination', 'Tour dates', 'School / Organisation', 'Name', 'Source', 'Test?']],
  ['Trip ratings', ['Response ID', 'Received', 'Tour', 'Who', 'Name', 'Trip', 'Rating (1–5)']],
  ['Photos', ['Response ID', 'Received', 'Tour', 'Who', 'Name', 'Caption', 'OK to post?', 'Others in photo have consent?', 'Photo', 'Photo ID']]
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!TOKEN || TOKEN === 'PASTE_TOKEN_HERE' || b.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
    if (b.action === 'ping') { setup_(); return out_({ ok: true, sheet: SpreadsheetApp.getActive().getUrl() }); }
    if (b.action === 'photo') return out_(savePhoto_(b));
    if (b.action === 'rows') return out_(saveRows_(b));
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
function doGet() { return out_({ ok: true, hub: 'TCA Tours feedback hub v1' }); }

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* Run this once from the editor (select setup_ → Run) to create the tabs, or let the first ping do it. */
function setup_() {
  var ss = SpreadsheetApp.getActive();
  TABS.forEach(function (t, i) {
    var sh = ss.getSheetByName(t[0]);
    if (!sh) { sh = ss.insertSheet(t[0], i); }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, t[1].length).setValues([t[1]]).setFontWeight('bold').setBackground('#414042').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
}

function headers_(sh) { var n = sh.getLastColumn(); return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : []; }

function saveRows_(b) {
  setup_();
  var ss = SpreadsheetApp.getActive(), id = String(b.id || ''), added = {};
  if (!id) return { ok: false, error: 'missing id' };
  Object.keys(b.rows || {}).forEach(function (tab) {
    var rows = b.rows[tab] || [];
    if (!rows.length) return;
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var head = headers_(sh);
    if (!head.length) { head = ['Response ID']; sh.getRange(1, 1).setValue('Response ID'); }
    /* Already here? (sending again from the tour app must not duplicate it) */
    var idCol = head.indexOf('Response ID') + 1;
    if (idCol && sh.getLastRow() > 1 && sh.getRange(2, idCol, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext()) { added[tab] = 0; return; }
    /* Any new questions become new columns at the end */
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (head.indexOf(k) < 0) { head.push(k); sh.getRange(1, head.length).setValue(k).setFontWeight('bold').setBackground('#414042').setFontColor('#ffffff'); } }); });
    var values = rows.map(function (r) {
      return head.map(function (h) {
        var v = r[h];
        if (v == null) return '';
        if (h === 'Photo' && /^https?:/.test(v)) return '=HYPERLINK("' + String(v).replace(/"/g, '') + '","Open photo")';
        return v;
      });
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, head.length).setValues(values);
    added[tab] = values.length;
  });
  return { ok: true, added: added, sheet: ss.getUrl() };
}

function folder_(name, parent) {
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
}
function savePhoto_(b) {
  var id = String(b.id || ''), name = String(b.name || 'photo.jpg').replace(/[^\w .()-]/g, '_');
  if (!id || !b.data) return { ok: false, error: 'missing photo' };
  var dir = folder_(String(b.tour || 'Tour').replace(/[\\/]/g, '-'), folder_(PHOTO_FOLDER));
  var fname = id + '_' + name, found = dir.getFilesByName(fname);
  if (found.hasNext()) { var f0 = found.next(); return { ok: true, url: f0.getUrl(), fileId: f0.getId(), duplicate: true }; }
  var blob = Utilities.newBlob(Utilities.base64Decode(String(b.data)), String(b.mime || 'image/jpeg'), fname);
  var f = dir.createFile(blob);
  if (b.caption) f.setDescription(String(b.caption).slice(0, 500));
  return { ok: true, url: f.getUrl(), fileId: f.getId() };
}
