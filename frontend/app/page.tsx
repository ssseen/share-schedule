"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

type CalendarEvent = {
  id: number;
  title: string;
  start: string;
  end: string;
};

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    const token = localStorage.getItem("access");

    try {
      const res = await fetch("http://127.0.0.1:8000/api/events/", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      console.log("GET 응답:", data);

      if (Array.isArray(data)) {
        const formattedEvents = data.map((item: any) => ({
          id: item.id,
          title: item.title,
          start: item.start_time,
          end: item.end_time,
        }));

        setEvents(formattedEvents);
      } else {
        setEvents([]);
      }
    } catch (error) {
      console.error("일정 불러오기 실패:", error);
    }
  };

  const handleDateClick = async (info: any) => {
    const title = prompt("일정 제목");
    if (!title) return;

    const token = localStorage.getItem("access");

    const startDate = new Date(info.date);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    try {
      const res = await fetch("http://127.0.0.1:8000/api/events/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        }),
      });

      const data = await res.json();
      console.log("POST 응답:", data);

      if (!res.ok) {
        alert("일정 추가 실패");
        return;
      }

      fetchEvents();
    } catch (error) {
      console.error("일정 추가 실패:", error);
    }
  };

  const handleEventClick = async (info: any) => {
    const token = localStorage.getItem("access");
    const id = info.event.id;

    const action = prompt("수정하려면 edit, 삭제하려면 delete 입력");

    if (action === "delete") {
      const ok = confirm("이 일정을 삭제할까?");
      if (!ok) return;

      try {
        const res = await fetch(`http://127.0.0.1:8000/api/events/${id}/`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          alert("삭제 실패");
          return;
        }

        fetchEvents();
      } catch (error) {
        console.error("삭제 실패:", error);
      }
    }

    if (action === "edit") {
      const newTitle = prompt("새 일정 제목", info.event.title);
      if (!newTitle) return;

      const currentStart = info.event.start
        ? new Date(info.event.start)
        : new Date();
      const currentEnd = info.event.end
        ? new Date(info.event.end)
        : new Date(currentStart.getTime() + 60 * 60 * 1000);

      try {
        const res = await fetch(`http://127.0.0.1:8000/api/events/${id}/`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: newTitle,
            start_time: currentStart.toISOString(),
            end_time: currentEnd.toISOString(),
          }),
        });

        const data = await res.json();
        console.log("PUT 응답:", data);

        if (!res.ok) {
          alert("수정 실패");
          return;
        }

        fetchEvents();
      } catch (error) {
        console.error("수정 실패:", error);
      }
    }
  };

  return (
    <main className="p-5">
      <h1 className="mb-4 text-2xl font-bold">내 일정표</h1>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        events={events}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
        height="auto"
      />
    </main>
  );
}