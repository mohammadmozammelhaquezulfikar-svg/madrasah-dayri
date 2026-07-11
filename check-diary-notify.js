// বিকাল ৪টা: প্রতিটা শিক্ষককে তার নিজের বিষয়ের বাকি হোমওয়ার্কের জন্য notification
// বিকাল ৫টা: দায়িত্বরত শিক্ষককে ডায়েরি শেয়ার না করলে notification

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const MODE = process.argv[2] || '5pm'; // 'noon4' বা '5pm', workflow থেকে আসবে

const DEFAULT_TEACHERS = ['সিফাত উদ্দিন', 'এমদাদ', 'জুলফিকার', 'ফাহাদ হোসেন'];
const CLASS_NAMES = ['প্লে', 'নার্সারী', 'প্রথম', 'দ্বিতীয়', 'তৃতীয়'];
const SUBJECTS = [
  'কোরআন মাজীদ ও তাজবীদ', 'আরবি লিখা', 'গণিত', 'বাংলা', 'ইংরেজী',
  'হাদীস/দোয়া', 'আ.হুসনা/কালিমা/খোৎবা', 'আদিয়ায়ে সালাত/মাসআলা',
  'সাধারণ জ্ঞান', 'পরিবেশ পরিচিতি ও বিজ্ঞান', 'চিত্রাংকন'
];
const SUBJ_SHORT = ['কোরআন/তাজবীদ','আরবি লিখা','গণিত','বাংলা','ইংরেজী','হাদীস/দোয়া','আ.হুসনা/কালিমা/খোৎবা','আদিয়ায়ে সালাত/মাসআলা','সাধারণ জ্ঞান','পরিবেশ ও বিজ্ঞান','চিত্রাংকন'];

async function getTeachers() {
  try {
    const doc = await db.collection('settings').doc('teachers').get();
    if (doc.exists && doc.data().names) return doc.data().names;
  } catch (e) { console.warn('Teachers fetch failed:', e.message); }
  return DEFAULT_TEACHERS;
}

async function getSubjectAssignments() {
  try {
    const doc = await db.collection('settings').doc('subjectAssignments').get();
    if (doc.exists && doc.data().assignments) return doc.data().assignments;
  } catch (e) { console.warn('Assignments fetch failed:', e.message); }
  return {};
}

async function getRotationTeachers(teachers) {
  try {
    const doc = await db.collection('settings').doc('rotationTeachers').get();
    if (doc.exists && doc.data().list && doc.data().list.length > 0) {
      // শুধু বৈধ (এখনো teacher list এ থাকা) নাম রাখি
      const valid = doc.data().list.filter(name => teachers.includes(name));
      if (valid.length > 0) return valid;
    }
  } catch (e) { console.warn('Rotation list fetch failed:', e.message); }
  return [...teachers]; // rotation set করা না থাকলে সবাইকে rotation এ ধরে নিই
}

function getFridayWeekNumber(refDate) {
  const referenceFriday = new Date('2026-06-26T00:00:00');
  const d = new Date(refDate);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d - referenceFriday) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7);
}

async function getDutyTeacherIndex(teachers) {
  const currentWeek = getFridayWeekNumber(new Date());

  try {
    const dutyDoc = await db.collection('settings').doc('duty').get();
    if (dutyDoc.exists) {
      const data = dutyDoc.data();
      const idx = data.teacherIndex;
      const weekNumber = data.weekNumber;
      // override শুধু তখনই মানা হবে যদি এটা চলতি সপ্তাহের জন্যই করা হয়ে থাকে
      if (idx !== undefined && weekNumber !== undefined && weekNumber === currentWeek && idx >= 0 && idx < teachers.length) {
        return idx;
      }
    }
  } catch (e) { console.warn('Duty override fetch failed:', e.message); }

  const pool = await getRotationTeachers(teachers);
  const poolIdx = ((currentWeek % pool.length) + pool.length) % pool.length;
  const teacherName = pool[poolIdx];
  return teachers.indexOf(teacherName);
}

function getTodayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getDiaryForClass(dateStr, clsIdx) {
  try {
    const key = `${dateStr}_${clsIdx}`;
    const docSnap = await db.collection('diary').doc(key).get();
    if (docSnap.exists) return docSnap.data();
  } catch (e) { console.warn('Diary fetch failed:', e.message); }
  return null;
}

