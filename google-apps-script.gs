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

var PRIZE_NAMES = {ichi:'オリジナルマグカップ', ni:'1,000円OFFクーポン', san:'100円OFFクーポン'};
var PRIZE_RANKS = {ichi:'1等', ni:'2等', san:'3等'};

/* ── 6桁の簡易クーポンID生成 ── */
function generateCouponId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(I,O,0,1)を除外
  var id = '';
  for (var i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/* ── GET ── */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'status';

    if (action === 'coupon')   return handleCouponLookup(e.parameter.id);
    if (action === 'list')     return handleList();
    if (action === 'search')   return handleSearch(e.parameter.q);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var stockSheet  = ss.getSheetByName('在庫');
    var configSheet = ss.getSheetByName('設定');

    var stock = {
      ichi: Number(stockSheet.getRange('B1').getValue()) || 0,
      ni:   Number(stockSheet.getRange('B2').getValue()) || 0,
      san:  Number(stockSheet.getRange('B3').getValue()) || 0
    };
    var config = {
      minAmount:   Number(configSheet.getRange('B1').getValue()) || 3000,
      bonusAmount: Number(configSheet.getRange('B2').getValue()) || 5000,
      initStock: {
        ichi: Number(configSheet.getRange('B4').getValue()) || 6,
        ni:   Number(configSheet.getRange('B5').getValue()) || 3,
        san:  Number(configSheet.getRange('B6').getValue()) || 50
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

/* ── クーポン照会 ── */
function handleCouponLookup(id) {
  if (!id) return jsonOut({ok: false, error: 'IDが指定されていません'});
  var row = findCouponRow(id.toUpperCase());
  if (!row) return jsonOut({ok: false, error: 'クーポンが見つかりません'});
  return jsonOut({ok: true, coupon: rowToCoupon(row)});
}

/* ── 一覧取得（管理ダッシュボード用） ── */
function handleList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return jsonOut({ok: true, coupons: []});

  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var coupons = [];
  for (var i = data.length - 1; i >= 0; i--) {
    if (!data[i][5]) continue; // クーポンIDがない行はスキップ
    coupons.push({
      date: data[i][0] ? Utilities.formatDate(new Date(data[i][0]), 'Asia/Tokyo', 'MM/dd HH:mm') : '',
      amount: data[i][1],
      rank: data[i][2],
      prize: data[i][3],
      id: String(data[i][5]),
      status: data[i][6] || '未使用',
      name: data[i][7] || ''
    });
  }
  return jsonOut({ok: true, coupons: coupons});
}

/* ── 検索 ── */
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
    var id = String(data[i][5]).toUpperCase();
    var name = String(data[i][7] || '').toUpperCase();
    if (id.indexOf(q) >= 0 || name.indexOf(q) >= 0) {
      results.push({
        date: data[i][0] ? Utilities.formatDate(new Date(data[i][0]), 'Asia/Tokyo', 'MM/dd HH:mm') : '',
        amount: data[i][1],
        rank: data[i][2],
        prize: data[i][3],
        id: String(data[i][5]),
        status: data[i][6] || '未使用',
        name: data[i][7] || ''
      });
    }
  }
  return jsonOut({ok: true, results: results});
}

/* ── POST ── */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) {
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

/* ── 抽選 ── */
function handleDraw(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stockSheet = ss.getSheetByName('在庫');
  var logSheet   = ss.getSheetByName('ログ');

  var stock = {
    ichi: Number(stockSheet.getRange('B1').getValue()) || 0,
    ni:   Number(stockSheet.getRange('B2').getValue()) || 0,
    san:  Number(stockSheet.getRange('B3').getValue()) || 0
  };

  var total = stock.ichi + stock.ni + stock.san;
  if (total === 0) return jsonOut({ok: false, error: '在庫なし', soldout: true});

  var pool = [];
  for (var i = 0; i < stock.ichi; i++) pool.push('ichi');
  for (var i = 0; i < stock.ni; i++)  pool.push('ni');
  for (var i = 0; i < stock.san; i++) pool.push('san');

  var key = pool[Math.floor(Math.random() * pool.length)];
  stock[key]--;

  stockSheet.getRange('B1').setValue(stock.ichi);
  stockSheet.getRange('B2').setValue(stock.ni);
  stockSheet.getRange('B3').setValue(stock.san);

  // ID重複チェック付きで生成
  var couponId = generateCouponId();

  // ログ記録（H列: 名前）
  logSheet.appendRow([
    new Date(),
    data.amount || 0,
    PRIZE_RANKS[key],
    PRIZE_NAMES[key],
    stock.ichi + stock.ni + stock.san,
    couponId,
    '未使用',
    ''  // 名前（後から登録）
  ]);

  return jsonOut({ok: true, key: key, stock: stock, couponId: couponId});
}

/* ── 名前登録 ── */
function handleRegister(data) {
  if (!data.id || !data.name) return jsonOut({ok: false, error: 'IDと名前が必要です'});
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return jsonOut({ok: false, error: 'クーポンが見つかりません'});

  var ids = logSheet.getRange(2, 6, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).toUpperCase() === data.id.toUpperCase()) {
      logSheet.getRange(i + 2, 8).setValue(data.name);
      return jsonOut({ok: true});
    }
  }
  return jsonOut({ok: false, error: 'クーポンが見つかりません'});
}

