'use strict';
/**
 * MUSTAFA AI CLINIC BOT — v16
 *
 * v16 Key Changes:
 * - Pehli dafa: sendList se 5 options (WhatsApp list allows up to 10 rows)
 * - "Meri Booking" hatayi — koi sense nahi tha
 * - 3 core terms always shown:
 *     1. Appointment Book Karein
 *     2. اپنے موبائل سے پتا کریں  (number lookup — apni booking aur kab aana hai)
 *     3. ابھی کونسا نمبر چل رہا ہے  (queue)
 * - Aaj ki line card: clean, aur end mein "token likhein kab ka number hai"
 * - Token check: apke aage kitne log bhi batata hai
 * - Loading emojis hataye
 * - Sab terms simple Pakistani samajhne waali Urdu/Roman Urdu
 * - Situation ke mutabiq extra options (cancel, doctor, etc.)
 *
 * WhatsApp button limit = 3 | List rows limit = 10
 */

const express = require('express');
const axios   = require('axios');
const admin   = require('firebase-admin');

const app = express().use(express.json());

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CFG = {
    WA_TOKEN : process.env.WHATSAPP_TOKEN,
    NUM_ID   : process.env.PHONE_NUMBER_ID,
    AI_KEY   : process.env.OPENROUTER_KEY,
    VER_TOK  : process.env.VERIFY_TOKEN || 'mustafa123',
    ADM_KEY  : process.env.ADMIN_SECRET,
    MODEL    : 'arcee-ai/trinity-large-preview:free',
    CLINIC_ID: 'default_clinic',
};
['WA_TOKEN','NUM_ID','AI_KEY','ADM_KEY'].forEach(k => {
    if (!CFG[k]) { console.error('Missing env: ' + k); process.exit(1); }
});

// ── FIREBASE ──────────────────────────────────────────────────────────────────
const sa = require('./serviceAccountKey.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db  = admin.firestore();
const NOW = () => admin.firestore.FieldValue.serverTimestamp();

// ── HELPERS ───────────────────────────────────────────────────────────────────
function toDateStr(d) { return d.toISOString().split('T')[0]; }
function today()      { return toDateStr(new Date()); }
function tomorrow()   { return toDateStr(new Date(Date.now() + 86400000)); }

function niceDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-PK',
        { weekday:'long', day:'numeric', month:'long' });
}

function jsDay(ds) { const d = new Date(ds+'T00:00:00').getDay(); return d===0?7:d; }

function isFuture(ds) {
    if (!ds) return false;
    return new Date(ds+'T00:00:00') > new Date(new Date().toDateString());
}

const DAY_NAMES = ['','Peer','Mangal','Budh','Jumeraat','Juma','Hafta','Itwaar'];

