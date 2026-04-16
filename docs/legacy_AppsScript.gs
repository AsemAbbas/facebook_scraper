/**
 * Facebook Posts Processor - Google Apps Script
 * ==============================================
 * يعمل داخل Google Sheets الذي يستقبل البيانات من scraper.py
 *
 * المزايا:
 * - تنظيف وتحليل المنشورات بعد رفعها
 * - حساب إحصاءات يومية/أسبوعية
 * - إرسال تنبيهات للمنشورات عالية التفاعل
 * - تصنيف المنشورات بكلمات مفتاحية
 */

const CONFIG = {
  POSTS_SHEET: 'facebook_posts',
  STATS_SHEET: 'إحصاءات',
  ALERTS_SHEET: 'تنبيهات',
  HIGH_ENGAGEMENT_THRESHOLD: 1000, // عتبة التفاعل العالي
  KEYWORDS: ['غزة', 'الضفة', 'القدس', 'الأقصى'], // كلمات للتصنيف
  ALERT_EMAIL: 'your_email@example.com',
};

/**
 * القائمة المخصصة عند فتح الشيت
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 مراقبة فيسبوك')
    .addItem('📊 تحديث الإحصاءات', 'updateStatistics')
    .addItem('🏷️ تصنيف المنشورات', 'classifyPosts')
    .addItem('🚨 فحص المنشورات عالية التفاعل', 'checkHighEngagement')
    .addItem('🧹 حذف التكرارات', 'removeDuplicates')
    .addSeparator()
    .addItem('⚙️ تشغيل كل المهام', 'runAll')
    .addToUi();
}

/**
 * تحديث ورقة الإحصاءات
 */
function updateStatistics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postsSheet = ss.getSheetByName(CONFIG.POSTS_SHEET);
  if (!postsSheet) {
    SpreadsheetApp.getUi().alert(`الورقة "${CONFIG.POSTS_SHEET}" غير موجودة`);
    return;
  }

  const data = postsSheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0];
  const rows = data.slice(1);

  const colIdx = {
    text: headers.indexOf('text'),
    reactions: headers.indexOf('reactions'),
    comments: headers.indexOf('comments'),
    shares: headers.indexOf('shares'),
    scraped_at: headers.indexOf('scraped_at'),
  };

  // إحصاءات إجمالية
  const totalPosts = rows.length;
  const totalReactions = rows.reduce((s, r) => s + (Number(r[colIdx.reactions]) || 0), 0);
  const totalComments = rows.reduce((s, r) => s + (Number(r[colIdx.comments]) || 0), 0);
  const totalShares = rows.reduce((s, r) => s + (Number(r[colIdx.shares]) || 0), 0);
  const avgReactions = Math.round(totalReactions / totalPosts);

  // أعلى 5 منشورات تفاعلاً
  const topPosts = [...rows]
    .sort((a, b) => (Number(b[colIdx.reactions]) || 0) - (Number(a[colIdx.reactions]) || 0))
    .slice(0, 5);

  // كتابة في ورقة الإحصاءات
  let statsSheet = ss.getSheetByName(CONFIG.STATS_SHEET);
  if (!statsSheet) statsSheet = ss.insertSheet(CONFIG.STATS_SHEET);
  statsSheet.clear();

  const stats = [
    ['📊 إحصاءات صفحة فيسبوك', ''],
    ['آخر تحديث', new Date().toLocaleString('ar-SA')],
    ['', ''],
    ['إجمالي المنشورات', totalPosts],
    ['إجمالي التفاعلات', totalReactions],
    ['إجمالي التعليقات', totalComments],
    ['إجمالي المشاركات', totalShares],
    ['متوسط التفاعل/منشور', avgReactions],
    ['', ''],
    ['🏆 أعلى 5 منشورات تفاعلاً', ''],
    ['النص', 'التفاعلات'],
  ];

  statsSheet.getRange(1, 1, stats.length, 2).setValues(stats);

  topPosts.forEach((post, i) => {
    const rowIdx = stats.length + i + 1;
    statsSheet.getRange(rowIdx, 1).setValue(String(post[colIdx.text]).slice(0, 100) + '...');
    statsSheet.getRange(rowIdx, 2).setValue(post[colIdx.reactions]);
  });

  // تنسيق RTL
  statsSheet.setRightToLeft(true);
  statsSheet.getRange('A1').setFontSize(14).setFontWeight('bold');

  Logger.log(`تم تحديث الإحصاءات: ${totalPosts} منشور`);
}

