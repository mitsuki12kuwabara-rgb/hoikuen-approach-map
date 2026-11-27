/**
 * 保育園アプローチマップ　チーム共有用（Google スプレッドシート ＋ Apps Script）
 *
 * このスプレッドシートが「記録の保管庫」です。地図（GitHub Pages）は誰でも開けますが、
 * 記録の読み書きは合言葉を知っている人だけができます。
 *
 *  - シート「記録」：園ごとに1行。同じ園を同時に記録したら、更新時刻が新しいほうが残ります。
 *  - シート「履歴」：電話・訪問などの履歴を、記録者名つきで1件1行ずつ積み上げます（消えません）。
 *  - シート「集計」：段階ごとの園数（自動計算）。
 *
 * 準備のしかたは gas/README.md を見てください。
 */

var SHEET_REC = '記録';
var SHEET_LOG = '履歴';
var SHEET_SUM = '集計';
var REC_HEAD = ['ID', '区', '施設名', '段階番号', '段階', '推奨度', '最後に連絡した日', '次にやる日', 'インタビュー日',
  '先方の担当', '電話', 'FAX', 'メール', 'メモ', '最近の履歴', '更新日時', '更新者', 'ts', 'data(地図用・編集しない)'];
var LOG_HEAD = ['日時', 'ID', '区', '施設名', '内容', '記録者', 'シートに届いた日時'];
var COL_TS = REC_HEAD.indexOf('ts') + 1;        // 18
var COL_DATA = REC_HEAD.indexOf('data(地図用・編集しない)') + 1;  // 19
var STAGE_LABELS = ['未着手', 'テレアポ', 'FAX・メール', '日程調整', 'インタビュー', 'アンケート', '継続的関係（モニター獲得）', '連絡済み・ダメだった'];

