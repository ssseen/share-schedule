// 상태값
let selectedColor = null;
let selectedEventId = null;
let events = [];
let currentWeekStart = new Date();
let rightClickedEventId = null;

// DOM
const dateInput = document.getElementById("date");
const startTimeInput = document.getElementById("start_time");
const endTimeInput = document.getElementById("end_time");
const titleInput = document.getElementById("title");
const locationInput = document.getElementById("location");

const saveBtn = document.getElementById("save-btn");
const travelTimeBtn = document.getElementById("traveltime-btn");

const colorCircles = document.querySelectorAll(".color-circle");
const gridArea = document.getElementById("grid-area");
const monthNum = document.getElementById("month-num");
const weekNum = document.getElementById("week-num");

const contextMenu = document.getElementById("context-menu");
const contextDeleteBtn = document.getElementById("context-delete-btn");

// 렌더링 기준값
const HOUR_HEIGHT = 37;
const DAY_WIDTH = 110;
const DAY_MINUTES = 24 * 60;

// 유틸
function isValid30(timeStr) {
  if (!timeStr) return false;
  const parts = timeStr.split(":");
  if (parts.length < 2) return false;
  const minute = Number(parts[1]);
  return minute === 0 || minute === 30;
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function combineDateTime(date, time) {
  return `${date}T${time}:00`;
}

function addDaysToDateString(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function getDateTimeRange(date, start, end) {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);

  const startDateTime = combineDateTime(date, start);

  // 종료시간이 시작시간보다 빠르거나 같으면 다음날로 처리
  const endDate = endMinutes <= startMinutes
    ? addDaysToDateString(date, 1)
    : date;

  const endDateTime = combineDateTime(endDate, end);

  return {
    startDateTime,
    endDateTime
  };
}

function getFormData() {
  return {
    date: dateInput.value,
    start: startTimeInput.value,
    end: endTimeInput.value,
    title: titleInput.value.trim(),
    location: locationInput.value.trim(),
    color: selectedColor
  };
}

function validateForm({ date, start, end, title, location, color }) {
  if (!date || !start || !end || !title || !location || !color) {
    alert("모든 항목을 입력하세요.");
    return false;
  }

  if (!isValid30(start) || !isValid30(end)) {
    alert("시간은 30분 단위로만 입력 가능합니다.");
    return false;
  }

  if (start === end) {
    alert("시작 시간과 종료 시간이 같을 수 없습니다.");
    return false;
  }

  return true;
}

function resetForm() {
  dateInput.value = "";
  startTimeInput.value = "";
  endTimeInput.value = "";
  titleInput.value = "";
  locationInput.value = "";

  selectedColor = null;
  selectedEventId = null;

  colorCircles.forEach(circle => {
    circle.classList.remove("selected");
  });

  saveBtn.textContent = "save";
  updateTravelTimeButton();
}

function updateTravelTimeButton() {
  const hasSelectedEvent = selectedEventId !== null;
  travelTimeBtn.disabled = !hasSelectedEvent;
}

function getMinutesFromMidnight(dateObj) {
  return dateObj.getHours() * 60 + dateObj.getMinutes();
}

function startOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(24, 0, 0, 0);
  return d;
}

function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// 색 선택
function setupColorPicker() {
  colorCircles.forEach(circle => {
    circle.addEventListener("click", () => {
      colorCircles.forEach(c => c.classList.remove("selected"));
      circle.classList.add("selected");
      selectedColor = circle.dataset.color;
    });
  });
}

function getTextColor(bgColor) {
  const map = {
    "#F28B82": "#5A2A2A",
    "#81E6C3": "#1F4D3A",
    "#9B8AFB": "#2E2A5A",
    "#F6A6D8": "#5A2A4A",
    "#F4F28B": "#5A5A1F"
  };
  return map[bgColor] || "#333";
}

// 주차 표시
function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 일=0
  const diff = day === 0 ? -6 : 1 - day; // 월요일 시작
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function updateWeekDisplay() {
  currentWeekStart = getStartOfWeek(currentWeekStart);

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const startMonth = currentWeekStart.getMonth() + 1;
  const startDate = currentWeekStart.getDate();

  const endMonth = weekEnd.getMonth() + 1;
  const endDate = weekEnd.getDate();

  monthNum.textContent = `${startMonth}.${startDate}`;
  weekNum.textContent = `~ ${endMonth}.${endDate}`;
}

function prevWeek() {
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  updateWeekDisplay();
  renderEvents();
}

function nextWeek() {
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  updateWeekDisplay();
  renderEvents();
}

// 일정 조회
async function loadEvents() {
  try {
    events = await getEvents();
    console.log("불러온 일정:", events);
    renderEvents();
  } catch (error) {
    console.error(error);
    alert("일정 조회 실패");
  }
}

// 우클릭 메뉴
function showContextMenu(x, y, eventId) {
  if (!contextMenu) return;

  rightClickedEventId = eventId;
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove("hidden");
}

function hideContextMenu() {
  if (!contextMenu) return;

  contextMenu.classList.add("hidden");
  rightClickedEventId = null;
}

// 일정 렌더링
function clearRenderedEvents() {
  const oldBlocks = gridArea.querySelectorAll(".event-block");
  oldBlocks.forEach(block => block.remove());
}