/* ── 使用済処理 ── */
function handleRedeem(data) {
  if (!data.id) return jsonOut({ok: false, error: 'IDが必要です'});
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return jsonOut({ok: false, error: 'クーポンが見つかりません'});

  var ids = logSheet.getRange(2, 6, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).toUpperCase() === data.id.toUpperCase()) {
      var current = logSheet.getRange(i + 2, 7).getValue();
      if (current === '使用済') return jsonOut({ok: false, error: 'このクーポンは使用済です'});
      logSheet.getRange(i + 2, 7).setValue('使用済');
      return jsonOut({ok: true, status: '使用済'});
    }
  }
  return jsonOut({ok: false, error: 'クーポンが見つかりません'});
}

/* ── 在庫リセット ── */
function handleReset(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stockSheet  = ss.getSheetByName('在庫');
  var configSheet = ss.getSheetByName('設定');
  var ichi = Number(data.ichi) || 0, ni = Number(data.ni) || 0, san = Number(data.san) || 0;
  stockSheet.getRange('B1').setValue(ichi);
  stockSheet.getRange('B2').setValue(ni);
  stockSheet.getRange('B3').setValue(san);
  configSheet.getRange('B4').setValue(ichi);
  configSheet.getRange('B5').setValue(ni);
  configSheet.getRange('B6').setValue(san);
  return jsonOut({ok: true, stock: {ichi: ichi, ni: ni, san: san}});
}

/* ── 設定変更 ── */
function handleConfig(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var configSheet = ss.getSheetByName('設定');
  configSheet.getRange('B1').setValue(Number(data.minAmount) || 3000);
  configSheet.getRange('B2').setValue(Number(data.bonusAmount) || 5000);
  return jsonOut({ok: true});
}

/* ── ヘルパー ── */
function findCouponRow(id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('ログ');
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
    id: String(row[5]), status: row[6] || '未使用', name: row[7] || ''
  };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════════════════════════════════════════════════
 *  セットアップ
 * ═══════════════════════════════════════════════════════════ */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var s = ss.getSheetByName('在庫') || ss.insertSheet('在庫');
  s.getRange('A1').setValue('1等（マグカップ）');   s.getRange('B1').setValue(6);
  s.getRange('A2').setValue('2等（1,000円OFF）');    s.getRange('B2').setValue(3);
  s.getRange('A3').setValue('3等（100円OFF）');      s.getRange('B3').setValue(50);
  s.getRange('A1:A3').setFontWeight('bold');
  s.setColumnWidth(1, 200); s.setColumnWidth(2, 100);

  s = ss.getSheetByName('設定') || ss.insertSheet('設定');
  s.getRange('A1').setValue('最低金額');              s.getRange('B1').setValue(3000);
  s.getRange('A2').setValue('ボーナス金額（2回抽選）'); s.getRange('B2').setValue(5000);
  s.getRange('A3').setValue('');
  s.getRange('A4').setValue('初期在庫 1等');          s.getRange('B4').setValue(6);
  s.getRange('A5').setValue('初期在庫 2等');          s.getRange('B5').setValue(3);
  s.getRange('A6').setValue('初期在庫 3等');          s.getRange('B6').setValue(50);
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
  s.getRange('A2').setValue('当日のお買い上げ金額 3,000円（税込）以上で1回抽選できます');
  s.getRange('A3').setValue('5,000円（税込）以上で2回抽選できます');
  s.getRange('A4').setValue('お一人様、1会計につき最大2回までとなります');
  s.getRange('A5').setValue('景品がなくなり次第、終了となります');
  s.getRange('A6').setValue('当選結果に関するお問い合わせにはお答えできません');
  s.getRange('A7').setValue('景品の交換・返品・換金はできません');
  s.getRange('A8').setValue('クーポンの有効期限は発行日より90日間です');
  s.getRange('A9').setValue('本キャンペーンの内容は予告なく変更・終了する場合があります');
  s.getRange('A10').setValue('スタッフの指示に従ってご参加ください');
  s.setColumnWidth(1, 500);

  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (sheet1 && ss.getSheets().length > 1) { try { ss.deleteSheet(sheet1); } catch(e) {} }

  SpreadsheetApp.getUi().alert('セットアップ完了 ✓\n\n「デプロイ」→「新しいデプロイ」で公開してください。');
}
