const CACHE_NAME = 'study_online_cache_v1';
const DATA_CACHE_NAME = 'study_online_data_v1';
const IDB_NAME = 'StudyOnlineNotificationsDB';
const IDB_STORE = 'reminders';

const CACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Noto+Color+Emoji&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js'
];

const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#070B14" />
  <title>Study Online — أوفلاين</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 50% 0%, rgba(124, 92, 255, 0.28), #070B14 65%);
      color: #ffffff;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
    }
    .box {
      max-width: 380px;
      background: rgba(18, 24, 45, 0.92);
      border: 1.5px solid rgba(255, 215, 106, 0.45);
      border-radius: 24px;
      padding: 28px 20px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
    }
    .ico { font-size: 54px; margin-bottom: 12px; }
    h1 { margin: 0 0 10px; font-size: 22px; color: #FFD76A; }
    p { margin: 0 0 20px; font-size: 14px; color: #9AA3C0; line-height: 1.6; }
    button {
      width: 100%;
      padding: 12px 18px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(180deg, #FFD76A, #F5A623);
      color: #1A1204;
      font-weight: 900;
      font-size: 15px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="ico">🏰📡</div>
    <h1>إنت دلوقتي أوفلاين!</h1>
    <p>مفيش اتصال بالإنترنت، بس ماتقلقش قلعتك لسه شغالة أوفلاين على جهازك. لو الصفحة لسه ما اتكيشيتش، جرب ترجع للرئيسية.</p>
    <button onclick="location.href='./'">ارجع لقلعة التركيز ⚔️</button>
  </div>
</body>
</html>`;

// فتح IndexedDB لقراءة التذكيرات في الخلفية وأوفلاين
function openNotifDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readNotifPayload() {
  let db = null;
  try {
    db = await openNotifDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get('config');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

async function writeNotifPayload(data) {
  let db = null;
  try {
    db = await openNotifDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get('config');
      getReq.onsuccess = () => {
        const prev = getReq.result || {};
        store.put({ ...prev, id: 'config', ...data });
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

function getLocalDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSwQuietHoursNow(now, cfg) {
  if (!cfg || !cfg.quietHoursEnabled) return false;
  const h = now.getHours();
  const start = Number.isFinite(Number(cfg.quietStartHour)) ? Number(cfg.quietStartHour) : 0;
  const end = Number.isFinite(Number(cfg.quietEndHour)) ? Number(cfg.quietEndHour) : 7;
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

async function evaluateAndFireOfflineNotifications() {
  const cfg = await readNotifPayload();
  if (!cfg || cfg.masterEnabled === false) return;

  const now = new Date();
  const nowMs = now.getTime();
  const todayKey = getLocalDayKey(now);
  const quietNow = isSwQuietHoursNow(now, cfg);
  let changed = false;

  const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const hasVisibleClient = openClients.some((c) => c.visibilityState === 'visible');

  // 1. إشعار انتهاء جلسة التركيز لو انتهت والمستخدم بره التطبيق أو أوفلاين
  if (
    cfg.sessionCompleteEnabled !== false &&
    cfg.activeSessionEndAt &&
    nowMs >= cfg.activeSessionEndAt &&
    cfg.notifiedSessionId !== cfg.activeSessionId &&
    !hasVisibleClient &&
    !quietNow
  ) {
    cfg.notifiedSessionId = cfg.activeSessionId;
    changed = true;
    await self.registration.showNotification('انتصار! خلصت جلستك 🎉', {
      body: cfg.activeSessionIsRest
        ? 'الاستراحة خلصت! ارجع للتطبيق وكمل مذاكرة ⚔️'
        : 'عاش يا بطل! افتح قلعة التركيز عشان تستلم عملاتك ونقاط الـ XP 🪙',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'study-online-session-end',
      renotify: true,
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200]
    });
  }

  if (quietNow) {
    if (changed) await writeNotifPayload(cfg);
    return;
  }

  // 2. إشعار الساعة 10 مساءً لو المستخدم مذاكرش ولا دقيقة طول اليوم
  const todayMin = Number.isFinite(Number(cfg.todayMinutes)) ? Number(cfg.todayMinutes) : 0;
  const target10H = Number.isFinite(Number(cfg.noStudy10pmHour)) ? Number(cfg.noStudy10pmHour) : 22;
  const target10M = Number.isFinite(Number(cfg.noStudy10pmMinute)) ? Number(cfg.noStudy10pmMinute) : 0;
  const curMins = now.getHours() * 60 + now.getMinutes();
  const target10Total = target10H * 60 + target10M;
  const activeFocusRunning = !!(cfg.activeSessionEndAt && nowMs < cfg.activeSessionEndAt && !cfg.activeSessionIsRest);

  if (
    cfg.noStudy10pmEnabled !== false &&
    todayMin === 0 &&
    !activeFocusRunning &&
    curMins >= target10Total &&
    cfg.last10pmNotifDay !== todayKey &&
    cfg.last10pmSentDay !== todayKey &&
    !hasVisibleClient
  ) {
    cfg.last10pmSentDay = todayKey;
    changed = true;
    await self.registration.showNotification('⏰ الساعة 10 مساءً — فين مذاكرتك؟', {
      body: cfg.noStudy10pmMessage || 'مذاكرتش ولا دقيقة النهاردة! الحق اعمل لو جلسة سريعة ⏱️🔥',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'study-online-10pm-nostudy',
      renotify: true,
      dir: 'rtl',
      lang: 'ar',
      vibrate: [250, 100, 250]
    });
  }

  // 3. إشعار التذكير اليومي المخصص
  if (cfg.enabled) {
    const dayIdx = (now.getDay() + 1) % 7; // 0 = السبت .. 6 = الجمعة
    const dayAllowed = Array.isArray(cfg.days) ? !!cfg.days[dayIdx] : true;
    const remHour = Number.isFinite(Number(cfg.hour)) ? Number(cfg.hour) : 20;
    const remMin = Number.isFinite(Number(cfg.minute)) ? Number(cfg.minute) : 0;
    const remTotalMins = remHour * 60 + remMin;

    if (dayAllowed && curMins >= remTotalMins && cfg.lastDailySentDay !== todayKey && (cfg.todaySessions || 0) === 0 && !hasVisibleClient) {
      cfg.lastDailySentDay = todayKey;
      changed = true;
      await self.registration.showNotification('قلعة التركيز — وقت المذاكرة! ⚔️', {
        body: cfg.message || 'حان وقت التركيز 🔥 يلا هات وحش المادة!',
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'study-online-daily-reminder',
        renotify: true,
        dir: 'rtl',
        lang: 'ar',
        vibrate: [150, 80, 150]
      });
    }
  }

  // 4. إشعار حماية السلسلة قبل منتصف الليل بساعتين (من 10 م)
  if (cfg.streakProtection && (cfg.streakCurrent || 0) > 0 && (cfg.todaySessions || 0) === 0) {
    if (now.getHours() >= 22 && cfg.lastStreakWarnDay !== todayKey && !hasVisibleClient) {
      cfg.lastStreakWarnDay = todayKey;
      changed = true;
      await self.registration.showNotification('⚠️ الحق سلسلتك قبل نص الليل!', {
        body: `سلسلتك (${cfg.streakCurrent} يوم) في خطر! فاضل أقل من ساعتين، ادخل ذاكر جلسة سريعة 🔥`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'study-online-streak-guard',
        renotify: true,
        dir: 'rtl',
        lang: 'ar',
        vibrate: [250, 100, 250]
      });
    }
  }

  if (changed) {
    await writeNotifPayload(cfg);
  }
}

// التثبيت وتكيش الملفات الأساسية ومكتبات الـ CDN
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const assetUrl of CACHE_ASSETS) {
        try {
          await cache.add(new Request(assetUrl, { mode: assetUrl.startsWith('http') ? 'cors' : 'same-origin' }));
        } catch {
          try {
            await cache.add(new Request(assetUrl, { mode: 'no-cors' }));
          } catch {
            /* استمرار تثبيت باقي الملفات لو ملف واحد فشل */
          }
        }
      }
    })
  );
});

// التفعيل وتنظيف الكاش القديم تلقائياً
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DATA_CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
  );
});

// التحقق هل الطلب ملف ثابت (Cache First) أم بيانات ديناميكية (Network First)
function isStaticAssetRequest(urlObj, request) {
  if (urlObj.origin === self.location.origin) {
    if (request.mode === 'navigate') return true;
    const p = urlObj.pathname;
    if (p.endsWith('/') || p.endsWith('.html') || p.endsWith('.json') || p.endsWith('.png') || p.endsWith('.svg') || p.endsWith('.css') || p.endsWith('.js')) {
      return true;
    }
  }
  if (
    urlObj.hostname === 'fonts.googleapis.com' ||
    urlObj.hostname === 'fonts.gstatic.com' ||
    urlObj.hostname === 'cdnjs.cloudflare.com' ||
    urlObj.hostname === 'cdn.jsdelivr.net'
  ) {
    return true;
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const urlObj = new URL(request.url);
  if (!urlObj.protocol.startsWith('http')) return;

  if (isStaticAssetRequest(urlObj, request)) {
    // Cache First للملفات الثابتة ومكتبات الـ CDN والخطوط
    event.respondWith(
      caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        }).catch(async () => {
          if (request.mode === 'navigate') {
            const indexFallback = await caches.match('./index.html') || await caches.match('./');
            if (indexFallback) return indexFallback;
            return new Response(OFFLINE_FALLBACK_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
  } else {
    // Network First لأي طلبات بيانات ديناميكية
    event.respondWith(
      fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(DATA_CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      }).catch(async () => {
        const cachedData = await caches.match(request);
        if (cachedData) return cachedData;
        return new Response(JSON.stringify({ offline: true, message: 'مفيش نت دلوقتي' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      })
    );
  }
});

// استقبال الرسائل من التطبيق (تحديث فوري / جدولة إشعار جلسة أو تذكير)
let sessionTimerRef = null;

let tenPmTimerRef = null;

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'SYNC_NOTIFICATIONS') {
    const p = data.payload || {};
    if (tenPmTimerRef) {
      clearTimeout(tenPmTimerRef);
      tenPmTimerRef = null;
    }
    if (p.masterEnabled !== false && p.noStudy10pmEnabled !== false && Number(p.todayMinutes || 0) === 0) {
      const now = new Date();
      const targetH = Number.isFinite(Number(p.noStudy10pmHour)) ? Number(p.noStudy10pmHour) : 22;
      const targetM = Number.isFinite(Number(p.noStudy10pmMinute)) ? Number(p.noStudy10pmMinute) : 0;
      const targetMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetH, targetM, 0, 0).getTime();
      const diffMs = targetMs - now.getTime();
      if (diffMs > 1000 && diffMs <= 43200000) {
        tenPmTimerRef = setTimeout(() => {
          evaluateAndFireOfflineNotifications();
        }, diffMs + 500);
      }
    }
    event.waitUntil(
      writeNotifPayload(p).then(() => evaluateAndFireOfflineNotifications())
    );
    return;
  }
  if (data.type === 'SCHEDULE_SESSION_FALLBACK' && data.delayMs > 0 && data.delayMs <= 7260000) {
    if (sessionTimerRef) clearTimeout(sessionTimerRef);
    sessionTimerRef = setTimeout(() => {
      evaluateAndFireOfflineNotifications();
    }, data.delayMs);
  }
});

// فحص دوري في الخلفية حتى والتطبيق مقفول وأوفلاين (Periodic Background Sync)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'study-online-reminders-sync') {
    event.waitUntil(evaluateAndFireOfflineNotifications());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'study-online-reminders-sync') {
    event.waitUntil(evaluateAndFireOfflineNotifications());
  }
});

// عند الضغط على الإشعار افتح التطبيق أو ركز على النافذة المفتوحة
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
      return null;
    })
  );
});