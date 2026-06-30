// Firebase Cloud Messaging - Background Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDTlqajOSDzM6agfh4zJ49W99LBd3VL9vU",
  authDomain: "dayri-3e794.firebaseapp.com",
  projectId: "dayri-3e794",
  storageBucket: "dayri-3e794.firebasestorage.app",
  messagingSenderId: "1079745792648",
  appId: "1:1079745792648:web:0b1e061d3d80ec66f8ed3d"
});

const messaging = firebase.messaging();

// App সম্পূর্ণ বন্ধ থাকলেও এই notification দেখাবে
messaging.onBackgroundMessage((payload) => {
  console.log('Background message received:', payload);
  const title = payload.notification?.title || payload.data?.title || '📓 মাদ্রাসা ডায়েরি';
  const body = payload.notification?.body || payload.data?.body || 'ডায়েরি দেওয়ার সময় হয়েছে!';

  self.registration.showNotification(title, {
    body: body,
    icon: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2541/2541979.png',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    tag: 'diary-reminder'
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
