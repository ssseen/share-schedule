// DOM
const leaderArea = document.getElementById("leader-area");
const memberArea = document.getElementById("member-area");

const placeInput = document.getElementById("place-input");
const meetingTimeInput = document.getElementById("meeting-time");
const startBtn = document.getElementById("start-btn");

const candidateList = document.getElementById("candidate-list");
const voteCountBox = document.getElementById("vote-count-box");
const saveBtn = document.getElementById("save-btn");

const gridArea = document.getElementById("grid-area");
const monthNum = document.getElementById("month-num");
const weekNum = document.getElementById("week-num");

// 상태값
const params = new URLSearchParams(window.location.search);
const groupId = params.get("groupId");
const role = params.get("role");

let currentCandidates = [];
let selectedSlotIds = new Set();
let currentWeekStart = null;

const KST_OFFSET_MINUTES = 9 * 60;

// 패널 전환
function showPanel(panelId) {
  document.querySelectorAll(".panel").forEach(panel => {
    panel.classList.add("hidden");
  });

  const target = document.getElementById(panelId);
  if (target) {
    target.classList.remove("hidden");
  }
}

// vote count 표시
function updateVoteCount(voted, total) {
  if (!voteCountBox) return;

  voteCountBox.innerHTML = `
    <span class="voted-num">${voted}</span>
    <span class="slash"> / </span>
    <span class="total-num">${total}</span>
  `;
}

// 날짜 유틸
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDateToYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysToYMD(dateStr, days) {
  const date = parseLocalDate(dateStr);
  if (!date) return dateStr;
  date.setDate(date.getDate() + days);
  return formatDateToYMD(date);
}

function getMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);

  return d;
}

function getWeekDates(mondayDate) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function getWeekNumberInMonth(date) {
  const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstMonday = getMonday(firstDayOfMonth);
  const diffDays = Math.floor((getMonday(date) - firstMonday) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

function formatDateLabel(dateStr) {
  const date = parseLocalDate(dateStr);
  if (!date) return "날짜 없음";

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

function formatTime(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function shiftUtcDateAndTimeToKst(dateStr, hour, minute) {
  let totalMinutes = hour * 60 + minute + KST_OFFSET_MINUTES;
  let dayDelta = Math.floor(totalMinutes / 1440);

  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;

  const localHour = Math.floor(totalMinutes / 60);
  const localMinute = totalMinutes % 60;
  const localDate = addDaysToYMD(dateStr, dayDelta);

  return {
    date: localDate,
    hour: localHour,
    minute: localMinute
  };
}

function parseApiDateTimeString(dateTimeString) {
  if (!dateTimeString) return null;

  const normalized = dateTimeString.replace("T", " ").replace("Z", "");
  const [datePart, timePartRaw] = normalized.split(" ");
  if (!datePart || !timePartRaw) return null;

  const timePart = timePartRaw.slice(0, 5);
  const [hourStr, minuteStr] = timePart.split(":");

  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  return {
    date: datePart,
    hour,
    minute
  };
}

function parseApiTimeString(timeString) {
  if (!timeString) return null;

  const normalized = timeString.replace("Z", "").slice(0, 5);
  const [hourStr, minuteStr] = normalized.split(":");

  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  return {
    hour,
    minute
  };
}

function convertCandidateToLocal(candidate) {
  if (!candidate?.start || !candidate?.end) return null;

  const startUtc = parseApiDateTimeString(candidate.start);
  const endUtc = parseApiTimeString(candidate.end);

  if (!startUtc || !endUtc) return null;

  const startTotal = startUtc.hour * 60 + startUtc.minute;
  const endTotal = endUtc.hour * 60 + endUtc.minute;

  const endDayExtra = endTotal <= startTotal ? 1 : 0;

  const localStart = shiftUtcDateAndTimeToKst(
    startUtc.date,
    startUtc.hour,
    startUtc.minute
  );

  const localEndBaseDate = addDaysToYMD(startUtc.date, endDayExtra);
  const localEnd = shiftUtcDateAndTimeToKst(
    localEndBaseDate,
    endUtc.hour,
    endUtc.minute
  );

  return {
    start: localStart,
    end: localEnd
  };
}

function normalizeWeeklyData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.weekly_availability)) return data.weekly_availability;
  return [];
}

function convertWeeklyAvailabilityToLocal(data) {
  const raw = normalizeWeeklyData(data);
  const mapped = new Map();

  raw.forEach(dayInfo => {
    const utcDate = dayInfo.date;
    const slots = dayInfo.slots || [];

    slots.forEach((busyCount, slotIndex) => {
      if (!busyCount) return;

      const utcHour = Math.floor(slotIndex / 2);
      const utcMinute = slotIndex % 2 === 0 ? 0 : 30;

      const local = shiftUtcDateAndTimeToKst(utcDate, utcHour, utcMinute);
      const localSlotIndex = local.hour * 2 + (local.minute === 30 ? 1 : 0);

      if (!mapped.has(local.date)) {
        mapped.set(local.date, Array(48).fill(0));
      }

      mapped.get(local.date)[localSlotIndex] = busyCount;
    });
  });

  return Array.from(mapped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, slots]) => ({ date, slots }));
}

