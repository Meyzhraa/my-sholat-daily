/**
 * MY SHOLAT DIARY
 * Little Steps, Better Ibadah Every Day.
 */

const STORAGE_KEY = 'my_sholat_diary_v1';

const PRAYERS = [
  { id: 'Fajr', name: 'Subuh', icon: '🌅' },
  { id: 'Dhuhr', name: 'Dzuhur', icon: '☀️' },
  { id: 'Asr', name: 'Ashar', icon: '🌤️' },
  { id: 'Maghrib', name: 'Maghrib', icon: '🌇' },
  { id: 'Isha', name: 'Isya', icon: '🌙' }
];

const SUNNAH_LIST = [
  { id: 'dhuha', label: 'Sholat Dhuha' },
  { id: 'tahajud', label: 'Sholat Tahajud' },
  { id: 'rawatib', label: 'Sholat Rawatib' },
  { id: 'witir', label: 'Sholat Witir' },
  { id: 'dzikir_pagi', label: 'Dzikir Pagi' },
  { id: 'dzikir_petang', label: 'Dzikir Petang' },
  { id: 'quran', label: 'Membaca Al-Qur\'an' },
  { id: 'sedekah', label: 'Sedekah' },
  { id: 'alkahfi', label: 'Membaca Al-Kahfi' }
];

const METHOD_NAMES = {
  '20': 'Kemenag RI',
  '11': 'MUIS Singapura',
  '17': 'JAKIM Malaysia',
  '3': 'MWL',
  '4': 'Umm Al-Qura',
  '2': 'ISNA',
  '5': 'Egyptian Survey'
};

// Sumber Audio Azan Publik (Wikimedia Commons - Legal & Bebas Akses)
const AZAN_SOURCES = {
  makkah: 'https://upload.wikimedia.org/wikipedia/commons/e/e4/Adhan_Makkah.ogg',
  madinah: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Adhan_Madinah.ogg',
  soft_chime: 'synth' // Fallback Web Audio API chime lembut tanpa koneksi luar
};

// Default State
function getDefaultState() {
  return {
    settings: {
      city: 'Jakarta, Indonesia',
      lat: -6.1751,
      lng: 106.8650,
      method: '20',
      timeFormat: '24',
      theme: 'sage',
      azanAudio: 'makkah',
      volume: 0.8,
      reminders: {
        Fajr: true,
        Dhuhr: true,
        Asr: true,
        Maghrib: true,
        Isha: true
      }
    },
    cachedSchedules: {}, // { "YYYY-MM-DD": { timings: {...}, hijri: "..." } }
    tracker: {},         // { "YYYY-MM-DD": { wajib: { Fajr: 'done'|'pending'|'missed' }, sunnah: [] } }
    journals: {},        // { "YYYY-MM-DD": { gratitude, dua, target, reflection, updatedAt } }
    doaCounts: {}        // { "YYYY-MM-DD": { "doa-dhuha": 1 } }
  };
}

let appState = loadState();
let currentDateStr = getTodayStr();
let selectedTrackerDate = currentDateStr;
let selectedJournalDate = currentDateStr;
let calendarCursor = new Date();
let selectedCalendarDate = currentDateStr;

let audioUnlocked = false;
let azanAudioPlayer = new Audio();
let triggeredAlarmsToday = {}; // Mencegah alarm berbunyi berulang di menit yang sama
let activeRingingPrayer = null;

