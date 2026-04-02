/**
 * ═══════════════════════════════════════════════════════════
 *  中禅寺湖フィッシングシーズン 感謝くじ
 *  Google Apps Script バックエンド
 * ═══════════════════════════════════════════════════════════
 *
 * 【セットアップ手順】
 *  1. Google スプレッドシートを新規作成
 *  2.「拡張機能」→「Apps Script」→ このコードを貼り付け
 *  3. setupSheets を実行（シート自動作成）
 *  4.「デプロイ」→「新しいデプロイ」→ ウェブアプリとして公開
 *
 * 【再デプロイ】
 *  「デプロイ」→「デプロイを管理」→ 鉛筆 → 新しいバージョン →「デプロイ」
 * ═══════════════════════════════════════════════════════════
 */

var PRIZE_NAMES = {ichi:'オリジナルマグカップ', ni:'500円OFFクーポン', san:'100円OFFクーポン'};
var PRIZE_RANKS = {ichi:'1等', ni:'2等', san:'3等'};

function generateCouponId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = '';
  for (var i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

/* ══ GET ══ */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'status';
    if (action === 'coupon') return handleCouponLookup(e.parameter.id);
    if (action === 'list')   return handleList();
    if (action === 'search') return handleSearch(e.parameter.q);

    // バッチ読み取り（個別getValue()の代わりに一括取得）
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var stockVals  = ss.getSheetByName('在庫').getRange('B1:B3').getValues();
    var configVals = ss.getSheetByName('設定').getRange('B1:B6').getValues();

    var stock = {
      ichi: Number(stockVals[0][0]) || 0,
      ni:   Number(stockVals[1][0]) || 0,
      san:  Number(stockVals[2][0]) || 0
    };
    var config = {
      minAmount:   Number(configVals[0][0]) || 3000,
      bonusAmount: Number(configVals[1][0]) || 5000,
      initStock: {
        ichi: Number(configVals[3][0]) || 6,
        ni:   Number(configVals[4][0]) || 3,
        san:  Number(configVals[5][0]) || 50
      }
    };

    var terms = [];
    var termsSheet = ss.getSheetByName('利用規約');
    if (termsSheet) {
      var lastRow = termsSheet.getLastRow();
      if (lastRow >= 2) {
        var data = termsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < data.length; i++) {
          var v = String(data[i][0]).trim();
          if (v) terms.push(v);
        }
      }
    }
    return jsonOut({ok: true, stock: stock, config: config, terms: terms});
  } catch (err) {
    return jsonOut({ok: false, error: err.message});
  }
}

function handleCouponLookup(id) {
  if (!id) return jsonOut({ok: false, error: 'IDが指定されていません'});
  var row = findCouponRow(id.toUpperCase());
  if (!row) return jsonOut({ok: false, error: 'クーポンが見つかりません'});
  return jsonOut({ok: true, coupon: rowToCoupon(row)});
}

function handleList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return jsonOut({ok: true, coupons: []});
  // 全行を一括取得
  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var coupons = [];
  for (var i = data.length - 1; i >= 0; i--) {
    if (!data[i][5]) continue;
    coupons.push(formatLogRow(data[i]));
  }
  return jsonOut({ok: true, coupons: coupons});
}

function handleSearch(q) {
  if (!q) return jsonOut({ok: false, error: '検索キーワードを入力してください'});
  q = q.toUpperCase();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return jsonOut({ok: true, results: []});
  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var results = [];
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][5]).toUpperCase().indexOf(q) >= 0 || String(data[i][7] || '').toUpperCase().indexOf(q) >= 0) {
      results.push(formatLogRow(data[i]));
    }
  }
  return jsonOut({ok: true, results: results});
}

/* ══ POST ══ */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) {
    return jsonOut({ok: false, error: 'サーバーが混み合っています'});
  }
  try {
    var data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'draw':     return handleDraw(data);
      case 'register': return handleRegister(data);
      case 'redeem':   return handleRedeem(data);
      case 'reset':    return handleReset(data);
      case 'config':   return handleConfig(data);
      default:         return jsonOut({ok: false, error: '不明なアクション'});
    }
  } catch (err) {
    return jsonOut({ok: false, error: err.message});
  } finally {
    lock.releaseLock();
  }
}

function handleDraw(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stockSheet = ss.getSheetByName('在庫');
  var logSheet   = ss.getSheetByName('ログ');

  // バッチ読み取り
  var vals = stockSheet.getRange('B1:B3').getValues();
  var stock = { ichi: Number(vals[0][0])||0, ni: Number(vals[1][0])||0, san: Number(vals[2][0])||0 };
  var total = stock.ichi + stock.ni + stock.san;
  if (total === 0) return jsonOut({ok: false, error: '在庫なし', soldout: true});

  var pool = [];
  for (var i = 0; i < stock.ichi; i++) pool.push('ichi');
  for (var i = 0; i < stock.ni; i++)  pool.push('ni');
  for (var i = 0; i < stock.san; i++) pool.push('san');

  var key = pool[Math.floor(Math.random() * pool.length)];
  stock[key]--;

  // バッチ書き込み
  stockSheet.getRange('B1:B3').setValues([[stock.ichi],[stock.ni],[stock.san]]);

  var couponId = generateCouponId();
  logSheet.appendRow([new Date(), data.amount||0, PRIZE_RANKS[key], PRIZE_NAMES[key],
    stock.ichi+stock.ni+stock.san, couponId, '未使用', '']);

  return jsonOut({ok: true, key: key, stock: stock, couponId: couponId});
}