function updateCornerBox(weekStartDate) {
  if (!monthNum || !weekNum || !weekStartDate) return;

  const month = weekStartDate.getMonth() + 1;
  const week = getWeekNumberInMonth(weekStartDate);

  monthNum.textContent = `${month} month`;
  weekNum.textContent = `${week} week`;
}

function setupGridForWeek(weekStartDate) {
  if (!gridArea) return;

  const cells = gridArea.querySelectorAll(".grid-cell");
  const weekDates = getWeekDates(weekStartDate);

  cells.forEach((cell, index) => {
    const hour = Math.floor(index / 7); // 0~23
    const dayIndex = index % 7;         // 0~6 = 월~일
    const dateStr = formatDateToYMD(weekDates[dayIndex]);

    cell.classList.add("time-slot");
    cell.dataset.date = dateStr;
    cell.dataset.hour = String(hour);

    cell.style.backgroundColor = "";
    cell.classList.remove("highlight-candidate");
  });

  updateCornerBox(weekStartDate);
}

function getHeatmapColorByBusyCount(busyCount) {
  if (busyCount === 0) return "";
  if (busyCount === 1) return "#96C0C8";
  if (busyCount === 2) return "#ADD3DA";
  if (busyCount === 3) return "rgba(193, 232, 239, 0.8)";
  return "rgba(99, 149, 159, 0.8)";
}

function clearHeatmap() {
  document.querySelectorAll(".time-slot").forEach(cell => {
    cell.style.backgroundColor = "";
  });
}

function renderWeeklyAvailability(data) {
  clearHeatmap();

  const weeklyData = convertWeeklyAvailabilityToLocal(data);
  if (!weeklyData.length) return;

  const firstDateObj = parseLocalDate(weeklyData[0].date);
  if (firstDateObj) {
    currentWeekStart = getMonday(firstDateObj);
    setupGridForWeek(currentWeekStart);
  }

  weeklyData.forEach(dayInfo => {
    const date = dayInfo.date;
    const slots = dayInfo.slots || [];

    for (let hour = 0; hour < 24; hour++) {
      const slotA = slots[hour * 2] ?? 0;
      const slotB = slots[hour * 2 + 1] ?? 0;
      const busyCount = Math.max(slotA, slotB);

      const cell = document.querySelector(
        `.time-slot[data-date="${date}"][data-hour="${hour}"]`
      );

      if (!cell) continue;

      const color = getHeatmapColorByBusyCount(busyCount);
      cell.style.backgroundColor = color;
    }
  });
}

function clearCandidateHighlight() {
  document.querySelectorAll(".time-slot.highlight-candidate").forEach(cell => {
    cell.classList.remove("highlight-candidate");
  });
}

function highlightCandidateSlots(candidate) {
  clearCandidateHighlight();

  const localCandidate = convertCandidateToLocal(candidate);
  if (!localCandidate) return;

  const start = localCandidate.start;
  const end = localCandidate.end;

  let currentDate = start.date;
  let currentSlot = start.hour * 2 + (start.minute === 30 ? 1 : 0);
  const endSlot = end.hour * 2 + (end.minute === 30 ? 1 : 0);

  while (true) {
    const hour = Math.floor(currentSlot / 2);
    const cell = document.querySelector(
      `.time-slot[data-date="${currentDate}"][data-hour="${hour}"]`
    );

    if (cell) {
      cell.classList.add("highlight-candidate");
    }

    currentSlot += 1;

    if (currentDate === end.date && currentSlot >= endSlot) {
      break;
    }

    if (currentSlot >= 48) {
      currentSlot = 0;
      currentDate = addDaysToYMD(currentDate, 1);
    }
  }
}