// ================= HELPER TANGGAL =================
function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDateStr(dateStr, daysDelta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + daysDelta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDateIndo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatTimeDisplay(time24) {
  if (!time24) return '--:--';
  const clean = time24.split(' ')[0];
  if (appState.settings.timeFormat === '24') return clean;
  let [h, min] = clean.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} ${suffix}`;
}

// ================= PENYIMPANAN LOCALSTORAGE =================
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    const def = getDefaultState();
    return {
      settings: { ...def.settings, ...(parsed.settings || {}) },
      cachedSchedules: parsed.cachedSchedules || {},
      tracker: parsed.tracker || {},
      journals: parsed.journals || {},
      doaCounts: parsed.doaCounts || {}
    };
  } catch (e) {
    console.error('Gagal membaca LocalStorage:', e);
    return getDefaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    showToast('Gagal menyimpan data ke perangkat.');
  }
}

function ensureDayRecord(dateStr) {
  if (!appState.tracker[dateStr]) {
    appState.tracker[dateStr] = {
      wajib: {
        Fajr: 'pending',
        Dhuhr: 'pending',
        Asr: 'pending',
        Maghrib: 'pending',
        Isha: 'pending'
      },
      sunnah: []
    };
  }
  return appState.tracker[dateStr];
}

// ================= TOAST & UI FEEDBACK =================
let toastTimeout;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 2600);
}

// ================= ALADHAN API & JADWAL SHOLAT =================
async function fetchPrayerTimes(dateStr = getTodayStr(), forceRefresh = false) {
  const { lat, lng, method } = appState.settings;
  const cacheKey = `${dateStr}_${lat.toFixed(2)}_${lng.toFixed(2)}_${method}`;

  if (!forceRefresh && appState.cachedSchedules[cacheKey]) {
    renderDashboardSchedule(appState.cachedSchedules[cacheKey]);
    return;
  }

  const loadingEl = document.getElementById('prayerLoading');
  loadingEl.classList.remove('hidden');

  const [y, m, d] = dateStr.split('-');
  const apiDate = `${d}-${m}-${y}`;
  const url = `https://api.aladhan.com/v1/timings/${apiDate}?latitude=${lat}&longitude=${lng}&method=${method}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response error');
    const json = await res.json();
    const data = json.data;

    const hijriObj = data.date.hijri;
    const hijriFormatted = `${hijriObj.day} ${hijriObj.month.en} ${hijriObj.year} H`;

    const scheduleData = {
      timings: {
        Fajr: data.timings.Fajr.split(' ')[0],
        Dhuhr: data.timings.Dhuhr.split(' ')[0],
        Asr: data.timings.Asr.split(' ')[0],
        Maghrib: data.timings.Maghrib.split(' ')[0],
        Isha: data.timings.Isha.split(' ')[0]
      },
      hijri: hijriFormatted
    };

    appState.cachedSchedules[cacheKey] = scheduleData;
    saveState();
    document.getElementById('offlineBanner').classList.add('hidden');
    renderDashboardSchedule(scheduleData);
  } catch (err) {
    // Fallback jika offline: gunakan jadwal terakhir yang ada di cache
    const allKeys = Object.keys(appState.cachedSchedules);
    if (allKeys.length > 0) {
      const latestFallback = appState.cachedSchedules[allKeys[allKeys.length - 1]];
      renderDashboardSchedule(latestFallback);
    } else {
      // Fallback darurat waktu standar Indonesia
      renderDashboardSchedule({
        timings: { Fajr: '04:35', Dhuhr: '11:55', Asr: '15:15', Maghrib: '17:58', Isha: '19:10' },
        hijri: 'Kalender Hijriah (Mode Offline)'
      });
    }
    document.getElementById('offlineBanner').classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function getTodayScheduleData() {
  const { lat, lng, method } = appState.settings;
  const cacheKey = `${currentDateStr}_${lat.toFixed(2)}_${lng.toFixed(2)}_${method}`;
  if (appState.cachedSchedules[cacheKey]) return appState.cachedSchedules[cacheKey];
  const keys = Object.keys(appState.cachedSchedules);
  return keys.length ? appState.cachedSchedules[keys[keys.length - 1]] : null;
}

// ================= RENDER BERANDA & COUNTDOWN =================
function renderDashboardSchedule(scheduleData) {
  document.getElementById('displayMasehi').textContent = formatDateIndo(currentDateStr);
  document.getElementById('displayHijri').textContent = scheduleData.hijri;
  document.getElementById('displayLocation').textContent = appState.settings.city;
  document.getElementById('displayMethodBadge').textContent = METHOD_NAMES[appState.settings.method] || 'Aladhan';

  const dayRec = ensureDayRecord(currentDateStr);
  const nextInfo = getNextPrayerInfo(scheduleData.timings);
  const listEl = document.getElementById('dashboardPrayerList');
  listEl.innerHTML = '';

  PRAYERS.forEach((p) => {
    const timeRaw = scheduleData.timings[p.id];
    const status = dayRec.wajib[p.id] || 'pending';
    const isNext = nextInfo && nextInfo.id === p.id && !nextInfo.isTomorrow;

    let statusText = 'Belum';
    let statusClass = 'status-pending';
    if (status === 'done') {
      statusText = '✓ Selesai';
      statusClass = 'status-done';
    } else if (status === 'missed') {
      statusText = 'Terlewat';
      statusClass = 'status-missed';
    }

    const item = document.createElement('div');
    item.className = `prayer-item ${isNext ? 'next-highlight' : ''}`;
    item.innerHTML = `
      <div class="prayer-item-left">
        <div class="prayer-icon-box">${p.icon}</div>
        <div>
          <div class="prayer-name">${p.name}</div>
          ${isNext ? '<div class="prayer-next-tag">Waktu Sholat Berikutnya</div>' : ''}
        </div>
      </div>
      <div class="prayer-item-right">
        <span class="prayer-time-text">${formatTimeDisplay(timeRaw)}</span>
        <span class="status-pill ${statusClass}">${statusText}</span>
      </div>
    `;

    // Klik cepat di beranda untuk toggle selesai / belum
    item.addEventListener('click', () => {
      const nextStatus = status === 'done' ? 'pending' : 'done';
      dayRec.wajib[p.id] = nextStatus;
      saveState();
      renderDashboardSchedule(scheduleData);
      renderTrackerView();
      showToast(`${p.name} ditandai ${nextStatus === 'done' ? 'sudah dilaksanakan' : 'belum dilaksanakan'}`);
    });

    listEl.appendChild(item);
  });

  updateHeroProgress();
}

function getNextPrayerInfo(timings) {
  if (!timings) return null;
  const now = new Date();
  for (const p of PRAYERS) {
    const [h, m] = timings[p.id].split(':').map(Number);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    if (target > now) {
      return { id: p.id, name: p.name, targetDate: target, isTomorrow: false };
    }
  }
  // Jika sudah lewat Isya, sholat berikutnya adalah Subuh besok
  const [fh, fm] = timings.Fajr.split(':').map(Number);
  const tomorrowFajr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, fh, fm, 0);
  return { id: 'Fajr', name: 'Subuh (Besok)', targetDate: tomorrowFajr, isTomorrow: true };
}