/**
 * تصنيف المنشورات بناءً على كلمات مفتاحية
 */
function classifyPosts() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // إضافة عمود "تصنيف" إن لم يكن موجوداً
  let classCol = headers.indexOf('classification');
  if (classCol === -1) {
    classCol = headers.length;
    sheet.getRange(1, classCol + 1).setValue('classification');
  }

  const textCol = headers.indexOf('text');
  const updates = [];

  for (let i = 1; i < data.length; i++) {
    const text = String(data[i][textCol] || '');
    const matched = CONFIG.KEYWORDS.filter(kw => text.includes(kw));
    updates.push([matched.join(', ') || 'عام']);
  }

  if (updates.length > 0) {
    sheet.getRange(2, classCol + 1, updates.length, 1).setValues(updates);
  }
  Logger.log(`تم تصنيف ${updates.length} منشور`);
}

/**
 * فحص المنشورات عالية التفاعل وإرسال تنبيه
 */
function checkHighEngagement() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colIdx = {
    text: headers.indexOf('text'),
    reactions: headers.indexOf('reactions'),
    post_url: headers.indexOf('post_url'),
    post_id: headers.indexOf('post_id'),
  };

  // تجنب التنبيه المتكرر: تتبع المعرفات المُنبَّه عنها
  const props = PropertiesService.getScriptProperties();
  const alerted = JSON.parse(props.getProperty('alerted_ids') || '[]');
  const alertedSet = new Set(alerted);

  const highPosts = data.slice(1).filter(row => {
    const reactions = Number(row[colIdx.reactions]) || 0;
    const id = String(row[colIdx.post_id]);
    return reactions >= CONFIG.HIGH_ENGAGEMENT_THRESHOLD && !alertedSet.has(id);
  });

  if (highPosts.length === 0) {
    Logger.log('لا توجد منشورات جديدة عالية التفاعل');
    return;
  }

  // كتابة في ورقة التنبيهات
  let alertsSheet = ss.getSheetByName(CONFIG.ALERTS_SHEET);
  if (!alertsSheet) {
    alertsSheet = ss.insertSheet(CONFIG.ALERTS_SHEET);
    alertsSheet.appendRow(['التاريخ', 'النص', 'التفاعلات', 'الرابط']);
    alertsSheet.setRightToLeft(true);
  }

  highPosts.forEach(row => {
    alertsSheet.appendRow([
      new Date(),
      String(row[colIdx.text]).slice(0, 200),
      row[colIdx.reactions],
      row[colIdx.post_url],
    ]);
    alertedSet.add(String(row[colIdx.post_id]));
  });

  // حفظ المعرفات المُنبَّه عنها
  props.setProperty('alerted_ids', JSON.stringify([...alertedSet].slice(-500)));

  // إرسال إيميل
  if (CONFIG.ALERT_EMAIL && CONFIG.ALERT_EMAIL !== 'your_email@example.com') {
    const body = highPosts.map(r =>
      `📌 ${String(r[colIdx.text]).slice(0, 150)}\n   تفاعلات: ${r[colIdx.reactions]}\n   ${r[colIdx.post_url]}`
    ).join('\n\n');

    MailApp.sendEmail({
      to: CONFIG.ALERT_EMAIL,
      subject: `🚨 ${highPosts.length} منشور عالي التفاعل`,
      body: body,
    });
  }

  Logger.log(`تم رصد ${highPosts.length} منشور عالي التفاعل`);
}

/**
 * حذف المنشورات المكررة بناءً على post_id
 */
function removeDuplicates() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('post_id');

  const seen = new Set();
  const unique = [headers];
  let removed = 0;

  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idCol]);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(data[i]);
    } else {
      removed++;
    }
  }

  sheet.clearContents();
  sheet.getRange(1, 1, unique.length, unique[0].length).setValues(unique);
  Logger.log(`تم حذف ${removed} مكرر`);
}

/**
 * تشغيل كل المهام بالترتيب
 */
function runAll() {
  removeDuplicates();
  classifyPosts();
  updateStatistics();
  checkHighEngagement();
  SpreadsheetApp.getUi().alert('✅ تم تشغيل كل المهام بنجاح');
}

/**
 * إنشاء مشغّل تلقائي يعمل كل ساعة
 */
function createHourlyTrigger() {
  ScriptApp.newTrigger('runAll')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('تم إنشاء مشغّل ساعي');
}