function renderCandidates(candidates) {
  if (!candidateList) return;

  candidateList.innerHTML = "";
  currentCandidates = candidates || [];
  selectedSlotIds.clear();

  if (!Array.isArray(candidates) || candidates.length === 0) {
    candidateList.innerHTML = `<div class="empty-message">추천된 시간이 없습니다.</div>`;
    return;
  }

  candidates.forEach(candidate => {
    const item = document.createElement("div");
    item.className = "candidate-item";
    item.dataset.id = candidate.id;

    const localCandidate = convertCandidateToLocal(candidate);

    let dateText = "날짜 없음";
    let timeText = "시간 정보 없음";

    if (localCandidate) {
      dateText = formatDateLabel(localCandidate.start.date);
      timeText = `${formatTime(localCandidate.start.hour, localCandidate.start.minute)} - ${formatTime(localCandidate.end.hour, localCandidate.end.minute)}`;
    }

    item.innerHTML = `
      <div class="candidate-date">${dateText}</div>
      <div class="candidate-time">${timeText}</div>
    `;

    if (candidate.my_voted) {
      selectedSlotIds.add(candidate.id);
      item.classList.add("selected");
    }

    item.addEventListener("mouseenter", () => {
      highlightCandidateSlots(candidate);
    });

    item.addEventListener("mouseleave", () => {
      clearCandidateHighlight();
    });

    item.addEventListener("click", () => {
      const id = candidate.id;

      if (selectedSlotIds.has(id)) {
        selectedSlotIds.delete(id);
        item.classList.remove("selected");
      } else {
        selectedSlotIds.add(id);
        item.classList.add("selected");
      }
    });

    candidateList.appendChild(item);
  });
}

async function loadWeeklyAvailability() {
  try {
    const data = await getWeeklyAvailability(groupId);
    console.log("weekly_availability(raw):", data);
    console.log("weekly_availability(local):", convertWeeklyAvailabilityToLocal(data));
    renderWeeklyAvailability(data);
  } catch (error) {
    console.error("주간 빈 시간 조회 실패:", error);
  }
}

async function loadCandidates() {
  try {
    const data = await getCandidates(groupId);
    console.log("candidates:", data);

    const candidates = data.candidates || [];
    renderCandidates(candidates);
  } catch (error) {
    console.error("후보 리스트 조회 실패:", error);
    if (candidateList) {
      candidateList.innerHTML = `<div class="empty-message">후보 리스트를 불러오지 못했습니다.</div>`;
    }
  }
}

async function handleStartButton() {
  const location = placeInput?.value.trim();
  const durationMinutes = parseInt(meetingTimeInput?.value, 10);

  if (!location) {
    alert("장소를 입력해주세요.");
    return;
  }

  if (isNaN(durationMinutes) || durationMinutes <= 0) {
    alert("소요 시간을 분 단위 숫자로 입력해주세요.");
    return;
  }

  try {
    startBtn.disabled = true;

    const result = await proposeMeeting(groupId, location, durationMinutes);
    console.log("propose result:", result);

    const candidates = result.candidates || [];
    showPanel("member-area");
    renderCandidates(candidates);
  } catch (error) {
    console.error("약속 제안 실패:", error);
    alert(error.message || "약속 제안에 실패했습니다.");
  } finally {
    startBtn.disabled = false;
  }
}

async function handleSaveButton() {
  const slotIds = Array.from(selectedSlotIds);

  if (slotIds.length === 0) {
    alert("투표할 시간 후보를 선택해주세요.");
    return;
  }

  try {
    saveBtn.disabled = true;

    const result = await voteSlots(groupId, slotIds);
    console.log("vote result:", result);

    if (result.status === "voted") {
      updateVoteCount(result.current_voter_count, result.total_member_count);
      alert(result.message || "투표가 저장되었습니다.");
      await loadCandidates();
    } else if (result.status === "confirmed") {
      if (
        result.current_voter_count != null &&
        result.total_member_count != null
      ) {
        updateVoteCount(result.current_voter_count, result.total_member_count);
      }
      alert(result.message || "일정이 자동 확정되었습니다.");
      await loadCandidates();
    } else if (result.status === "failed") {
      alert(result.message || "공통 가능한 시간이 없습니다. 다시 제안해주세요.");
      await loadCandidates();
    } else {
      alert(result.message || "처리가 완료되었습니다.");
      await loadCandidates();
    }
  } catch (error) {
    console.error("투표 실패:", error);
    alert(error.message || "투표에 실패했습니다.");
  } finally {
    saveBtn.disabled = false;
  }
}

async function initGroupPage() {
  if (!groupId) {
    alert("groupId가 없습니다.");
    return;
  }

  if (!role) {
    alert("role 정보가 없습니다.");
    return;
  }

  currentWeekStart = getMonday(new Date());
  setupGridForWeek(currentWeekStart);

  await loadWeeklyAvailability();

  if (role === "leader") {
    showPanel("leader-area");
  } else {
    showPanel("member-area");
    await loadCandidates();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initGroupPage();

  if (startBtn) {
    startBtn.addEventListener("click", handleStartButton);
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", handleSaveButton);
  }
});