// ── BUTTON SETS ───────────────────────────────────────────────────────────────
// 3 main buttons — every reply
const MAIN_BTNS = [
    { id:'BOOK',       label:'📅 Appointment Book Karein' },
    { id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
    { id:'QUEUE',      label:'⏳ چلنے والا نمبر' },
];

// After booking done
const POST_BOOK_BTNS = [
    { id:'QUEUE',      label:'⏳ چلنے والا نمبر' },
    { id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
    { id:'DOCTOR',     label:'👨‍⚕️ Doctor Info'                },
];

// 5 options for first-time welcome list
const WELCOME_ROWS = [
    { id:'BOOK',       title:'📅 Appointment Book Karein',       description:'Naya number hasil karein' },
    { id:'NUM_LOOKUP', title:'🔍 چیک اپوائنٹمنٹ',      description:'Apni booking aur kab aana hai' },
    { id:'QUEUE',      title:'⏳ چلنے والا نمبر',   description:'Aaj ki line ka haal' },
    { id:'DOCTOR',     title:'👨‍⚕️ Doctor Ki Maloomat',            description:'Fees, waqt aur din' },
    { id:'DO_CANCEL',  title:'❌ Booking Cancel Karein',         description:'Apni booking hatayein' },
];

// ── FIREBASE PATHS ────────────────────────────────────────────────────────────
const clinicRef   = ()     => db.collection('clinics').doc(CFG.CLINIC_ID);
const metaRef     = (date) => clinicRef().collection('queues').doc(date).collection('meta').doc('info');
const patientsRef = (date) => clinicRef().collection('queues').doc(date).collection('patients');
const doctorsRef  = ()     => clinicRef().collection('doctors');

async function dbGet(col, id) {
    try { const d = await db.collection(col).doc(id).get(); return d.exists ? d.data() : {}; }
    catch(e) { return {}; }
}
async function dbSet(col, id, data) {
    try { await db.collection(col).doc(id).set(data, { merge:true }); }
    catch(e) { console.error('dbSet:', e.message); }
}

// ── DOCTOR ────────────────────────────────────────────────────────────────────
async function getDoctor() {
    try {
        const snap = await doctorsRef().limit(1).get();
        if (snap.empty) return null;
        return { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch(e) { return null; }
}

function isDoctorAvailable(doc, dateStr) {
    if (!doc) return false;
    if (doc.availableDays && doc.availableDays.length) {
        if (!doc.availableDays.includes(jsDay(dateStr))) return false;
    }
    if (doc.unavailableDates && doc.unavailableDates.includes(dateStr)) return false;
    return true;
}

async function getOpenDates(n) {
    const doc = await getDoctor();
    if (!doc) return [];
    const dates = [];
    let d = new Date();
    while (dates.length < n) {
        d = new Date(d.getTime() + 86400000);
        const ds = toDateStr(d);
        if (isDoctorAvailable(doc, ds)) dates.push(ds);
        if (dates.length >= 14) break;
    }
    return dates;
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
async function getQueueStatus(date) {
    try {
        const meta = await metaRef(date).get();
        const snap = await patientsRef(date).get();
        let waiting = 0, inProgress = null;
        snap.forEach(d => {
            const p = d.data();
            if (p.status === 'waiting')     waiting++;
            if (p.status === 'in_progress') inProgress = p;
        });
        const m = meta.exists ? meta.data() : {};
        return {
            currentServingToken: m.currentServingToken || null,
            inProgressPatient  : inProgress,
            waitingCount       : waiting,
        };
    } catch(e) { return null; }
}

async function hasActiveBooking(phone, date) {
    try {
        const snap = await patientsRef(date)
            .where('phone','==',phone)
            .where('status','in',['waiting','in_progress'])
            .get();
        if (snap.empty) return null;
        return { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch(e) { return null; }
}

async function findByToken(token, daysAhead=7) {
    for (let i=0; i<=daysAhead; i++) {
        const d = toDateStr(new Date(Date.now()+i*86400000));
        try {
            const snap = await patientsRef(d).where('token','==',token).get();
            if (!snap.empty) return { date:d, id:snap.docs[0].id, ...snap.docs[0].data() };
        } catch(e) {}
    }
    return null;
}

async function findBookingsByPhone(searchPhone) {
    const cleaned = searchPhone.replace(/[^\d]/g,'');
    const results = [];
    for (let i=0; i<=14; i++) {
        const d = toDateStr(new Date(Date.now()+i*86400000));
        try {
            const snap = await patientsRef(d)
                .where('status','in',['waiting','in_progress'])
                .get();
            snap.forEach(doc => {
                const p = doc.data();
                const pCleaned = (p.phone||'').replace(/[^\d]/g,'');
                if (pCleaned.endsWith(cleaned.slice(-10)) || cleaned.endsWith(pCleaned.slice(-10))) {
                    results.push({ date:d, id:doc.id, ...p });
                }
            });
        } catch(e) {}
    }
    return results;
}

async function bookAppointment(phone, name, date, problem) {
    const mRef = metaRef(date);
    const pRef = patientsRef(date);
    return await db.runTransaction(async tx => {
        const metaDoc = await tx.get(mRef);
        const last    = metaDoc.exists ? (metaDoc.data().lastToken||0) : 0;
        const next    = last + 1;
        const patRef  = pRef.doc();
        tx.set(patRef, {
            name, phone, city:null, source:'whatsapp',
            token:next, status:'waiting',
            problem: problem||null,
            createdAt:NOW(), arrivedAt:null,
        });
        tx.set(mRef, {
            lastToken: next,
            currentServingToken: metaDoc.exists ? (metaDoc.data().currentServingToken||null) : null,
            timestamp: NOW(),
        }, { merge:true });
        return next;
    });
}

async function cancelBooking(phone, date, token) {
    try {
        const snap = await patientsRef(date)
            .where('phone','==',phone).where('token','==',token).get();
        const batch = db.batch();
        snap.forEach(d => batch.update(d.ref, { status:'cancelled' }));
        await batch.commit();
    } catch(e) { console.error('cancelBooking:', e.message); }
}

// ── WHATSAPP SEND ─────────────────────────────────────────────────────────────
const WA_H   = () => ({ Authorization:'Bearer '+CFG.WA_TOKEN });
const WA_URL = () => `https://graph.facebook.com/v19.0/${CFG.NUM_ID}/messages`;

async function say(to, text) {
    console.log('->', to, '|', text.slice(0,70).replace(/\n/g,' '));
    try {
        await axios.post(WA_URL(),
            { messaging_product:'whatsapp', to, type:'text', text:{ body:text, preview_url:false } },
            { headers:WA_H(), timeout:12000 });
    } catch(e) { console.error('say FAIL:', e.response?.data?.error?.message||e.message); }
}

// Max 3 buttons
async function sendBtns(to, body, btns) {
    try {
        await axios.post(WA_URL(), {
            messaging_product:'whatsapp', to, type:'interactive',
            interactive: {
                type  : 'button',
                body  : { text: body },
                action: { buttons: btns.slice(0,3).map(b=>({
                    type:'reply', reply:{ id:b.id, title:b.label.slice(0,20) }
                }))}
            }
        }, { headers:WA_H(), timeout:12000 });
    } catch(e) { await say(to, body); }
}

// List — up to 10 rows
async function sendList(to, body, sections, btnLabel='Select Karein') {
    try {
        await axios.post(WA_URL(), {
            messaging_product:'whatsapp', to, type:'interactive',
            interactive: {
                type  : 'list',
                body  : { text: body },
                action: { button: btnLabel, sections }
            }
        }, { headers:WA_H(), timeout:12000 });
    } catch(e) { await say(to, body); }
}

// ── CARDS ─────────────────────────────────────────────────────────────────────

function tokenCard(name, token, date, status, problem) {
    const st = status === 'in_progress' ? '✅ Andar Hain' : '⏳ Intezaar Mein';
    let c = `👤 Naam: ${name}\n🎫 Apka Number: #${token}\n📅 Taareekh: ${niceDate(date)}\n📍 Haal: ${st}`;
    if (problem) c += `\n🏥 Masla: ${problem}`;
    return c;
}

function lineCard(s) {
    const cur  = s.currentServingToken ? `#${s.currentServingToken}` : 'Abhi shuru nahi hua';
    const who  = s.inProgressPatient ? ` (${s.inProgressPatient.name})` : '';
    const waiting = s.waitingCount || 0;

    let card = `\n`;
    card += `║   LINE KI HALAT          ║\n`;
    card += `═══════════════\n`;
    card += `║ ✅ Abhi Andar: ${cur}${who}\n`;
    card += `║ ⏳ Intezaar Mein: ${waiting} log\n`;
    card += `╚═══════════════\n\n`;
    card += `🎫 Apna number likhein — hum batayenge aap ka number kab aaye ga.`;

    return card;
}

function doctorCard(doc) {
    const days = (doc.availableDays||[]).map(d=>DAY_NAMES[d]).join(', ');
    let c = `👨‍⚕️ *${doc.name||'Doctor'}*\n`;
    if (doc.specialization) c += `🏥 ${doc.specialization}\n`;
    c += `💰 Fees: Rs. ${doc.consultationFee||1000}/-\n`;
    if (doc.timings) c += `⏰ Waqt: ${doc.timings}\n`;
    if (days)        c += `📅 Din: ${days}\n`;
    if (doc.address) c += `📍 Pata: ${doc.address}\n`;
    if (doc.phone)   c += `📞 Phone: ${doc.phone}`;
    return c;
}

// ── AI CHAT ───────────────────────────────────────────────────────────────────
async function aiChat(phone, name, hist, userMsg) {
    const sys = `Tu Mustafa Clinic ka sahayak hai. Sirf Roman Urdu mein jawab do. Max 2 lines. Simple Pakistani alfaaz use karo.`;
    try {
        const res = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            { model:CFG.MODEL, temperature:0.3, max_tokens:80,
              messages:[{role:'system',content:sys},...hist.slice(-4),{role:'user',content:userMsg}] },
            { headers:{ Authorization:'Bearer '+CFG.AI_KEY,'Content-Type':'application/json',
                        'HTTP-Referer':'https://mustafaclinic.com','X-Title':'Mustafa Clinic Bot'},
              timeout:18000 }
        );
        return res.data.choices[0].message.content.trim();
    } catch(e) { return 'Samajh nahi aaya. Neechay se batayein.'; }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
async function handle(phone, text, btnId) {
    const pt   = await dbGet('wa_patients', phone);
    const step = pt.step   || 'idle';
    const draft= pt.draft  || {};
    const hist = pt.history|| [];
    const grtd = !!pt.greeted;

    console.log('IN', phone, step, btnId||'-', (text||'').slice(0,30));

    // ═══════════════════════════════════════════════════════════════════════════
    // BUTTON / LIST RESPONSES
    // ═══════════════════════════════════════════════════════════════════════════
    if (btnId) {

        // ── Appointment book ───────────────────────────────────────────────────
        if (btnId === 'BOOK' || btnId === 'FORCE_BOOK') {
            const dates = await getOpenDates(6);
            if (!dates.length) {
                await sendBtns(phone,
                    'Doctor abhi available nahi hain.\nKuch din baad dobara try karein.',
                    [{ id:'DOCTOR', label:'👨‍⚕️ Doctor Ka Waqt Dekhein' },
                     { id:'NO',     label:'✅ Theek Hai'              }]
                );
                return;
            }
            if (btnId === 'BOOK') {
                const existing = await hasActiveBooking(phone, tomorrow()) ||
                                 await hasActiveBooking(phone, today());
                if (existing) {
                    await sendBtns(phone,
                        `Aap ki pehle se booking hai:\n` +
                        tokenCard(existing.name, existing.token, existing.date||tomorrow(), existing.status, existing.problem) +
                        `\n\nKya phir bhi naya book karna chahte hain?`,
                        [{ id:'FORCE_BOOK', label:'✅ Haan, Naya Book Karein'  },
                         { id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
                         { id:'NO',         label:'❌ Nahi'                    }]
                    );
                    return;
                }
            }
            await dbSet('wa_patients', phone, { step:'need_name', draft:{}, greeted:true });
            await sendBtns(phone,
                'Apna poora naam likhein:',
                [{ id:'NO', label:'⬅️ Wapas' }]
            );
            return;
        }

        // ── Queue / Line check ─────────────────────────────────────────────────
        if (btnId === 'QUEUE') {
            const s = await getQueueStatus(today());
            await sendBtns(phone,
                s ? lineCard(s) : '⚠️ Abhi line ki maloomat available nahi.',
                [{ id:'BOOK',      label:'📅 Appointment Book Karein'  },
                 { id:'NUM_LOOKUP',label:'🔍 چیک اپوائنٹمنٹ' },
                 { id:'DOCTOR',    label:'👨‍⚕️ Doctor Info'                 }]
            );
            return;
        }

        // ── Doctor info ────────────────────────────────────────────────────────
        if (btnId === 'DOCTOR') {
            const doc = await getDoctor();
            await sendBtns(phone,
                doc ? doctorCard(doc) : '⚠️ Doctor ki maloomat abhi available nahi.',
                MAIN_BTNS
            );
            return;
        }

        // ── Number lookup ──────────────────────────────────────────────────────
        if (btnId === 'NUM_LOOKUP') {
            await dbSet('wa_patients', phone, { step:'need_num_lookup' });
            await sendBtns(phone,
                '🔍 Apna mobile number likhein:\nMisal: 0300-1234567',
                [{ id:'NO', label:'⬅️ Wapas' }]
            );
            return;
        }

        // ── Cancel flow ────────────────────────────────────────────────────────
        if (btnId === 'DO_CANCEL') {
            let found = null;
            for (let i=0; i<=7; i++) {
                const d = toDateStr(new Date(Date.now()+i*86400000));
                found = await hasActiveBooking(phone, d);
                if (found) { found.date = d; break; }
            }
            if (found) {
                await sendBtns(phone,
                    `❌ Apka Number #${found.token} cancel karein?\n📅 ${niceDate(found.date)}`,
                    [{ id:'YES_CANCEL', label:'✅ Haan, Cancel Karein' },
                     { id:'NO',         label:'❌ Nahi'                }]
                );
                await dbSet('wa_patients', phone, { cancelTarget:{ date:found.date, token:found.token } });
            } else {
                await sendBtns(phone,
                    '⚠️ Koi active booking nahi mili.\n🔍 Apna number likh kar dekhein.',
                    [{ id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
                     { id:'BOOK',       label:'📅 Naya Book Karein'         }]
                );
            }
            return;
        }

        if (btnId === 'YES_CANCEL') {
            const ct = pt.cancelTarget;
            if (ct) {
                await cancelBooking(phone, ct.date, ct.token);
                await dbSet('wa_patients', phone, { cancelTarget:null });
                await sendBtns(phone,
                    '✅ Booking cancel ho gayi.\n📞 Dobara zaroorat ho toh batayein.',
                    MAIN_BTNS
                );
            } else {
                await sendBtns(phone,
                    '⚠️ Pehle apni booking dekhein.',
                    [{ id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
                     { id:'NO',         label:'⬅️ Wapas'                    }]
                );
            }
            return;
        }

        // ── NO / Wapas ─────────────────────────────────────────────────────────
        if (btnId === 'NO') {
            await dbSet('wa_patients', phone, { step:'idle', draft:{} });
            await sendBtns(phone, '👋 Kya khidmat kar sakta hoon?', MAIN_BTNS);
            return;
        }

        // ── Edit naam ──────────────────────────────────────────────────────────
        if (btnId === 'EDIT') {
            await dbSet('wa_patients', phone, { step:'need_name', draft:{} });
            await sendBtns(phone, '✏️ Dobara naam likhein:', [{ id:'NO', label:'⬅️ Wapas' }]);
            return;
        }

        // ── Date selection from list ───────────────────────────────────────────
        if (btnId.startsWith('DATE_')) {
            const date = btnId.replace('DATE_','');
            if (!isFuture(date)) {
                await sendBtns(phone, '⚠️ Yeh taareekh sahi nahi. Dobara chunein.',
                    [{ id:'BOOK', label:'📅 Dobara Chunein' },
                     { id:'NO',   label:'⬅️ Wapas'          }]
                );
                return;
            }
            await dbSet('wa_patients', phone, { step:'need_phone', draft:{ ...draft, date } });
            await sendBtns(phone,
                `✅ ${niceDate(date)} — theek hai.\n\n📞 Ab apna phone number likhein:\nMisal: 0300-1234567\n\n⚠️ *ZAROORI:* Agar number nahi dya toh booking cancel ho jayegi!`,
                [{ id:'CONFIRM_PHONE', label:'✅ Aagay Barho' }]
            );
            return;
        }

        // ── Skip phone ─────────────────────────────────────────────────────────
        if (btnId === 'SKIP_PHONE') {
            await sendBtns(phone,
                '⚠️ Phone number ke baghair hum aap se rabta nahi kar sakte.\nPak ke skip karna chahte hain?',
                [{ id:'CONFIRM_SKIP', label:'✅ Haan, Aagay Barho' },
                 { id:'NO',           label:'📞 Number Deta Hoon'  }]
            );
            return;
        }

        if (btnId === 'CONFIRM_SKIP') {
            await dbSet('wa_patients', phone, { step:'need_problem', draft:{ ...draft, phone:null } });
            await sendBtns(phone,
                '🏥 Koi khas masla ya takleef batana chahte hain?',
                [{ id:'NO_PROBLEM', label:'❌ Nahi, Skip' }]
            );
            return;
        }

        if (btnId === 'CONFIRM_PHONE') {
            await dbSet('wa_patients', phone, { step:'need_phone', draft });
            await sendBtns(phone,
                '📞 Apna phone number likhein:\nMisal: 0300-1234567',
                [{ id:'NO', label:'⬅️ Wapas' }]
            );
            return;
        }

        if (btnId === 'NO_PROBLEM') {
            const nd = { ...draft, problem:null };
            await dbSet('wa_patients', phone, { step:'confirm', draft:nd });
            await sendBtns(phone,
                `✅ Confirm karein:\n👤 Naam: ${nd.name}\n📅 Taareekh: ${niceDate(nd.date)}\n📞 Phone: ${nd.phone||'❌ Nahi diya'}`,
                [{ id:'YES',  label:'✅ Haan, Confirm'  },
                 { id:'EDIT', label:'✏️ Tabdeel Karein'  },
                 { id:'NO',   label:'⏸️ Baad Mein'       }]
            );
            return;
        }

        // ── Final confirm ──────────────────────────────────────────────────────
        if (btnId === 'YES') {
            if (!draft.name || !draft.date || !isFuture(draft.date)) {
                await dbSet('wa_patients', phone, { step:'idle', draft:{} });
                await sendBtns(phone,
                    '⚠️ Kuch maloomat ghum ho gayi. Dobara try karein.',
                    [{ id:'BOOK', label:'📅 Dobara Book Karein' },
                     { id:'NO',   label:'⬅️ Wapas'              }]
                );
                return;
            }
            if (!draft.phone) {
                await dbSet('wa_patients', phone, { step:'idle', draft:{} });
                await sendBtns(phone,
                    '❌ Phone number zaroori hai! Booking cancel ho gayi.\n\n📞 Dobara try karein aur number zaroor dein.',
                    [{ id:'BOOK', label:'📅 Dobara Book Karein' },
                     { id:'NO',   label:'⬅️ Wapas'              }]
                );
                return;
            }
            const existing = await hasActiveBooking(phone, draft.date);
            if (existing) {
                await dbSet('wa_patients', phone, { step:'idle', draft:{} });
                await sendBtns(phone,
                    `⚠️ Is taareekh ke liye pehle se booking hai.\n` +
                    tokenCard(existing.name, existing.token, draft.date, existing.status, existing.problem),
                    [{ id:'NUM_LOOKUP', label:'🔍 اپنے موبائل سے پتا کریں' },
                     { id:'NO',         label:'✅ Theek Hai'               }]
                );
                return;
            }
            try {
                const token = await bookAppointment(draft.phone||phone, draft.name, draft.date, draft.problem);
                const doc   = await getDoctor();
                await dbSet('wa_patients', phone, { step:'idle', draft:{}, greeted:true, name:draft.name });
                await sendBtns(phone,
                    `✅ Booking ho gayi!\n` +
                    tokenCard(draft.name, token, draft.date, 'Intezaar Mein', draft.problem) +
                    `\n💰 Fees: Rs. ${doc?.consultationFee||1000}/-\n\n⏰ Waqt par tashreef laaein. Apka Number *#${token}* yaad rakhein.`,
                    POST_BOOK_BTNS
                );
            } catch(e) {
                console.error('bookAppointment ERR:', e.message);
                await sendBtns(phone,
                    '❌ Booking nahi ho saki. Dobara try karein.',
                    [{ id:'BOOK', label:'📅 Dobara Try Karein' },
                     { id:'NO',   label:'⬅️ Wapas'              }]
                );
            }
            return;
        }

        // Unknown button fallback
        await sendBtns(phone, 'Kya khidmat kar sakta hoon?', MAIN_BTNS);
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TEXT STEPS
    // ═══════════════════════════════════════════════════════════════════════════
    const t = (text||'').trim();

    // ── Number lookup: user apna number type karta hai ────────────────────────
    if (step === 'need_num_lookup') {
        await dbSet('wa_patients', phone, { step:'idle' });
        const cleaned = t.replace(/[^\d+]/g,'');
        if (cleaned.length < 10) {
            await sendBtns(phone,
                '⚠️ Sahi number likhein.\nMisal: 0300-1234567',
                [{ id:'NUM_LOOKUP', label:'🔍 Dobara Try Karein' },
                 { id:'NO',         label:'⬅️ Wapas'             }]
            );
            return;
        }
        const bookings = await findBookingsByPhone(cleaned);
        if (!bookings.length) {
            await sendBtns(phone,
                `❌ ${cleaned} se koi booking nahi mili.\n🤔 Shayad alag number se ki ho.`,
                [{ id:'BOOK',      label:'📅 Naya Book Karein'   },
                 { id:'NUM_LOOKUP',label:'🔍 Dobara Try Karein'  },
                 { id:'NO',        label:'⬅️ Wapas'              }]
            );
        } else {
            const s = await getQueueStatus(today());
            let msg = `📱 ${cleaned} ki bookings:\n\n`;
            bookings.forEach((b, i) => {
                const st    = b.status === 'in_progress' ? '✅ Andar Hain' : '⏳ Intezaar Mein';
                const ahead = (s && b.status === 'waiting' && s.currentServingToken)
                    ? Math.max(0, b.token - s.currentServingToken) : null;
                msg += `🎫 Apka Number: #${b.token} — ${st}\n`;
                msg += `📅 ${niceDate(b.date)}\n`;
                if (ahead !== null) msg += `👥 Aap se pehle: ${ahead} log\n`;
                if (b.problem) msg += `🏥 Masla: ${b.problem}\n`;
                if (i < bookings.length-1) msg += `\n`;
            });
            await sendBtns(phone, msg,
                [{ id:'QUEUE',    label:'⏳ چلنے والا نمبر' },
                 { id:'DO_CANCEL',label:'❌ Booking Cancel Karein'    },
                 { id:'DOCTOR',   label:'👨‍⚕️ Doctor Info'                 }]
            );
        }
        return;
    }

    // ── Naam ──────────────────────────────────────────────────────────────────
    if (step === 'need_name') {
        const name = t.split(/\s+/).slice(0,4).join(' ');
        if (name.length < 2) {
            await sendBtns(phone, '👤 Poora naam likhein:', [{ id:'NO', label:'⬅️ Wapas' }]);
            return;
        }
        const nd = { ...draft, name };
        await dbSet('wa_patients', phone, { step:'need_date', draft:nd });
        const dates = await getOpenDates(6);
        if (!dates.length) {
            await dbSet('wa_patients', phone, { step:'idle', draft:{} });
            await sendBtns(phone, '⚠️ Doctor abhi available nahi. Baad mein try karein.',
                [{ id:'DOCTOR', label:'👨‍⚕️ Doctor Ka Waqt Dekhein' },
                 { id:'NO',     label:'✅ Theek Hai'              }]
            );
            return;
        }
        const rows = dates.map(d => ({
            id         : 'DATE_'+d,
            title      : niceDate(d),
            description: d,
        }));
        await sendList(phone,
            `👤 ${name} — kaunsi taareekh chahiye?`,
            [{ title:'📅 Available Taareekh', rows }],
            '📅 Taareekh Chunein'
        );
        return;
    }

    // ── Phone ─────────────────────────────────────────────────────────────────
    if (step === 'need_phone') {
        const cleaned = t.replace(/[^\d+]/g,'');
        if (cleaned.length < 10) {
            await sendBtns(phone,
                '⚠️ Phone number sahi nahi.\nMisal: 0300-1234567',
                [{ id:'SKIP_PHONE', label:'⬅️ Wapas' }]
            );
            return;
        }
        await dbSet('wa_patients', phone, { step:'need_problem', draft:{ ...draft, phone:cleaned } });
        await sendBtns(phone,
            `✅ Phone: ${cleaned}\n\n🏥 Koi khas masla ya takleef batana chahte hain?`,
            [{ id:'NO_PROBLEM', label:'❌ Nahi, Skip' }]
        );
        return;
    }

    // ── Masla / Problem ───────────────────────────────────────────────────────
    if (step === 'need_problem') {
        const nd = { ...draft, problem:t };
        await dbSet('wa_patients', phone, { step:'confirm', draft:nd });
        await sendBtns(phone,
            `✅ Confirm karein:\n👤 Naam: ${nd.name}\n📅 Taareekh: ${niceDate(nd.date)}\n📞 Phone: ${nd.phone||'❌ Nahi diya'}\n🏥 Masla: ${nd.problem}`,
            [{ id:'YES',  label:'✅ Haan, Confirm'  },
             { id:'EDIT', label:'✏️ Tabdeel Karein'  },
             { id:'NO',   label:'⏸️ Baad Mein'       }]
        );
        return;
    }

    // ── Confirm step ──────────────────────────────────────────────────────────
    if (step === 'confirm') {
        await sendBtns(phone,
            `✅ Confirm karein:\n👤 Naam: ${draft.name}\n📅 Taareekh: ${niceDate(draft.date)}\n📞 Neechay button dabayein:`,
            [{ id:'YES',  label:'✅ Haan, Confirm'  },
             { id:'EDIT', label:'✏️ Tabdeel Karein'  },
             { id:'NO',   label:'⏸️ Baad Mein'       }]
        );
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // IDLE — keyword routing
    // ═══════════════════════════════════════════════════════════════════════════

    // Token number check — user sends just a number like "5"
    const tokenNum = parseInt(t);
    if (!isNaN(tokenNum) && tokenNum > 0 && tokenNum < 1000) {
        const found = await findByToken(tokenNum);
        if (found) {
            const s     = await getQueueStatus(today());
            const st    = found.status === 'in_progress' ? '✅ Andar Hain' : '⏳ Intezaar Mein';
            const ahead = (s && found.status === 'waiting' && s.currentServingToken)
                ? Math.max(0, found.token - s.currentServingToken) : null;
            let msg = `🎫 Apka Number: #${found.token}\n📅 ${niceDate(found.date)}\n📍 Haal: ${st}`;
            if (ahead !== null) msg += `\n👥 Aap se pehle: ${ahead} log`;
            await sendBtns(phone, msg,
                [{ id:'QUEUE',     label:'⏳ چلنے والا نمبر' },
                 { id:'NUM_LOOKUP',label:'🔍 اپنے موبائل سے پتا کریں' },
                 { id:'NO',        label:'✅ Shukriya'                 }]
            );
        } else {
            await sendBtns(phone,
                `❌ Apka Number #${tokenNum} nahi mila.\n🔍 Apna mobile number likh kar dekhein:`,
                [{ id:'NUM_LOOKUP', label:'🔍 اپنے موبائل سے پتا کریں' },
                 { id:'BOOK',       label:'📅 Naya Book Karein'         }]
            );
        }
        return;
    }

    // ── Greeting ───────────────────────────────────────────────────────────────
    if (/^(hi|hello|hey|snga ye|zma|salam|assalam|aoa|walaikum|good\s*(morning|evening|night)|gm\b|helo|hii+|start|السلام|وعليكم|جی|جي|shukriya|شکریہ)/.test(t.toLowerCase())) {
        await dbSet('wa_patients', phone, { greeted:true, step:'idle' });

        if (grtd) {
            // Returning user — short
            await sendBtns(phone, '👋 Dobara khush amdeed! Kya khidmat kar sakta hoon?', MAIN_BTNS);
        } else {
            // FIRST TIME — 5 options via sendList
            const doc = await getDoctor();
            let header = `السلام علیکم! 👋\nMustafa Clinic mein aap ka khush amdeed.`;
            if (doc) {
                header += `\n\n👨‍⚕️ ڈاکٹر: ${doc.name||''}`;
                if (doc.consultationFee) header += ` | 💰 فیس: Rs.${doc.consultationFee}/-`;
                if (doc.timings) header += `\n⏰ وقت: ${doc.timings}`;
            }
            header += `\n\n👋 Kya khidmat kar sakta hoon?`;

            await sendList(phone, header,
                [{ title:'🏥 Hamari Khidmat', rows: WELCOME_ROWS }],
                'Select Karein'
            );
        }
        return;
    }

    // ── Queue keywords ─────────────────────────────────────────────────────────
    if (/(queue|line|intezar|wait|chal\s*raha|number.*chal|kitna|abhi|current|running|لائن|قطار|انتظار|چل|نمبر)/.test(t.toLowerCase())) {
        const s = await getQueueStatus(today());
        await sendBtns(phone,
            s ? lineCard(s) : '⚠️ Abhi line ki maloomat nahi.',
            [{ id:'BOOK',      label:'📅 Appointment Book Karein'  },
             { id:'NUM_LOOKUP',label:'🔍 چیک اپوائنٹمنٹ' },
             { id:'DOCTOR',    label:'👨‍⚕️ Doctor Info'                 }]
        );
        return;
    }

    // ── Doctor keywords ────────────────────────────────────────────────────────
    if (/(doctor|dr\b|fee|fees|charge|timing|waqt|schedule|address|pata|info|band|open|chutti)/.test(t.toLowerCase())) {
        const doc = await getDoctor();
        await sendBtns(phone,
            doc ? doctorCard(doc) : '⚠️ Doctor ki maloomat abhi nahi.',
            MAIN_BTNS
        );
        return;
    }

    // ── Number / booking lookup keywords ──────────────────────────────────────
    if (/(mobile|apna.*number|apni.*booking|booking.*dekhein|pata.*karo|kab.*ayega|kab.*aana|number.*se.*dhundh)/.test(t.toLowerCase())) {
        await dbSet('wa_patients', phone, { step:'need_num_lookup' });
        await sendBtns(phone,
            '🔍 Apna mobile number likhein:\nMisal: 0300-1234567',
            [{ id:'NO', label:'⬅️ Wapas' }]
        );
        return;
    }

    // ── Book keywords ──────────────────────────────────────────────────────────
    if (/(appointment|book|slot|token).*(chahiye|lena|karni|karna|do|dain|hai)/.test(t.toLowerCase()) ||
        t.toLowerCase() === 'appointment' || t.toLowerCase() === 'book') {
        const dates = await getOpenDates(6);
        if (!dates.length) {
            await sendBtns(phone,
                '⚠️ Doctor abhi available nahi. Baad mein try karein.',
                [{ id:'DOCTOR', label:'👨‍⚕️ Doctor Ka Waqt Dekhein' },
                 { id:'NO',     label:'✅ Theek Hai'              }]
            );
            return;
        }
        const existing = await hasActiveBooking(phone, tomorrow());
        if (existing) {
            await sendBtns(phone,
                `⚠️ Pehle se booking hai:\n` +
                tokenCard(existing.name, existing.token, tomorrow(), existing.status, existing.problem) +
                `\n\nKya phir bhi naya chahiye?`,
                [{ id:'FORCE_BOOK', label:'✅ Haan, Naya Book Karein'  },
                 { id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
                 { id:'NO',         label:'❌ Nahi'                    }]
            );
            return;
        }
        await dbSet('wa_patients', phone, { step:'need_name', draft:{}, greeted:true });
        await sendBtns(phone, '👤 Apna poora naam likhein:', [{ id:'NO', label:'⬅️ Wapas' }]);
        return;
    }

    // ── Cancel keywords ────────────────────────────────────────────────────────
    if (/(cancel|band\s*karo|nahi\s*chahiye|hatao|mita\s*do)/.test(t.toLowerCase())) {
        let found = null;
        for (let i=0; i<=7; i++) {
            const d = toDateStr(new Date(Date.now()+i*86400000));
            found = await hasActiveBooking(phone, d);
            if (found) { found.date = d; break; }
        }
        if (found) {
            await sendBtns(phone,
                `❌ Apka Number #${found.token} cancel karein?\n📅 ${niceDate(found.date)}`,
                [{ id:'YES_CANCEL', label:'✅ Haan, Cancel Karein' },
                 { id:'NO',         label:'❌ Nahi'                }]
            );
            await dbSet('wa_patients', phone, { cancelTarget:{ date:found.date, token:found.token } });
        } else {
            await sendBtns(phone,
                '⚠️ Koi active booking nahi mili.\n🔍 Apna number likh kar dekhein.',
                [{ id:'NUM_LOOKUP', label:'🔍 چیک اپوائنٹمنٹ' },
                 { id:'BOOK',       label:'📅 Naya Book Karein'         }]
            );
        }
        return;
    }

    // ── General AI (last resort) ───────────────────────────────────────────────
    const reply = await aiChat(phone, pt.name, hist, t);
    const newHist = [...hist,
        { role:'user', content:t }, { role:'assistant', content:reply }
    ].slice(-8);
    await dbSet('wa_patients', phone, { history:newHist, greeted:true, step:'idle' });
    await sendBtns(phone, reply, MAIN_BTNS);
}


// ── ADMIN ─────────────────────────────────────────────────────────────────────
function adm(req, res, next) {
    const key = (req.headers['authorization']||'').replace(/^Bearer\s+/i,'').trim();
    if (key !== CFG.ADM_KEY) return res.status(403).json({ error:'nope' });
    next();
}

app.get('/', (_, r) => r.send('✅ Mustafa Clinic Bot v16 LIVE'));

app.get('/admin/queue', adm, async (req, res) => {
    const date = req.query.date || today();
    try {
        const s    = await getQueueStatus(date);
        const snap = await patientsRef(date).orderBy('token').get();
        const list = []; snap.forEach(d => list.push({ id:d.id, ...d.data() }));

        // Format queue as table
        let tableMsg = `📊 QUEUE STATUS — ${niceDate(date)}\n`;
        tableMsg += `╔════════════════════════════════════════╗\n`;
        tableMsg += `║ 🎫 Token │ 👤 Name │ 📍 Status      ║\n`;
        tableMsg += `╠════════════════════════════════════════╣\n`;

        list.forEach(p => {
            const status = p.status === 'in_progress' ? '✅ Andar' : '⏳ Intezaar';
            const name = (p.name || 'N/A').slice(0, 10);
            tableMsg += `║ #${String(p.token).padEnd(5)} │ ${name.padEnd(10)} │ ${status.padEnd(14)} ║\n`;
        });

        tableMsg += `╚════════════════════════════════════════╝\n`;
        tableMsg += `\n⏳ Intezaar Mein: ${s.waitingCount} log\n`;
        tableMsg += `✅ Abhi Andar: ${s.currentServingToken ? '#' + s.currentServingToken : 'Shuru nahi'}`;

        res.json({ date, ...s, patients:list, tableFormat: tableMsg });
    } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/admin/doctor', adm, async (req, res) => {
    const doc = await getDoctor();
    res.json(doc || { error:'❌ No doctor found' });
});

app.post('/admin/send', adm, async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error:'phone+message required' });
    await say(phone, message);
    res.json({ ok:true, status:'✅ Message sent' });
});

// ── WEBHOOK ───────────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) =>
    req.query['hub.verify_token'] === CFG.VER_TOK
        ? res.send(req.query['hub.challenge'])
        : res.sendStatus(403)
);

const REPLIT_URL = process.env.REPLIT_URL;
if (REPLIT_URL) {
    setInterval(async () => {
        try {
            await axios.get(REPLIT_URL+'/ping', { timeout:8000 });
            console.log('Self-ping OK');
        } catch(e) { console.warn('Self-ping fail:', e.message); }
    }, 4*60*1000);
}

app.get('/ping', (_, r) => r.send('pong'));

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    console.log('WEBHOOK:', JSON.stringify(req.body).slice(0,300));
    try {
        const val = req.body?.entry?.[0]?.changes?.[0]?.value;
        if (val?.statuses?.length) return;
        if (!val?.messages?.length) return;
        const msg  = val.messages[0];
        const from = msg.from;
        if (msg.type === 'text') {
            const text = msg.text?.body?.trim();
            if (text) await handle(from, text, null);
        } else if (msg.type === 'interactive') {
            const itype = msg.interactive?.type;
            const btnId =
                itype === 'button_reply' ? msg.interactive.button_reply?.id :
                itype === 'list_reply'   ? msg.interactive.list_reply?.id   : null;
            if (btnId) await handle(from, '', btnId);
        } else {
            await handle(from, msg.type, null);
        }
    } catch(e) {
        console.error('WEBHOOK ERR:', e.message, e.stack?.slice(0,200));
    }
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🏥 MUSTAFA CLINIC BOT v16 — PORT ' + PORT);
    console.log('✅ Bot is running and ready to serve patients');
});