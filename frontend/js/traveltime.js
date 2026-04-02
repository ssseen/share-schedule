// js/traveltime.js

const startPointInput = document.getElementById("start-point");
const addTravelTimeBtn = document.getElementById("add-traveltime-btn");
const timeReportBox = document.querySelector(".time-report-box");

// 미리보기 때 사용한 값 저장
let previewParams = null;

// 페이지 처음 로드 시
window.addEventListener("DOMContentLoaded", () => {
  addTravelTimeBtn.disabled = true;
  resetPreviewText();
});

// 기본 안내 문구로 되돌리기
function resetPreviewText() {
  timeReportBox.innerHTML = `
    <div>It will take about</div>
    <div class="time-number">
      <span id="travel-time"></span>
      <span>minutes...</span>
    </div>
  `;
}

// next_event_id 가져오기
function getNextEventId() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("next_event_id");
  if (queryId) return Number(queryId);

  const savedId = localStorage.getItem("next_event_id");
  if (savedId) return Number(savedId);

  return null;
}

// 미리보기 버튼 클릭용
async function search() {
  const startPlace = startPointInput.value.trim();
  const nextEventId = getNextEventId();

  if (!startPlace) {
    alert("출발지를 입력해주세요.");
    startPointInput.focus();
    return;
  }

  if (!nextEventId) {
    alert("다음 일정 정보가 없어서 이동시간을 계산할 수 없습니다.");
    return;
  }

  try {
    addTravelTimeBtn.disabled = true;

    const data = await request("/api/events/preview_travel_time/", {
      method: "POST",
      body: JSON.stringify({
        start_place: startPlace,
        next_event_id: nextEventId
      })
    });

    previewParams = {
      start_place: startPlace,
      next_event_id: nextEventId
    };

    renderPreview(data);
    addTravelTimeBtn.disabled = false;
  } catch (error) {
    console.error("이동시간 미리보기 실패:", error);
    alert(error.message || "이동시간 미리보기에 실패했습니다.");
    resetPreviewText();
    addTravelTimeBtn.disabled = true;
    previewParams = null;
  }
}

// 미리보기 결과 출력
function renderPreview(data) {
  const minutes = data.duration_minutes ?? data.message ?? "...";

  timeReportBox.innerHTML = `
    <div>It will take about</div>
    <div class="time-number">
      <span id="travel-time">${minutes}</span>
      <span>minutes...</span>
    </div>
  `;
}

// 추가 버튼 클릭
addTravelTimeBtn.addEventListener("click", async () => {
  if (!previewParams) {
    alert("먼저 검색 버튼을 눌러주세요.");
    return;
  }

  try {
    addTravelTimeBtn.disabled = true;

    const data = await request("/api/events/add_travel_time/", {
      method: "POST",
      body: JSON.stringify(previewParams)
    });

    alert(data.message || "이동 시간이 추가되었습니다.");

    if (data.travel_event) {
      localStorage.setItem("last_added_travel_event_id", data.travel_event.id);
    }

    window.location.href = "personal.html";
  } catch (error) {
    console.error("이동시간 추가 실패:", error);
    alert(error.message || "이동시간 추가에 실패했습니다.");
    addTravelTimeBtn.disabled = false;
  }
});