function handleRegister(data) {
  if (!data.id || !data.name) return jsonOut({ok: false, error: 'IDと名前が必要です'});
  var row = findCouponRowIndex(data.id.toUpperCase());
  if (row < 0) return jsonOut({ok: false, error: 'クーポンが見つかりません'});
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ログ').getRange(row + 2, 8).setValue(data.name);
  return jsonOut({ok: true});
}

function handleRedeem(data) {
  if (!data.id) return jsonOut({ok: false, error: 'IDが必要です'});
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
  var idx = findCouponRowIndex(data.id.toUpperCase());
  if (idx < 0) return jsonOut({ok: false, error: 'クーポンが見つかりません'});
  var row = idx + 2;
  if (logSheet.getRange(row, 7).getValue() === '使用済') return jsonOut({ok: false, error: 'このクーポンは使用済です'});
  logSheet.getRange(row, 7).setValue('使用済');
  return jsonOut({ok: true, status: '使用済'});
}

function handleReset(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ichi = Number(data.ichi)||0, ni = Number(data.ni)||0, san = Number(data.san)||0;
  // バッチ書き込み
  ss.getSheetByName('在庫').getRange('B1:B3').setValues([[ichi],[ni],[san]]);
  ss.getSheetByName('設定').getRange('B4:B6').setValues([[ichi],[ni],[san]]);
  return jsonOut({ok: true, stock: {ichi:ichi, ni:ni, san:san}});
}

function handleConfig(data) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('設定')
    .getRange('B1:B2').setValues([[Number(data.minAmount)||3000],[Number(data.bonusAmount)||5000]]);
  return jsonOut({ok: true});
}

/* ══ ヘルパー ══ */
function findCouponRowIndex(id) {
  var logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = logSheet.getRange(2, 6, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).toUpperCase() === id) return i;
  }
  return -1;
}

function findCouponRow(id) {
  var logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return null;
  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][5]).toUpperCase() === id) return data[i];
  }
  return null;
}

function rowToCoupon(row) {
  return {
    date: row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
    amount: row[1], rank: row[2], prize: row[3],
    id: String(row[5]), status: row[6]||'未使用', name: row[7]||''
  };
}

function formatLogRow(row) {
  return {
    date: row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'MM/dd HH:mm') : '',
    amount: row[1], rank: row[2], prize: row[3],
    id: String(row[5]), status: row[6]||'未使用', name: row[7]||''
  };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══ セットアップ ══ */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var s = ss.getSheetByName('在庫') || ss.insertSheet('在庫');
  s.getRange('A1:B3').setValues([['1等（マグカップ）',6],['2等（500円OFF）',12],['3等（100円OFF）',40]]);
  s.getRange('A1:A3').setFontWeight('bold');
  s.setColumnWidth(1, 200); s.setColumnWidth(2, 100);

  s = ss.getSheetByName('設定') || ss.insertSheet('設定');
  s.getRange('A1:B6').setValues([
    ['最低金額',3000],['ボーナス金額（2回抽選）',6000],['',''],
    ['初期在庫 1等',6],['初期在庫 2等',12],['初期在庫 3等',40]
  ]);
  s.getRange('A1:A6').setFontWeight('bold');
  s.setColumnWidth(1, 220); s.setColumnWidth(2, 100);

  s = ss.getSheetByName('ログ') || ss.insertSheet('ログ');
  s.getRange('A1:H1').setValues([['日時','購入金額','等','景品','残り在庫','クーポンID','ステータス','お名前']]);
  s.getRange('A1:H1').setFontWeight('bold');
  s.setColumnWidth(1,180); s.setColumnWidth(2,100); s.setColumnWidth(3,60);
  s.setColumnWidth(4,180); s.setColumnWidth(5,100); s.setColumnWidth(6,100);
  s.setColumnWidth(7,80); s.setColumnWidth(8,120);

  s = ss.getSheetByName('利用規約') || ss.insertSheet('利用規約');
  s.getRange('A1').setValue('利用規約（1行に1項目）');
  s.getRange('A1').setFontWeight('bold');
  s.getRange('A2:A10').setValues([
    ['当日のお買い上げ金額 3,000円（税込）以上で1回抽選できます'],
    ['6,000円（税込）以上で2回抽選できます'],
    ['お一人様、1会計につき最大2回までとなります'],
    ['景品がなくなり次第、終了となります'],
    ['当選結果に関するお問い合わせにはお答えできません'],
    ['景品の交換・返品・換金はできません'],
    ['クーポンの有効期限は発行日より90日間です'],
    ['本キャンペーンの内容は予告なく変更・終了する場合があります'],
    ['スタッフの指示に従ってご参加ください']
  ]);
  s.setColumnWidth(1, 500);

  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (sheet1 && ss.getSheets().length > 1) { try { ss.deleteSheet(sheet1); } catch(e) {} }
  SpreadsheetApp.getUi().alert('セットアップ完了 ✓');
}
