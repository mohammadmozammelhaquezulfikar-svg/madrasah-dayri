const CACHE_NAME = 'madrasa-diary-v3';
const APP_SHELL = ['./', './index.html'];

// Install: app shell cache করা (index.html, root path)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(err => {
      console.warn('Cache install failed:', err);
    })
  );
  self.skipWaiting();
});

// Activate: পুরোনো cache পরিষ্কার করা
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: navigation request (page load) হলে cache-first, না পেলে network
self.addEventListener('fetch', e => {
  // শুধু GET request এর জন্য cache ব্যবহার করি
  if (e.request.method !== 'GET') return;

  // HTML page navigation — cache থেকে দ্রুত দেখানো, সাথে network থেকে update করাও
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then(cached => {
        const networkFetch = fetch(e.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
          }
          return response;
        }).catch(() => cached); // internet না থাকলে cache থেকে দেখাবে
        return cached || networkFetch;
      })
    );
    return;
  }

  // অন্য সব static request — cache-first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && e.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

// Background Sync — internet ফিরে এলে app বন্ধ থাকলেও জাগবে
self.addEventListener('sync', e => {
  if (e.tag === 'diary-sync') {
    e.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (allClients.length > 0) {
    // App খোলা আছে (foreground/background tab) — সরাসরি message পাঠাই
    allClients.forEach(client => client.postMessage({ type: 'PROCESS_PENDING_QUEUE' }));
  } else {
    // App সম্পূর্ণ বন্ধ — একটা notification দেখাই যাতে ব্যবহারকারী app খুলে sync সম্পন্ন করতে পারেন
    await self.registration.showNotification('📓 মাদ্রাসা ডায়েরি', {
      body: 'ইন্টারনেট ফিরে এসেছে। আপনার ডায়েরি পাঠাতে অ্যাপ খুলুন।',
      icon: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
      vibrate: [200, 100, 200],
      tag: 'sync-reminder'
    });
  }
}

// Push notification (FCM background push এর জন্য firebase-messaging-sw.js আলাদা আছে)
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '📓 মাদ্রাসা ডায়েরি', {
      body: data.body || 'ডায়েরি দেওয়ার সময় হয়েছে!',
      icon: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
      vibrate: [200, 100, 200],
      requireInteraction: true
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./index.html'));
});

// App থেকে message পেলে (foreground check)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_NOTIFY') {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 17) {
      self.registration.showNotification('📓 ডায়েরি দেওয়ার সময়!', {
        body: (e.data.teacher || '') + ' ভাই, আজকের ডায়েরি পাঠান!',
        icon: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        tag: 'diary-reminder'
      });
    }
  }
});

// Periodic background sync (সাপোর্ট থাকলে)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'diary-check') {
    e.waitUntil(checkAndNotifyBG());
  }
});

async function checkAndNotifyBG() {
  const now = new Date();
  const hour = now.getHours();
  if (hour >= 17) {
    await self.registration.showNotification('📓 ডায়েরি দেওয়ার সময়!', {
      body: 'আজকের ডায়েরি এখনো পাঠানো হয়নি!',
      icon: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
      vibrate: [200, 100, 200],
      requireInteraction: true,
      tag: 'diary-reminder'
    });
  }
}