function createEventBlock(event, dayIndex, top, height) {
  const block = document.createElement("div");
  block.className = "event-block";
  block.style.position = "absolute";
  block.style.left = `${dayIndex * DAY_WIDTH}px`;
  block.style.top = `${top}px`;
  block.style.width = `${DAY_WIDTH}px`;
  block.style.height = `${height}px`;
  block.style.backgroundColor = event.color || "#ddd";
  block.style.color = getTextColor(event.color || "#ddd");
  block.style.boxSizing = "border-box";
  block.style.border = "1px solid rgba(0,0,0,0.1)";
  block.style.overflow = "hidden";
  block.style.cursor = "pointer";
  block.textContent = event.title;

  block.addEventListener("click", (e) => {
    e.stopPropagation();
    hideContextMenu();
    fillFormForEdit(event);
  });

  block.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.pageX, e.pageY, event.id);
  });

  gridArea.appendChild(block);
}

function renderSingleEvent(event, weekStart, weekEnd) {
  const eventStart = new Date(event.start_time);
  const eventEnd = new Date(event.end_time);

  // 주간 범위와 겹치지 않으면 스킵
  if (eventEnd <= weekStart || eventStart >= weekEnd) return;

  // 주간 범위 내로 잘라서 계산
  const visibleStart = new Date(Math.max(eventStart.getTime(), weekStart.getTime()));
  const visibleEnd = new Date(Math.min(eventEnd.getTime(), weekEnd.getTime()));

  let currentDay = startOfDay(visibleStart);

  while (currentDay < visibleEnd) {
    const dayStart = new Date(currentDay);
    const dayEnd = endOfDay(currentDay);

    const segmentStart = new Date(Math.max(eventStart.getTime(), dayStart.getTime()));
    const segmentEnd = new Date(Math.min(eventEnd.getTime(), dayEnd.getTime()));

    if (segmentEnd > segmentStart) {
      const dayIndex = Math.floor((dayStart - weekStart) / (1000 * 60 * 60 * 24));

      if (dayIndex >= 0 && dayIndex < 7) {
        const startMinutes = getMinutesFromMidnight(segmentStart);
        const endMinutes =
          isSameDate(segmentStart, segmentEnd)
            ? getMinutesFromMidnight(segmentEnd)
            : DAY_MINUTES;

        const top = startMinutes * (HOUR_HEIGHT / 60);
        const height = (endMinutes - startMinutes) * (HOUR_HEIGHT / 60);

        createEventBlock(event, dayIndex, top, height);
      }
    }

    currentDay.setDate(currentDay.getDate() + 1);
  }
}

function renderEvents() {
  clearRenderedEvents();

  const weekStart = getStartOfWeek(currentWeekStart);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  events.forEach(event => {
    renderSingleEvent(event, weekStart, weekEnd);
  });
}

// 저장 / 수정
async function handleSave() {
  const formData = getFormData();

  if (!validateForm(formData)) return;

  const { startDateTime, endDateTime } = getDateTimeRange(
    formData.date,
    formData.start,
    formData.end
  );

  const payload = {
    title: formData.title,
    start_time: startDateTime,
    end_time: endDateTime,
    location: formData.location,
    color: formData.color
  };

  try {
    if (selectedEventId) {
      await updateEvent(selectedEventId, payload);
      alert("일정이 수정되었습니다.");
    } else {
      await createEvent(payload);
      alert("일정이 저장되었습니다.");
    }

    resetForm();
    await loadEvents();
  } catch (error) {
    console.error(error);
    alert("일정 저장/수정 실패");
  }
}

// 수정용 폼 채우기
function fillFormForEdit(eventData) {
  selectedEventId = eventData.id;

  titleInput.value = eventData.title || "";
  locationInput.value = eventData.location || "";
  selectedColor = eventData.color || null;

  const start = new Date(eventData.start_time);
  const end = new Date(eventData.end_time);

  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  dateInput.value = `${yyyy}-${mm}-${dd}`;

  const startHH = String(start.getHours()).padStart(2, "0");
  const startMM = String(start.getMinutes()).padStart(2, "0");
  const endHH = String(end.getHours()).padStart(2, "0");
  const endMM = String(end.getMinutes()).padStart(2, "0");

  startTimeInput.value = `${startHH}:${startMM}`;
  endTimeInput.value = `${endHH}:${endMM}`;

  colorCircles.forEach(circle => {
    circle.classList.toggle("selected", circle.dataset.color === selectedColor);
  });

  saveBtn.textContent = "update";
  updateTravelTimeButton();
}

// 삭제
async function handleDelete(eventId) {
  const ok = confirm("이 일정을 삭제할까요?");
  if (!ok) return;

  try {
    await deleteEvent(eventId);
    alert("일정이 삭제되었습니다.");

    if (selectedEventId === eventId) {
      resetForm();
    }

    await loadEvents();
  } catch (error) {
    console.error(error);
    alert("일정 삭제 실패");
  }
}

// 이벤트 연결
function bindEvents() {
  saveBtn.addEventListener("click", handleSave);

  travelTimeBtn.addEventListener("click", () => {
    if (travelTimeBtn.disabled) return;

    if (selectedEventId === null) {
      alert("먼저 일정을 선택하세요.");
      return;
    }

    window.location.href = `traveltime.html?next_event_id=${selectedEventId}`;
  });

  if (contextDeleteBtn) {
    contextDeleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      if (rightClickedEventId === null) return;

      await handleDelete(rightClickedEventId);
      hideContextMenu();
    });
  }

  document.addEventListener("click", () => {
    hideContextMenu();
  });

  document.addEventListener("scroll", () => {
    hideContextMenu();
  });
}

// 초기화
function init() {
  startTimeInput.step = 1800;
  endTimeInput.step = 1800;

  currentWeekStart = getStartOfWeek(new Date());

  setupColorPicker();
  bindEvents();
  updateTravelTimeButton();
  updateWeekDisplay();
  loadEvents();
}

document.addEventListener("DOMContentLoaded", init);