function updateCountdownAndCheckAlarm() {
  // Deteksi pergantian hari otomatis saat tengah malam
  const realToday = getTodayStr();
  if (realToday !== currentDateStr) {
    currentDateStr = realToday;
    selectedTrackerDate = realToday;
    selectedJournalDate = realToday;
    triggeredAlarmsToday = {};
    ensureDayRecord(realToday);
    fetchPrayerTimes(realToday);
    renderTrackerView();
    renderJournalView();
  }

  const scheduleData = getTodayScheduleData();
  if (!scheduleData) return;

  const now = new Date();
  const nextInfo = getNextPrayerInfo(scheduleData.timings);

  if (nextInfo) {
    const diffMs = Math.max(0, nextInfo.targetDate - now);
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);

    const formatted = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('nextPrayerLabel').textContent = `Menuju ${nextInfo.name}`;
    document.getElementById('countdownTimer').textContent = formatted;
    document.getElementById('countdownSub').textContent = `Pukul ${formatTimeDisplay(scheduleData.timings[nextInfo.id])} • ${appState.settings.city}`;
  }

  // Cek apakah tepat masuk waktu sholat (detik 00-02)
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  PRAYERS.forEach((p) => {
    const pTime = scheduleData.timings[p.id];
    const alarmKey = `${currentDateStr}_${p.id}`;
    if (pTime === currentHHMM && !triggeredAlarmsToday[alarmKey]) {
      triggeredAlarmsToday[alarmKey] = true;
      if (appState.settings.reminders[p.id]) {
        triggerAzanAlert(p, pTime);
      }
    }
  });
}

function updateHeroProgress() {
  const rec = ensureDayRecord(currentDateStr);
  const doneCount = PRAYERS.filter((p) => rec.wajib[p.id] === 'done').length;
  const pct = Math.round((doneCount / 5) * 100);
  document.getElementById('heroProgressText').textContent = `${doneCount}/5 Sholat Wajib Selesai (${pct}%)`;
  document.getElementById('heroProgressBar').style.width = `${pct}%`;
}

// ================= PENGINGAT & AUDIO AZAN =================
function unlockAudioContext() {
  audioUnlocked = true;
  document.getElementById('audioActivateBanner').classList.add('hidden');
  // Putar nada sunyi singkat untuk membuka izin autoplay browser
  playSoftChime(0.01);
  showToast('Suara pengingat azan siap digunakan pada sesi ini.');
}

function playSoftChime(customVol = null) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(528, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.6);
    const vol = customVol !== null ? customVol : Number(appState.settings.volume);
    gain.gain.setValueAtTime(vol * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch (e) {
    console.warn('Web Audio tidak didukung:', e);
  }
}

function playAzanAudio() {
  stopAzanAudio();
  const choice = appState.settings.azanAudio;
  const vol = Number(appState.settings.volume);

  if (choice === 'soft_chime') {
    playSoftChime(vol);
    return;
  }

  azanAudioPlayer.src = AZAN_SOURCES[choice];
  azanAudioPlayer.volume = vol;
  azanAudioPlayer.play().catch(() => {
    // Fallback ke soft chime jika file audio eksternal gagal dimuat / autoplay diblokir
    playSoftChime(vol);
    showToast('Memutar nada pengingat (izinkan audio di halaman).');
  });
}

function stopAzanAudio() {
  azanAudioPlayer.pause();
  azanAudioPlayer.currentTime = 0;
}

function triggerAzanAlert(prayerObj, timeStr) {
  activeRingingPrayer = prayerObj;
  document.getElementById('azanModalPrayerName').textContent = prayerObj.name;
  document.getElementById('azanModalTime').textContent = formatTimeDisplay(timeStr);
  document.getElementById('azanModal').classList.remove('hidden');

  if (audioUnlocked) {
    playAzanAudio();
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`Waktu Sholat ${prayerObj.name}`, {
      body: `Telah masuk waktu ${prayerObj.name} (${formatTimeDisplay(timeStr)}) untuk wilayah ${appState.settings.city}.`,
      icon: './manifest.json'
    });
  }
}