/* ---------- メニュー ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('保育園マップ')
    .addItem('① 最初の準備（シートを作る）', 'setupSheets')
    .addItem('② 合言葉を決める・変える', 'setTeamKey')
    .addToUi();
}

function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  var rec = ss.getSheetByName(SHEET_REC) || ss.insertSheet(SHEET_REC, 0);
  if (rec.getLastRow() === 0) {
    rec.appendRow(REC_HEAD);
    rec.setFrozenRows(1); rec.setFrozenColumns(3);
    rec.getRange(1, 1, 1, REC_HEAD.length).setFontWeight('bold').setBackground('#dff0f3');
    rec.getRange('A:A').setNumberFormat('@');
    rec.getRange('K:L').setNumberFormat('@');   // 電話・FAX（先頭の0を消さない）
    rec.getRange('G:I').setNumberFormat('@');   // 日付は地図と同じ「2026-03-11」の形のまま
    rec.setColumnWidth(3, 200); rec.setColumnWidth(14, 280); rec.setColumnWidth(15, 280);
    rec.hideColumns(COL_TS, 2);
  }
  var log = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG, 1);
  if (log.getLastRow() === 0) {
    log.appendRow(LOG_HEAD);
    log.setFrozenRows(1);
    log.getRange(1, 1, 1, LOG_HEAD.length).setFontWeight('bold').setBackground('#fdecd9');
    log.setColumnWidth(4, 200); log.setColumnWidth(5, 320);
  }
  var sum = ss.getSheetByName(SHEET_SUM) || ss.insertSheet(SHEET_SUM, 2);
  if (sum.getLastRow() === 0) {
    sum.getRange('A1:B1').setValues([['全園数（地図から自動で入ります）', 483]]);
    sum.getRange('A3:C3').setValues([['段階', '園数', '割合']]).setFontWeight('bold').setBackground('#eef3f5');
    var rows = STAGE_LABELS.map(function (s, i) {
      var r = 4 + i;
      var cnt = (i === 0)
        ? '=$B$1-SUM(B5:B' + (3 + STAGE_LABELS.length) + ')'
        : '=COUNTIF(\'' + SHEET_REC + '\'!E:E,A' + r + ')';
      return [s, cnt, '=IF($B$1>0,B' + r + '/$B$1,0)'];
    });
    sum.getRange(4, 1, rows.length, 3).setValues(rows);
    sum.getRange(4, 3, rows.length, 1).setNumberFormat('0.0%');
    sum.getRange(4 + rows.length + 1, 1, 1, 2).setValues([['連絡済み（未着手以外）', '=$B$1-B4']]);
    sum.setColumnWidth(1, 260);
  }
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  safeAlert('シートを準備しました。次に「② 合言葉を決める・変える」をしてください。');
}

function setTeamKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('合言葉を決める', 'チームで使う合言葉を入れてください（8文字以上。地図を使う人に伝えます）。\n変えると、全員がもう一度入れ直すことになります。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var k = String(res.getResponseText() || '').trim();
  if (k.length < 8) { ui.alert('8文字以上にしてください。'); return; }
  PropertiesService.getScriptProperties().setProperty('TEAM_KEY', k);
  ui.alert('合言葉を保存しました。');
}

function safeAlert(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); } }

/* ---------- 地図からの通信 ---------- */
function doGet() {
  return json_({ ok: true, app: 'hoikuen-approach-map', note: '地図から使う窓口です。' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  var key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
  if (!key) return json_({ ok: false, error: 'no_key', message: 'スプレッドシートで合言葉がまだ決まっていません' });
  if (!req || req.key !== key) { Utilities.sleep(1200); return json_({ ok: false, error: 'key', message: '合言葉がちがいます' }); }
  try {
    if (req.action === 'ping') return json_({ ok: true, serverTime: Date.now() });
    if (req.action === 'pull') return json_(pull_());
    if (req.action === 'push') return json_(push_(req));
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function recSheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REC);
  if (!sh) { setupSheetsSilently_(); sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REC); }
  return sh;
}
function setupSheetsSilently_() { try { setupSheets(); } catch (e) {} }

function readAll_(sh) {
  var n = sh.getLastRow() - 1, out = {};
  if (n <= 0) return out;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  var data = sh.getRange(2, COL_TS, n, 2).getValues();
  for (var i = 0; i < n; i++) {
    var id = String(ids[i][0] || '');
    if (!id) continue;
    var rec = null;
    try { rec = JSON.parse(data[i][1] || 'null'); } catch (e) { rec = null; }
    if (!rec) continue;
    rec.ts = Number(data[i][0]) || rec.ts || 0;
    out[id] = { row: i + 2, rec: rec };
  }
  return out;
}

function pull_() {
  var all = readAll_(recSheet_()), recs = {};
  Object.keys(all).forEach(function (id) { recs[id] = all[id].rec; });
  return { ok: true, records: recs, serverTime: Date.now() };
}

function logKey_(x) { return x.k || (String(x.at) + '|' + String(x.text)); }

function push_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = recSheet_();
    var logSh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
    var all = readAll_(sh);
    var accepted = [], rejected = {}, newLogs = [], appendRows = [];
    var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    var who = String(req.who || '').slice(0, 40);
    (req.items || []).forEach(function (it) {
      if (!it || !it.id || !it.rec) return;
      var id = String(it.id), rec = it.rec, cur = all[id];
      var inTs = Number(rec.ts) || 0;
      var info = it.info || {};
      // 履歴は、勝ち負けに関係なく新しい分を「履歴」シートに積む（消さない）
      var known = {};
      (cur && cur.rec.log || []).forEach(function (x) { known[logKey_(x)] = 1; });
      (rec.log || []).slice().reverse().forEach(function (x) {
        if (!x || known[logKey_(x)]) return;
        newLogs.push([x.at || '', id, info.ku || '', info.name || '', x.text || '', x.by || rec.by || who, nowStr]);
      });
      if (cur && (Number(cur.rec.ts) || 0) >= inTs) { rejected[id] = cur.rec; return; }   // シートのほうが新しい
      var row = rowOf_(id, rec, info);
      if (cur) { sh.getRange(cur.row, 1, 1, row.length).setValues([row]); }
      else { appendRows.push(row); }
      all[id] = { row: cur ? cur.row : -1, rec: rec };
      accepted.push(id);
    });
    if (appendRows.length) sh.getRange(sh.getLastRow() + 1, 1, appendRows.length, REC_HEAD.length).setValues(appendRows);
    if (newLogs.length && logSh) logSh.getRange(logSh.getLastRow() + 1, 1, newLogs.length, LOG_HEAD.length).setValues(newLogs);
    if (req.total) {
      var sum = SpreadsheetApp.getActive().getSheetByName(SHEET_SUM);
      if (sum && Number(sum.getRange('B1').getValue()) !== Number(req.total)) sum.getRange('B1').setValue(Number(req.total));
    }
    return { ok: true, accepted: accepted, rejected: rejected, serverTime: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

function rowOf_(id, r, info) {
  var prio = { '3': '高', '2': '中', '1': '低' }[String(r.prio || '')] || '';
  var recent = (r.log || []).slice(0, 5).map(function (x) { return x.at + ' ' + x.text; }).join('\n');
  return [
    id, info.ku || '', info.name || '', info.step == null ? '' : info.step, info.stage || '', prio,
    r.contactDate || '', r.nextDate || '', r.visitDate || '', r.staff || '', r.tel || '', r.fax || '', r.mail || '',
    r.memo || '', recent, r.updatedAt || '', r.by || '', Number(r.ts) || 0, JSON.stringify(r)
  ].map(function (v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; });
}
