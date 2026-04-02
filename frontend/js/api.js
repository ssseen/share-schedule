const BASE_URL = "http://127.0.0.1:8000";

// access 토큰 재발급
async function refreshAccessToken() {
  const refresh = localStorage.getItem("refresh");

  if (!refresh) {
    throw new Error("리프레시 토큰 없음");
  }

  const response = await fetch(`${BASE_URL}/api/token/refresh/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    throw new Error("토큰 재발급 실패");
  }

  localStorage.setItem("access", data.access);
  return data.access;
}

// 공통 요청 함수
async function request(url, options = {}, useAuth = true) {
  let token = localStorage.getItem("access");

  let config = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(useAuth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  };

  let response = await fetch(`${BASE_URL}${url}`, config);

  // access 만료 → refresh → 재요청
  if (response.status === 401 && useAuth) {
    try {
      token = await refreshAccessToken();

      config = {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {})
        }
      };

      response = await fetch(`${BASE_URL}${url}`, config);
    } catch (error) {
      console.error("토큰 갱신 실패:", error);
      alert("로그인이 만료되었습니다. 다시 로그인해주세요.");
      window.location.href = "login.html";
      return;
    }
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("API 에러:", data);
    throw new Error(data?.detail || data?.message || "서버 요청 실패");
  }

  return data;
}

// 토큰에서 현재 로그인 user_id 꺼내기

function getCurrentUserId() {
  const token = localStorage.getItem("access");
  if (!token) return null;

  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    return payload.user_id || payload.id || null;
  } catch (error) {
    console.error("토큰 파싱 실패:", error);
    return null;
  }
}

// 일정 전체 조회 / 주차별 조회

async function getEvents(startDate = null, endDate = null) {
  let url = "/api/events/";

  const queryParams = new URLSearchParams();

  if (startDate) {
    queryParams.append("start_date", startDate);
  }

  if (endDate) {
    queryParams.append("end_date", endDate);
  }

  const queryString = queryParams.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  return await request(url, {
    method: "GET"
  });
}

// 일정 생성

async function createEvent(eventData) {
  return await request("/api/events/", {
    method: "POST",
    body: JSON.stringify(eventData)
  });
}

// 일정 수정

async function updateEvent(eventId, eventData) {
  return await request(`/api/events/${eventId}/`, {
    method: "PUT",
    body: JSON.stringify(eventData)
  });
}

// 일정 삭제

async function deleteEvent(eventId) {
  return await request(`/api/events/${eventId}/`, {
    method: "DELETE"
  });
}

// 이동시간 미리보기

async function previewTravelTime(startPlace, nextEventId) {
  return await request("/api/events/preview_travel_time/", {
    method: "POST",
    body: JSON.stringify({
      start_place: startPlace,
      next_event_id: nextEventId
    })
  });
}

// 이동시간 실제 추가

async function addTravelTime(startPlace, nextEventId) {
  return await request("/api/events/add_travel_time/", {
    method: "POST",
    body: JSON.stringify({
      start_place: startPlace,
      next_event_id: nextEventId
    })
  });
}

// 그룹 생성

async function createGroup(groupName) {
  return await request("/api/groups/", {
    method: "POST",
    body: JSON.stringify({
      name: groupName
    })
  });
}

// 초대코드로 그룹 가입

async function joinGroup(inviteCode) {
  return await request("/api/groups/join/", {
    method: "POST",
    body: JSON.stringify({
      invite_code: inviteCode
    })
  });
}

// 내 그룹 목록 조회

async function getMyGroups() {
  return await request("/api/groups/", {
    method: "GET"
  });
}

// 그룹 단건 조회, group.js에서 상세정보 필요하면 사용
async function getGroupDetail(groupId) {
  return await request(`/api/groups/${groupId}/`, {
    method: "GET"
  });
}

// 내가 팀장인지 확인

function isGroupOwner(groupData) {
  const myUserId = getCurrentUserId();
  if (!myUserId || !groupData) return false;
  return Number(groupData.owner) === Number(myUserId);
}

// 그룹 주간 빈 시간 조회
async function getWeeklyAvailability(groupId) {
  return await request(`/api/groups/${groupId}/weekly_availability/`, {
    method: "GET"
  });
}

// 팀장 약속 제안
async function proposeMeeting(groupId, location, durationMinutes) {
  return await request(`/api/groups/${groupId}/propose/`, {
    method: "POST",
    body: JSON.stringify({
      location: location,
      duration_minutes: durationMinutes
    })
  });
}

// 후보 리스트 조회
async function getCandidates(groupId) {
  return await request(`/api/groups/${groupId}/candidates/`, {
    method: "GET"
  });
}

// 후보 슬롯 투표
async function voteSlots(groupId, slotIds) {
  return await request(`/api/groups/${groupId}/vote_slots/`, {
    method: "POST",
    body: JSON.stringify({
      slot_ids: slotIds
    })
  });
}