// ================= TRACKER SHOLAT & SUNNAH =================
function renderTrackerView() {
  const isToday = selectedTrackerDate === currentDateStr;
  document.getElementById('trackerDateLabel').textContent = isToday
    ? `Hari Ini (${selectedTrackerDate})`
    : formatDateIndo(selectedTrackerDate);

  const rec = ensureDayRecord(selectedTrackerDate);
  const doneCount = PRAYERS.filter((p) => rec.wajib[p.id] === 'done').length;
  const pct = Math.round((doneCount / 5) * 100);

  let quote = `Alhamdulillah, kamu sudah menyelesaikan ${doneCount} dari 5 sholat hari ini!`;
  if (doneCount === 0) quote = 'Bismillah, mari mulai langkah ibadah terbaik hari ini.';
  if (doneCount === 5) quote = 'MasyaAllah! 5 sholat wajib telah lengkap hari ini.';

  document.getElementById('trackerMotivationText').textContent = quote;
  document.getElementById('trackerPercent').textContent = `${pct}%`;
  document.getElementById('trackerProgressBar').style.width = `${pct}%`;

  // Render Wajib
  const wajibContainer = document.getElementById('wajibTrackerList');
  wajibContainer.innerHTML = '';

  PRAYERS.forEach((p) => {
    const currentStatus = rec.wajib[p.id] || 'pending';
    const row = document.createElement('div');
    row.className = 'tracker-row';
    row.innerHTML = `
      <div class="prayer-item-left">
        <div class="prayer-icon-box">${p.icon}</div>
        <div>
          <div class="prayer-name">${p.name}</div>
          <div class="small-muted">${currentStatus === 'done' ? 'Sudah dilaksanakan' : currentStatus === 'missed' ? 'Terlewat' : 'Belum dilaksanakan'}</div>
        </div>
      </div>
      <div class="status-selector">
        <button class="status-choice-btn ${currentStatus === 'done' ? 'active-done' : ''}" data-status="done">Sudah</button>
        <button class="status-choice-btn ${currentStatus === 'pending' ? 'active-pending' : ''}" data-status="pending">Belum</button>
        <button class="status-choice-btn ${currentStatus === 'missed' ? 'active-missed' : ''}" data-status="missed">Terlewat</button>
      </div>
    `;

    row.querySelectorAll('.status-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        rec.wajib[p.id] = btn.dataset.status;
        saveState();
        renderTrackerView();
        const sched = getTodayScheduleData();
        if (sched && selectedTrackerDate === currentDateStr) {
          renderDashboardSchedule(sched);
        }
        showToast(`Status ${p.name} diperbarui.`);
      });
    });

    wajibContainer.appendChild(row);
  });

  // Render Sunnah
  const sunnahContainer = document.getElementById('sunnahTrackerList');
  sunnahContainer.innerHTML = '';
  document.getElementById('sunnahCountBadge').textContent = `${rec.sunnah.length}/${SUNNAH_LIST.length} Amalan`;

  SUNNAH_LIST.forEach((s) => {
    const isChecked = rec.sunnah.includes(s.id);
    const card = document.createElement('div');
    card.className = `sunnah-item ${isChecked ? 'checked' : ''}`;
    card.innerHTML = `
      <div class="sunnah-checkbox">${isChecked ? '✓' : ''}</div>
      <span class="sunnah-label">${s.label}</span>
    `;

    card.addEventListener('click', () => {
      if (isChecked) {
        rec.sunnah = rec.sunnah.filter((item) => item !== s.id);
      } else {
        rec.sunnah.push(s.id);
      }
      saveState();
      renderTrackerView();
      showToast(`${s.label} ${!isChecked ? 'dicatat selesai' : 'dibatalkan'}.`);
    });

    sunnahContainer.appendChild(card);
  });
}

// ================= KALENDER IBADAH =================
function renderCalendarView() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();

  const monthTitle = new Date(year, month, 1).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric'
  });
  document.getElementById('calendarMonthTitle').textContent = monthTitle;

  const firstDayWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  for (let i = 0; i < firstDayWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rec = appState.tracker[dateStr];
    let colorClass = '';

    if (rec && rec.wajib) {
      const doneCount = PRAYERS.filter((p) => rec.wajib[p.id] === 'done').length;
      if (doneCount === 5) colorClass = 'cal-green';
      else if (doneCount > 0) colorClass = 'cal-yellow';
    }

    const cell = document.createElement('div');
    cell.className = `cal-day ${colorClass} ${dateStr === currentDateStr ? 'today' : ''} ${dateStr === selectedCalendarDate ? 'selected' : ''}`;
    cell.textContent = day;

    cell.addEventListener('click', () => {
      selectedCalendarDate = dateStr;
      renderCalendarView();
      renderCalendarDayDetail(dateStr);
    });

    grid.appendChild(cell);
  }

  renderCalendarDayDetail(selectedCalendarDate);
}

