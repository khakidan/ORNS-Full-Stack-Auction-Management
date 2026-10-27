/**
 * Records edits made directly in this spreadsheet (not through the ORNS
 * Auction Manager app) in the app's Action History spreadsheet, with who
 * made them and the old and new value, so Settings > Action History shows
 * them and a single-cell edit can be undone.
 *
 * Turned on from the app (Settings > Action History > Turn on edit
 * tracking), which runs apiEnableEditTracking through the Apps Script API.
 * That installs an on-edit trigger owned by the admin who clicked it.
 *
 * Rows use the same 15 columns as the app's own (server/services/
 * actionHistoryRows.ts) and the same "cells" Undo Data shape
 * (server/utils/undoSpec.ts) - keep them in step. Edits written by other
 * programs (website ticket orders, the app itself) don't fire on-edit
 * triggers, so they never appear here as sheet edits.
 */
var ACTION_HISTORY_PROPERTY = 'ACTION_HISTORY_SPREADSHEET_ID';
var ACTION_HISTORY_AREA = 'Tickets';
var ACTION_HISTORY_LOCK_PREFIX = '';

/**
 * Installs (or re-installs) this spreadsheet's on-edit trigger, logging to
 * the given Action History spreadsheet. Returns { success, error? }.
 */
function apiEnableEditTracking(actionHistorySpreadsheetId, sourceSpreadsheetId) {
  try {
    if (!actionHistorySpreadsheetId || !sourceSpreadsheetId) throw new Error('Both spreadsheet IDs are required.');
    var log = SpreadsheetApp.openById(actionHistorySpreadsheetId).getSheetByName('Actions');
    if (!log) throw new Error('The Action History spreadsheet has no "Actions" tab.');
    var source = SpreadsheetApp.openById(sourceSpreadsheetId);

    PropertiesService.getScriptProperties().setProperty(ACTION_HISTORY_PROPERTY, actionHistorySpreadsheetId);
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'trackEdit') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('trackEdit').forSpreadsheet(source).onEdit().create();
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

/** The installed on-edit trigger. Never throws - a logging problem must not interrupt someone's edit. */
function trackEdit(e) {
  try {
    var id = PropertiesService.getScriptProperties().getProperty(ACTION_HISTORY_PROPERTY);
    if (!id || !e || !e.range) return;
    var actionId = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    var row = buildEditActionRow_(e, new Date(), actionId, e.source.getId());
    SpreadsheetApp.openById(id).getSheetByName('Actions').appendRow(row);
  } catch (err) {
    console.error('[ActionHistory] Could not record a sheet edit: ' + err);
  }
}

/** appendRow reads "=..." as a formula; a leading apostrophe keeps a typed value as text. */
function asText_(value) {
  var text = String(value);
  return /^[=+@]/.test(text) ? "'" + text : text;
}

/** One Action History row for an edit event (pure, so it can be tested). */
function buildEditActionRow_(e, now, actionId, sourceSpreadsheetId) {
  var range = e.range;
  var sheetName = range.getSheet().getName();
  var a1 = "'" + sheetName + "'!" + range.getA1Notation();
  var who = (e.user && e.user.getEmail && e.user.getEmail()) || 'unknown editor';
  var single = range.getNumRows() === 1 && range.getNumColumns() === 1;

  var before = single ? (e.oldValue === undefined ? '' : e.oldValue) : '';
  var after = single ? (e.value === undefined ? '' : e.value) : '';
  var undoData = single
    ? JSON.stringify({
        kind: 'cells',
        spreadsheetId: sourceSpreadsheetId,
        range: a1,
        before: [[before]],
        after: [[after]],
        lock: ACTION_HISTORY_LOCK_PREFIX ? ACTION_HISTORY_LOCK_PREFIX + sourceSpreadsheetId : undefined
      })
    : '';
  var summary = single
    ? 'Changed ' + a1 + ' from "' + before + '" to "' + after + '" in the spreadsheet'
    : 'Edited ' + a1 + ' (' + range.getNumRows() * range.getNumColumns() + ' cells) in the spreadsheet';

  return [
    actionId,
    now.toISOString(),
    who,
    'Spreadsheet editor',
    'Sheet edit',
    ACTION_HISTORY_AREA,
    'Sheet edit',
    a1,
    summary,
    single ? asText_(before) : '',
    single ? asText_(after) : '',
    a1,
    single ? '' : "Can't be undone: several cells were edited at once",
    '',
    undoData
  ];
}
