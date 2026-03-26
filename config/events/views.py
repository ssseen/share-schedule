import requests
from datetime import timedelta
from django.utils.dateparse import parse_datetime
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import Event
from .serializers import EventSerializer

# 혜빈님의 카카오 REST API 키
KAKAO_REST_API_KEY = "74ca7fba1c966bf8f9371ef380d2e79f"

class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.all()
    serializer_class = EventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # ---------- [여기서부터 이동 시간 계산 핵심 로직] ----------

    @action(detail=False, methods=['post'])
    def add_travel_time(self, request):
        """
        [POST] /api/events/add_travel_time/
        출발지, 도착지, 다음 일정 ID를 받아 이동 시간을 계산하고 저장합니다.
        """
        user = request.user
        data = request.data

        start_place = data.get('start_place')      # 예: "덕성여자대학교"
        end_place = data.get('end_place')          # 예: "강남역"
        next_event_id = data.get('next_event_id')

        if not all([start_place, end_place, next_event_id]):
            return Response({"error": "출발지, 도착지, 다음 일정 ID가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

        # 1. 기준이 되는 다음 일정 가져오기
        try:
            next_event = Event.objects.get(id=next_event_id, user=user)
        except Event.DoesNotExist:
            return Response({"error": "해당 일정을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        # 2. 출발지 및 도착지 좌표(x, y) 추출
        start_x, start_y = self._get_coords(start_place)
        end_x, end_y = self._get_coords(end_place)

        if not start_x or not end_x:
            return Response({"error": "주소를 찾을 수 없습니다. 정확한 장소명을 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)

        # 3. 카카오 모빌리티 API로 소요 시간(초) 계산
        duration_seconds = self._get_driving_duration(start_x, start_y, end_x, end_y)
        
        if duration_seconds is None:
            return Response({"error": "경로 계산에 실패했습니다. 카카오 설정을 확인하세요."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # 4. 시간 계산 (도착 시간 - 소요 시간)
        arrival_time = next_event.start_time
        travel_start_time = arrival_time - timedelta(seconds=duration_seconds)

        # 5. 카카오맵 길찾기 URL 생성
        # 패턴: /link/from/이름,위도,경도/to/이름,위도,경도
        map_url = f"https://map.kakao.com/link/from/{start_place},{start_y},{start_x}/to/{end_place},{end_y},{end_x}"

        # 6. 이동 일정 DB 저장
        travel_event = Event.objects.create(
            user=user,
            title=f"🚗 이동 ({start_place} ➡️ {end_place})",
            start_time=travel_start_time,
            end_time=arrival_time,
            location=f"{start_place} -> {end_place}",
            color="#D3D3D3",  # 이동 시간은 회색
            is_travel_time=1,
            map_url=map_url
        )

        return Response({
            "message": "이동 시간이 성공적으로 등록되었습니다.",
            "travel_event": EventSerializer(travel_event).data
        }, status=status.HTTP_201_CREATED)


    # [보조 함수 1] 키워드로 좌표 찾기
    def _get_coords(self, address):
        url = "https://dapi.kakao.com/v2/local/search/keyword.json"
        headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
        params = {"query": address}
        
        try:
            response = requests.get(url, headers=headers, params=params)
            if response.status_code == 200:
                documents = response.json().get('documents')
                if documents:
                    return documents[0]['x'], documents[0]['y']
        except Exception as e:
            print(f"좌표 변환 에러: {e}")
        return None, None

    # [보조 함수 2] 자동차 소요 시간 계산
    def _get_driving_duration(self, start_x, start_y, end_x, end_y):
        url = "https://apis-navi.kakaomobility.com/v1/directions"
        headers = {
            "Authorization": f"KakaoAK {KAKAO_REST_API_KEY}",
            "Content-Type": "application/json"
        }
        params = {
            "origin": f"{start_x},{start_y}",
            "destination": f"{end_x},{end_y}",
            "priority": "TIME"
        }
        
        try:
            response = requests.get(url, headers=headers, params=params)
            data = response.json()
            if response.status_code == 200 and 'routes' in data:
                route = data['routes'][0]
                if route.get('result_code') == 0:
                    return route['sections'][0]['duration']
        except Exception as e:
            print(f"경로 계산 에러: {e}")
        return None