function renderCalendarDayDetail(dateStr) {
  document.getElementById('detailDateTitle').textContent = `Rekap ${formatDateIndo(dateStr)}`;
  const container = document.getElementById('detailDateContent');
  const rec = appState.tracker[dateStr];
  const journal = appState.journals[dateStr];

  if (!rec && !journal) {
    container.innerHTML = `<p class="small-muted mt-12">Belum ada catatan ibadah pada tanggal ini.</p>`;
    return;
  }

  const donePrayers = rec
    ? PRAYERS.filter((p) => rec.wajib[p.id] === 'done').map((p) => p.name)
    : [];
  const sunnahLabels = rec
    ? SUNNAH_LIST.filter((s) => rec.sunnah.includes(s.id)).map((s) => s.label)
    : [];

  container.innerHTML = `
    <div class="mt-12">
      <p><strong>Sholat Wajib (${donePrayers.length}/5):</strong> ${donePrayers.length ? donePrayers.join(', ') : 'Belum ada yang tercatat selesai'}</p>
      <p class="mt-12"><strong>Amalan Sunnah (${sunnahLabels.length}):</strong> ${sunnahLabels.length ? sunnahLabels.join(', ') : '-'}</p>
      ${journal && journal.gratitude ? `<p class="mt-12"><strong>Syukur:</strong> "${journal.gratitude}"</p>` : ''}
    </div>
  `;
}

// ================= STATISTIK & REKAP (DATA AKTUAL) =================
function renderStatisticsView() {
  const allDates = Object.keys(appState.tracker);
  let totalWajibDone = 0;
  let totalDaysTracked = 0;
  let perfectDays = 0;
  let totalSunnahDone = 0;

  const perPrayerCount = { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };

  allDates.forEach((d) => {
    const rec = appState.tracker[d];
    if (!rec) return;
    const dayWajib = PRAYERS.filter((p) => rec.wajib && rec.wajib[p.id] === 'done');
    if (dayWajib.length > 0 || (rec.sunnah && rec.sunnah.length > 0)) {
      totalDaysTracked++;
    }
    totalWajibDone += dayWajib.length;
    if (dayWajib.length === 5) perfectDays++;
    if (rec.sunnah) totalSunnahDone += rec.sunnah.length;

    dayWajib.forEach((p) => {
      perPrayerCount[p.id]++;
    });
  });

  const possibleWajib = totalDaysTracked > 0 ? totalDaysTracked * 5 : 0;
  const consistencyPct = possibleWajib > 0 ? Math.round((totalWajibDone / possibleWajib) * 100) : 0;

  document.getElementById('statTotalWajib').textContent = totalWajibDone;
  document.getElementById('statConsistency').textContent = `${consistencyPct}%`;
  document.getElementById('statPerfectDays').textContent = perfectDays;
  document.getElementById('statTotalSunnah').textContent = totalSunnahDone;

  // Grafik 7 Hari Terakhir
  const chart7 = document.getElementById('chart7Days');
  chart7.innerHTML = '';
  for (let i = 6; i >= 0; i--) {
    const dStr = shiftDateStr(currentDateStr, -i);
    const rec = appState.tracker[dStr];
    const count = rec ? PRAYERS.filter((p) => rec.wajib[p.id] === 'done').length : 0;
    const heightPct = Math.max(8, (count / 5) * 100);
    const [y, m, d] = dStr.split('-').map(Number);
    const shortDay = new Date(y, m - 1, d).toLocaleDateString('id-ID', { weekday: 'short' });

    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `
      <span class="bar-val">${count}/5</span>
      <div class="bar-fill" style="height: ${heightPct}%"></div>
      <span class="bar-day">${shortDay}</span>
    `;
    chart7.appendChild(col);
  }

  // Grafik 30 Hari Terakhir
  const chart30 = document.getElementById('chart30Days');
  chart30.innerHTML = '';
  for (let i = 29; i >= 0; i--) {
    const dStr = shiftDateStr(currentDateStr, -i);
    const rec = appState.tracker[dStr];
    const count = rec ? PRAYERS.filter((p) => rec.wajib[p.id] === 'done').length : 0;
    const cell = document.createElement('div');
    cell.className = `heat-cell ${count > 0 ? `lvl-${count}` : ''}`;
    cell.title = `${dStr}: ${count}/5 sholat`;
    chart30.appendChild(cell);
  }

  // Rekap Per Waktu Sholat
  const breakdownEl = document.getElementById('prayerTimeBreakdown');
  breakdownEl.innerHTML = '';
  const denom = Math.max(1, totalDaysTracked);

  PRAYERS.forEach((p) => {
    const cnt = perPrayerCount[p.id];
    const pct = totalDaysTracked > 0 ? Math.round((cnt / denom) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `
      <div class="breakdown-meta">
        <span>${p.icon} ${p.name}</span>
        <span>${cnt}x (${pct}%)</span>
      </div>
      <div class="breakdown-track">
        <div class="breakdown-fill" style="width: ${pct}%"></div>
      </div>
    `;
    breakdownEl.appendChild(row);
  });
}

// ================= JURNAL IBADAH =================
function renderJournalView() {
  const isToday = selectedJournalDate === currentDateStr;
  document.getElementById('journalDateLabel').textContent = isToday
    ? `Hari Ini (${selectedJournalDate})`
    : formatDateIndo(selectedJournalDate);

  const entry = appState.journals[selectedJournalDate] || {
    gratitude: '',
    dua: '',
    target: '',
    reflection: ''
  };

  document.getElementById('journalGratitude').value = entry.gratitude || '';
  document.getElementById('journalDua').value = entry.dua || '';
  document.getElementById('journalTarget').value = entry.target || '';
  document.getElementById('journalReflection').value = entry.reflection || '';
  document.getElementById('journalSavedStatus').textContent = entry.updatedAt
    ? `Tersimpan (${entry.updatedAt})`
    : 'Belum ada catatan';

  // Render Riwayat Jurnal
  const historyEl = document.getElementById('journalHistoryList');
  historyEl.innerHTML = '';
  const dates = Object.keys(appState.journals).sort().reverse();

  if (dates.length === 0) {
    historyEl.innerHTML = `<p class="small-muted">Belum ada riwayat jurnal tersimpan. Mulai tulis refleksi pertamamu di atas.</p>`;
    return;
  }

  dates.forEach((dStr) => {
    const j = appState.journals[dStr];
    const item = document.createElement('div');
    item.className = 'journal-history-item';
    item.innerHTML = `
      <h4>📅 ${formatDateIndo(dStr)}</h4>
      <p>${j.gratitude || j.reflection || j.dua || 'Catatan tersimpan'}</p>
    `;
    item.addEventListener('click', () => {
      selectedJournalDate = dStr;
      renderJournalView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    historyEl.appendChild(item);
  });
}

// ================= PENGATURAN & BACKUP =================
function renderSettingsView() {
  const s = appState.settings;
  document.getElementById('gpsCoordText').textContent = `Koordinat: ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)} (${s.city})`;
  document.getElementById('calcMethodSelect').value = s.method;
  document.getElementById('timeFormatSelect').value = s.timeFormat;
  document.getElementById('themeSelect').value = s.theme;
  document.getElementById('azanAudioSelect').value = s.azanAudio;
  document.getElementById('azanVolumeRange').value = s.volume;
  document.getElementById('volumePercentLabel').textContent = `${Math.round(s.volume * 100)}%`;

  if ('Notification' in window) {
    const mapPerm = { granted: 'Diizinkan ✓', denied: 'Diblokir Browser', default: 'Belum Diizinkan' };
    document.getElementById('notifPermissionStatus').textContent = `Status: ${mapPerm[Notification.permission]}`;
  }

  const toggleContainer = document.getElementById('perPrayerReminderList');
  toggleContainer.innerHTML = '';
  PRAYERS.forEach((p) => {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    row.innerHTML = `
      <span>${p.icon} Pengingat ${p.name}</span>
      <input type="checkbox" ${s.reminders[p.id] ? 'checked' : ''} data-prayer="${p.id}" />
    `;
    row.querySelector('input').addEventListener('change', (e) => {
      appState.settings.reminders[p.id] = e.target.checked;
      saveState();
      showToast(`Pengingat ${p.name} ${e.target.checked ? 'diaktifkan' : 'dinonaktifkan'}.`);
    });
    toggleContainer.appendChild(row);
  });
}

async function detectUserGPS() {
  if (!navigator.geolocation) {
    showToast('Browser tidak mendukung GPS.');
    return;
  }
  showToast('Mendeteksi lokasi GPS...');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      appState.settings.lat = pos.coords.latitude;
      appState.settings.lng = pos.coords.longitude;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
        const data = await res.json();
        const city = data.address.city || data.address.town || data.address.county || 'Lokasi GPS';
        const country = data.address.country || '';
        appState.settings.city = `${city}${country ? ', ' + country : ''}`;
      } catch {
        appState.settings.city = `GPS (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`;
      }
      saveState();
      renderSettingsView();
      fetchPrayerTimes(currentDateStr, true);
      showToast(`Lokasi diperbarui: ${appState.settings.city}`);
    },
    () => {
      showToast('Izin lokasi ditolak. Gunakan pencarian kota manual.');
    }
  );
}