async function sendNotification(teacherName, title, body) {
  const tokenDoc = await db.collection('fcm_tokens').doc(teacherName).get();
  if (!tokenDoc.exists) {
    console.log(`${teacherName} এর কোনো FCM token নেই, skip করা হচ্ছে`);
    return;
  }
  const token = tokenDoc.data().token;
  const message = {
    token,
    notification: { title, body },
    webpush: { fcmOptions: { link: 'https://hilarious-otter-6ac4e2.netlify.app/' } }
  };
  try {
    await admin.messaging().send(message);
    console.log(`✅ Notification পাঠানো হয়েছে: ${teacherName} — ${body}`);
  } catch (e) {
    console.error(`❌ ব্যর্থ (${teacherName}):`, e.message);
  }
}

// ===== বিকাল ৪টা: প্রতিটা শিক্ষকের নিজের বিষয়ের জন্য reminder =====
async function run4pmCheck(teachers, assignments, dateStr) {
  console.log('--- বিকাল ৪টা: Per-subject teacher check ---');

  // প্রতিটা class এর diary data আগেই fetch করে রাখি
  const diaryByClass = {};
  for (let c = 0; c < CLASS_NAMES.length; c++) {
    diaryByClass[c] = await getDiaryForClass(dateStr, c);
  }

  // প্রতিটা শিক্ষকের জন্য তার pending বিষয় বের করি
  for (const teacher of teachers) {
    const pendingItems = []; // [{cls, subject}]

    for (let c = 0; c < CLASS_NAMES.length; c++) {
      for (let s = 0; s < SUBJECTS.length; s++) {
        const key = `${c}_${SUBJECTS[s]}`;
        const assignedTeachers = assignments[key];
        if (!assignedTeachers || !assignedTeachers.includes(teacher)) continue; // এই শিক্ষকের বিষয় না

        const diary = diaryByClass[c];
        const hw = diary && diary.hw && diary.hw[s] ? diary.hw[s].trim() : '';
        if (!hw) {
          pendingItems.push(`${CLASS_NAMES[c]}-${SUBJ_SHORT[s]}`);
        }
      }
    }

    if (pendingItems.length > 0) {
      const body = `আপনার এই বিষয়গুলোর হোমওয়ার্ক এখনও দেননি: ${pendingItems.join(', ')}`;
      await sendNotification(teacher, '📚 হোমওয়ার্ক বাকি আছে!', body);
    } else {
      console.log(`${teacher}: সব বিষয়ের হোমওয়ার্ক দেওয়া হয়ে গেছে। Notification লাগবে না।`);
    }
  }
}

// ===== বিকাল ৫টা: দায়িত্বরত শিক্ষকের ডায়েরি শেয়ার চেক =====
async function run5pmCheck(teachers, dateStr) {
  console.log('--- বিকাল ৫টা: Duty teacher share check ---');

  const dutyIndex = await getDutyTeacherIndex(teachers);
  const dutyTeacher = teachers[dutyIndex];
  console.log('আজকের দায়িত্বরত শিক্ষক:', dutyTeacher);

  let sharedBy = null;
  try {
    const shareDoc = await db.collection('diary_shares').doc(dateStr).get();
    if (shareDoc.exists) sharedBy = shareDoc.data().sharedBy;
  } catch (e) { console.warn('Share info fetch failed:', e.message); }

  console.log('আজকে শেয়ার করেছেন:', sharedBy || '(কেউ না)');

  if (sharedBy === dutyTeacher) {
    console.log('দায়িত্বরত শিক্ষক নিজেই শেয়ার করেছেন। Notification লাগবে না।');
    return;
  }

  await sendNotification(
    dutyTeacher,
    '📤 ডায়েরি শেয়ার করুন!',
    'আজকের ডায়েরি আপনি এখনও WhatsApp এ শেয়ার করেননি। এখনই পাঠান!'
  );
}

async function main() {
  const teachers = await getTeachers();
  const dateStr = getTodayDateStr();
  console.log('আজকের তারিখ:', dateStr, '| Mode:', MODE);

  if (MODE === 'noon4') {
    const assignments = await getSubjectAssignments();
    await run4pmCheck(teachers, assignments, dateStr);
  } else {
    await run5pmCheck(teachers, dateStr);
  }
}

main().catch(e => {
  console.error('Script error:', e);
  process.exit(1);
});
