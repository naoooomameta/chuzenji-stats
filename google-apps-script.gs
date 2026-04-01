/**
 * ═══════════════════════════════════════════════════════════
 *  中禅寺湖フィッシングシーズン 感謝くじ
 *  Google Apps Script バックエンド
 * ═══════════════════════════════════════════════════════════
 *
 * 【セットアップ手順】
 *
 *  1. Google スプレッドシートを新規作成
 *  2. メニュー「拡張機能」→「Apps Script」を開く
 *  3. このファイルの内容を全てコピーして貼り付け
 *  4. エディタ上部のプルダウンで「setupSheets」を選択し ▶ 実行
 *     → 初回は権限の承認を求められます。許可してください
 *     → スプレッドシートに「在庫」「設定」「ログ」シートが作成されます
 *  5. 「デプロイ」→「新しいデプロイ」をクリック
 *     - 種類の選択: ウェブアプリ
 *     - 次のユーザーとして実行: 自分
 *     - アクセスできるユーザー: 全員
 *  6. デプロイ後に表示される URL をコピー
 *  7. くじアプリを開き、表示されるセットアップ画面に URL を貼り付けて接続
 *
 * 【コード変更時の再デプロイ】
 *  「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →
 *  バージョン「新しいバージョン」→「デプロイ」
 *  ※「テストデプロイ」(HEAD) は本人しかアクセスできません
 *
 * ═══════════════════════════════════════════════════════════
 */

const PRIZE_NAMES = {
  ichi: 'オリジナルマグカップ',
  ni:   '1,000円OFFクーポン',
  san:  '100円OFFクーポン'
};
const PRIZE_RANKS = {ichi: '1等', ni: '2等', san: '3等'};

/* ── GET: 在庫・設定を返す ── */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stockSheet  = ss.getSheetByName('在庫');
    const configSheet = ss.getSheetByName('設定');

    const stock = {
      ichi: Number(stockSheet.getRange('B1').getValue()) || 0,
      ni:   Number(stockSheet.getRange('B2').getValue()) || 0,
      san:  Number(stockSheet.getRange('B3').getValue()) || 0
    };

    const config = {
      minAmount:   Number(configSheet.getRange('B1').getValue()) || 3000,
      bonusAmount: Number(configSheet.getRange('B2').getValue()) || 5000,
      initStock: {
        ichi: Number(configSheet.getRange('B4').getValue()) || 6,
        ni:   Number(configSheet.getRange('B5').getValue()) || 3,
        san:  Number(configSheet.getRange('B6').getValue()) || 50
      }
    };

    return jsonOut({ok: true, stock, config});
  } catch (err) {
    return jsonOut({ok: false, error: err.message});
  }
}

/* ── POST: 抽選・リセット・設定変更 ── */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return jsonOut({ok: false, error: 'サーバーが混み合っています。しばらくお待ちください。'});
  }

  try {
    var data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'draw':   return handleDraw(data);
      case 'reset':  return handleReset(data);
      case 'config': return handleConfig(data);
      default:       return jsonOut({ok: false, error: '不明なアクション: ' + data.action});
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
  var stockSheet  = ss.getSheetByName('在庫');
  var logSheet    = ss.getSheetByName('ログ');

  var stock = {
    ichi: Number(stockSheet.getRange('B1').getValue()) || 0,
    ni:   Number(stockSheet.getRange('B2').getValue()) || 0,
    san:  Number(stockSheet.getRange('B3').getValue()) || 0
  };

  var total = stock.ichi + stock.ni + stock.san;
  if (total === 0) {
    return jsonOut({ok: false, error: '在庫なし', soldout: true});
  }

  // プールを構築してランダムに抽選
  var pool = [];
  for (var i = 0; i < stock.ichi; i++) pool.push('ichi');
  for (var i = 0; i < stock.ni; i++)  pool.push('ni');
  for (var i = 0; i < stock.san; i++) pool.push('san');

  var key = pool[Math.floor(Math.random() * pool.length)];
  stock[key]--;

  // 在庫更新
  stockSheet.getRange('B1').setValue(stock.ichi);
  stockSheet.getRange('B2').setValue(stock.ni);
  stockSheet.getRange('B3').setValue(stock.san);

  // ログ記録
  logSheet.appendRow([
    new Date(),
    data.amount || 0,
    PRIZE_RANKS[key],
    PRIZE_NAMES[key],
    stock.ichi + stock.ni + stock.san
  ]);

  return jsonOut({ok: true, key: key, stock: stock});
}

/* ── 在庫リセット ── */
function handleReset(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stockSheet  = ss.getSheetByName('在庫');
  var configSheet = ss.getSheetByName('設定');

  var ichi = Number(data.ichi) || 0;
  var ni   = Number(data.ni)   || 0;
  var san  = Number(data.san)  || 0;

  stockSheet.getRange('B1').setValue(ichi);
  stockSheet.getRange('B2').setValue(ni);
  stockSheet.getRange('B3').setValue(san);

  // 初期在庫も更新
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

/* ── JSON レスポンス ── */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════════════════════════════════════════════════
 *  初回セットアップ（Apps Script エディタで一度だけ実行）
 * ═══════════════════════════════════════════════════════════ */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 在庫シート ──
  var s = ss.getSheetByName('在庫') || ss.insertSheet('在庫');
  s.getRange('A1').setValue('1等（マグカップ）');   s.getRange('B1').setValue(6);
  s.getRange('A2').setValue('2等（1,000円OFF）');    s.getRange('B2').setValue(3);
  s.getRange('A3').setValue('3等（100円OFF）');      s.getRange('B3').setValue(50);
  s.getRange('A1:A3').setFontWeight('bold');
  s.setColumnWidth(1, 200);
  s.setColumnWidth(2, 100);

  // ── 設定シート ──
  s = ss.getSheetByName('設定') || ss.insertSheet('設定');
  s.getRange('A1').setValue('最低金額');              s.getRange('B1').setValue(3000);
  s.getRange('A2').setValue('ボーナス金額（2回抽選）'); s.getRange('B2').setValue(5000);
  s.getRange('A3').setValue('');
  s.getRange('A4').setValue('初期在庫 1等');          s.getRange('B4').setValue(6);
  s.getRange('A5').setValue('初期在庫 2等');          s.getRange('B5').setValue(3);
  s.getRange('A6').setValue('初期在庫 3等');          s.getRange('B6').setValue(50);
  s.getRange('A1:A6').setFontWeight('bold');
  s.setColumnWidth(1, 220);
  s.setColumnWidth(2, 100);

  // ── ログシート ──
  s = ss.getSheetByName('ログ') || ss.insertSheet('ログ');
  s.getRange('A1:E1').setValues([['日時', '購入金額', '等', '景品', '残り在庫合計']]);
  s.getRange('A1:E1').setFontWeight('bold');
  s.setColumnWidth(1, 180);
  s.setColumnWidth(2, 100);
  s.setColumnWidth(3, 60);
  s.setColumnWidth(4, 180);
  s.setColumnWidth(5, 120);

  // デフォルトの Sheet1 / シート1 を削除
  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (sheet1 && ss.getSheets().length > 1) {
    try { ss.deleteSheet(sheet1); } catch(e) {}
  }

  SpreadsheetApp.getUi().alert(
    'セットアップ完了 ✓\n\n' +
    'スプレッドシートに「在庫」「設定」「ログ」シートが作成されました。\n\n' +
    '次の手順:\n' +
    '「デプロイ」→「新しいデプロイ」→ ウェブアプリ として公開してください。'
  );
}