async function searchManualCity(cityQuery) {
  if (!cityQuery.trim()) return;
  showToast('Mencari koordinat kota...');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityQuery)}&limit=1`);
    const list = await res.json();
    if (!list || list.length === 0) {
      showToast('Kota tidak ditemukan. Coba nama kota lain.');
      return;
    }
    appState.settings.lat = parseFloat(list[0].lat);
    appState.settings.lng = parseFloat(list[0].lon);
    appState.settings.city = list[0].display_name.split(',').slice(0, 2).join(',');
    saveState();
    renderSettingsView();
    fetchPrayerTimes(currentDateStr, true);
    showToast(`Jadwal diatur untuk ${appState.settings.city}`);
  } catch {
    showToast('Gagal mencari kota (periksa koneksi internet).');
  }
}

// ================= NAVIGASI & EVENT LISTENERS =================
function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach((sec) => sec.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  document.querySelectorAll('.bottom-nav-item, .nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === viewId);
  });

  if (viewId === 'view-tracker') renderTrackerView();
  if (viewId === 'view-doa') renderDoaList();
  if (viewId === 'view-kalender') renderCalendarView();
  if (viewId === 'view-statistik') renderStatisticsView();
  if (viewId === 'view-jurnal') renderJournalView();
  if (viewId === 'view-pengaturan') renderSettingsView();
}

function initApp() {
  // Terapkan tema tersimpan
  document.body.setAttribute('data-theme', appState.settings.theme);

  // Navigasi Mobile & Desktop
  document.querySelectorAll('.bottom-nav-item, .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.target));
  });

  document.getElementById('btnOpenSettings').addEventListener('click', () => switchView('view-pengaturan'));
  document.getElementById('btnQuickLocation').addEventListener('click', () => switchView('view-pengaturan'));

  // Audio Unlock
  document.getElementById('btnUnlockAudio').addEventListener('click', unlockAudioContext);

  // Tracker Date Navigation
  document.getElementById('btnPrevTrackerDate').addEventListener('click', () => {
    selectedTrackerDate = shiftDateStr(selectedTrackerDate, -1);
    renderTrackerView();
  });
  document.getElementById('btnNextTrackerDate').addEventListener('click', () => {
    selectedTrackerDate = shiftDateStr(selectedTrackerDate, 1);
    renderTrackerView();
  });

  // Calendar Navigation
  document.getElementById('btnPrevMonth').addEventListener('click', () => {
    calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    renderCalendarView();
  });
  document.getElementById('btnNextMonth').addEventListener('click', () => {
    calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    renderCalendarView();
  });

  // Journal Navigation & Submit
  document.getElementById('btnPrevJournalDate').addEventListener('click', () => {
    selectedJournalDate = shiftDateStr(selectedJournalDate, -1);
    renderJournalView();
  });
  document.getElementById('btnNextJournalDate').addEventListener('click', () => {
    selectedJournalDate = shiftDateStr(selectedJournalDate, 1);
    renderJournalView();
  });

  document.getElementById('journalForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nowTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    appState.journals[selectedJournalDate] = {
      gratitude: document.getElementById('journalGratitude').value.trim(),
      dua: document.getElementById('journalDua').value.trim(),
      target: document.getElementById('journalTarget').value.trim(),
      reflection: document.getElementById('journalReflection').value.trim(),
      updatedAt: nowTime
    };
    saveState();
    renderJournalView();
    showToast('Alhamdulillah, catatan jurnal berhasil disimpan!');
  });

  // Settings Events
  document.getElementById('btnDetectGPS').addEventListener('click', detectUserGPS);
  document.getElementById('btnSearchCity').addEventListener('click', () => {
    searchManualCity(document.getElementById('manualCityInput').value);
  });

  document.getElementById('calcMethodSelect').addEventListener('change', (e) => {
    appState.settings.method = e.target.value;
    saveState();
    fetchPrayerTimes(currentDateStr, true);
    showToast('Metode perhitungan jadwal diperbarui.');
  });

  document.getElementById('timeFormatSelect').addEventListener('change', (e) => {
    appState.settings.timeFormat = e.target.value;
    saveState();
    const sched = getTodayScheduleData();
    if (sched) renderDashboardSchedule(sched);
    showToast('Format waktu diperbarui.');
  });

  document.getElementById('themeSelect').addEventListener('change', (e) => {
    appState.settings.theme = e.target.value;
    document.body.setAttribute('data-theme', e.target.value);
    saveState();
    showToast('Tema tampilan diterapkan.');
  });

  document.getElementById('azanAudioSelect').addEventListener('change', (e) => {
    appState.settings.azanAudio = e.target.value;
    saveState();
    showToast('Pilihan suara azan disimpan.');
  });

  document.getElementById('azanVolumeRange').addEventListener('input', (e) => {
    appState.settings.volume = parseFloat(e.target.value);
    document.getElementById('volumePercentLabel').textContent = `${Math.round(appState.settings.volume * 100)}%`;
    azanAudioPlayer.volume = appState.settings.volume;
    saveState();
  });

  document.getElementById('btnTestAzan').addEventListener('click', () => {
    unlockAudioContext();
    playAzanAudio();
  });

  document.getElementById('btnStopAzan').addEventListener('click', stopAzanAudio);

  document.getElementById('btnRequestNotif').addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Browser tidak mendukung notifikasi.');
      return;
    }
    const perm = await Notification.requestPermission();
    renderSettingsView();
    showToast(perm === 'granted' ? 'Notifikasi diizinkan!' : 'Izin notifikasi ditolak.');
  });

  // Azan Modal Controls
  document.getElementById('btnAzanDismiss').addEventListener('click', () => {
    stopAzanAudio();
    document.getElementById('azanModal').classList.add('hidden');
  });

  document.getElementById('btnAzanDone').addEventListener('click', () => {
    stopAzanAudio();
    if (activeRingingPrayer) {
      const rec = ensureDayRecord(currentDateStr);
      rec.wajib[activeRingingPrayer.id] = 'done';
      saveState();
      const sched = getTodayScheduleData();
      if (sched) renderDashboardSchedule(sched);
      renderTrackerView();
      showToast(`Alhamdulillah, ${activeRingingPrayer.name} dicatat selesai.`);
    }
    document.getElementById('azanModal').classList.add('hidden');
  });

  // Export & Import JSON
  document.getElementById('btnExportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-sholat-diary-backup-${currentDateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('File backup JSON berhasil diunduh.');
  });

  document.getElementById('importDataInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.settings || !imported.tracker) throw new Error('Format tidak valid');
        appState = imported;
        saveState();
        location.reload();
      } catch {
        showToast('File JSON tidak valid atau rusak.');
      }
    };
    reader.readAsText(file);
  });

  // Reset All Data
  document.getElementById('btnResetAllData').addEventListener('click', () => {
    const confirmed = confirm('Apakah kamu yakin ingin menghapus seluruh riwayat sholat, jurnal, dan pengaturan? Tindakan ini tidak dapat dibatalkan.');
    if (confirmed) {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  });

  // Online / Offline Status Listener
  window.addEventListener('online', () => {
    document.getElementById('offlineBanner').classList.add('hidden');
    fetchPrayerTimes(currentDateStr, true);
  });
  window.addEventListener('offline', () => {
    document.getElementById('offlineBanner').classList.remove('hidden');
  });

  // Registrasi Service Worker PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service Worker gagal didaftarkan:', err);
    });
  }

  // Mulai muat data awal
  ensureDayRecord(currentDateStr);
  fetchPrayerTimes(currentDateStr);
  setInterval(updateCountdownAndCheckAlarm, 1000);
}
// === FITUR TAB DOA & DZIKIR HARIAN ===
// === FITUR TAB DOA & DZIKIR HARIAN ===
const DOA_COLLECTION = [
  {
    id: 'doa-dhuha',
    kategori: 'dhuha',
    labelKategori: 'Doa Dhuha',
    judul: 'Doa Setelah Sholat Dhuha',
    arab: 'اَللّٰهُمَّ إِنَّ الضُّحَاءَ ضُحَاؤُكَ',
    latin: 'Allahumma innadh-dhuha-a dhuha-uka...',
    arti: 'Ya Allah, sesungguhnya waktu Dhuha adalah waktu Dhuha-Mu...',
    target: 1
  }
];

let currentDoaFilter = 'semua';

function getTodayDoaCounts() {
  if (!appState.doaCounts) appState.doaCounts = {};
  if (!appState.doaCounts[currentDateStr]) appState.doaCounts[currentDateStr] = {};
  return appState.doaCounts[currentDateStr];
}

function renderDoaList() {
  const container = document.getElementById('doaListContainer');
  if (!container) return;

  const counts = getTodayDoaCounts();
  const filtered = currentDoaFilter === 'semua'
    ? DOA_COLLECTION
    : DOA_COLLECTION.filter(d => d.kategori === currentDoaFilter);

  container.innerHTML = filtered.map(item => {
    const count = counts[item.id] || 0;
    const isDone = count >= item.target;

    return `
      <div class="doa-card">
        <div class="doa-card-top">
          <span class="doa-title">${item.judul}</span>
          <span class="doa-badge">${item.labelKategori}</span>
        </div>
        <div class="doa-arab">${item.arab}</div>
        <div class="doa-latin">${item.latin}</div>
        <div class="doa-arti"><strong>Artinya:</strong> ${item.arti}</div>
        <div class="doa-counter-bar">
          <span class="doa-target">Dibaca hari ini: <strong>${count}</strong> / ${item.target}x ${isDone ? '✅' : ''}</span>
          <div class="doa-counter-actions">
            <button type="button" class="btn-reset-doa" data-reset-id="${item.id}">Reset</button>
            <button type="button" class="btn-count-doa" data-count-id="${item.id}">+1 Baca</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function initDoaFeature() {
  const filterButtons = document.querySelectorAll('.filter-chip');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDoaFilter = btn.dataset.category;
      renderDoaList();
    });
  });

  const container = document.getElementById('doaListContainer');
  if (container) {
    container.addEventListener('click', (e) => {
      const countBtn = e.target.closest('[data-count-id]');
      const resetBtn = e.target.closest('[data-reset-id]');

      if (countBtn) {
        const id = countBtn.dataset.countId;
        const counts = getTodayDoaCounts();
        counts[id] = (counts[id] || 0) + 1;
        saveState();
        renderDoaList();

        const doaItem = DOA_COLLECTION.find(d => d.id === id);
        if (doaItem && counts[id] === doaItem.target) {
          showToast(`Alhamdulillah, target ${doaItem.judul} tercapai!`);
        }
      }

      if (resetBtn) {
        const id = resetBtn.dataset.resetId;
        const counts = getTodayDoaCounts();
        counts[id] = 0;
        saveState();
        renderDoaList();
        showToast('Hitungan bacaan di-reset.');
      }
    });
  }

  renderDoaList();
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initDoaFeature();
});