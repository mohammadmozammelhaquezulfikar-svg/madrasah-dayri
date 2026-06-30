// বিকাল ৫টায় চেক করে দায়িত্বরত শিক্ষকের ডায়েরি saved আছে কিনা,
// না থাকলে শুধু তার কাছেই notification পাঠায়

const admin = require('firebase-admin');

// GitHub Secret থেকে service account key লোড করা
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ===== শিক্ষকের তালিকা ও rotation logic (app এর সাথে মিল রেখে) =====
const DEFAULT_TEACHERS = [
  'সিফাত উদ্দিন', 'এমদাদ', 'জুলফিকার', 'ফাহাদ হোসেন'
  // বাকি শিক্ষকদের নাম এখানে app এর admin panel এ যা আছে ঠিক সেভাবে বসবে
];

async function getTeachers() {
  try {
    const doc = await db.collection('settings').doc('teachers').get();
    if (doc.exists && doc.data().list) {
      return doc.data().list;
    }
  } catch (e) {
    console.warn('Teachers fetch failed, using default:', e.message);
  }
  return DEFAULT_TEACHERS;
}

function getCurrentTeacherIndex(teachers) {
  // app এর getCurrentTeacher() লজিকের সাথে মিল রেখে
  const startDate = new Date('2026-06-27T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  const weekNum = Math.floor(diffDays / 7);
  return ((weekNum % teachers.length) + teachers.length) % teachers.length;
}

function getTodayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function diaryExistsForToday(dateStr) {
  // 'diary' collection এ আজকের তারিখের কোনো entry আছে কিনা চেক করা
  const snapshot = await db.collection('diary')
    .where(admin.firestore.FieldPath.documentId(), '>=', dateStr)
    .where(admin.firestore.FieldPath.documentId(), '<', dateStr + '\uf8ff')
    .limit(1)
    .get();
  return !snapshot.empty;
}

async function sendNotificationToTeacher(teacherName) {
  const tokenDoc = await db.collection('fcm_tokens').doc(teacherName).get();
  if (!tokenDoc.exists) {
    console.log(`${teacherName} এর কোনো FCM token নেই, notification পাঠানো যাচ্ছে না`);
    return;
  }
  const token = tokenDoc.data().token;

  const message = {
    token: token,
    notification: {
      title: '📓 ডায়েরি দেওয়ার সময়!',
      body: `${teacherName} ভাই, আজকের ডায়েরি এখনো পাঠানো হয়নি। এখনই দিন!`
    },
    webpush: {
      fcmOptions: {
        link: 'https://fastidious-fox-f340a4.netlify.app/'
      }
    }
  };

  try {
    await admin.messaging().send(message);
    console.log(`Notification পাঠানো হয়েছে: ${teacherName}`);
  } catch (e) {
    console.error(`Notification পাঠাতে ব্যর্থ (${teacherName}):`, e.message);
  }
}

async function main() {
  const teachers = await getTeachers();
  const dutyIndex = getCurrentTeacherIndex(teachers);
  const dutyTeacher = teachers[dutyIndex];
  const todayStr = getTodayDateStr();

  console.log('আজকের তারিখ:', todayStr);
  console.log('এই সপ্তাহে দায়িত্বরত:', dutyTeacher);

  const exists = await diaryExistsForToday(todayStr);
  if (exists) {
    console.log('আজকের ডায়েরি ইতিমধ্যে পাঠানো হয়েছে। Notification লাগবে না।');
    return;
  }

  console.log('আজকের ডায়েরি এখনো পাঠানো হয়নি। Notification পাঠানো হচ্ছে...');
  await sendNotificationToTeacher(dutyTeacher);
}

main().catch(e => {
  console.error('Script error:', e);
  process.exit(1);
});
