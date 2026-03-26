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
        """일반 일정 생성 시 시간이 겹치는지 검사"""
        user = self.request.user
        # 1. 새로 만들려는 일정의 시작/종료 시간 가져오기
        start_time = serializer.validated_data.get('start_time')
        end_time = serializer.validated_data.get('end_time')

        # 2. DB에 겹치는 시간이 있는지 검사 (이동 시간 로직과 동일)
        conflict_exists = Event.objects.filter(
            user=user,
            start_time__lt=end_time,      # 새 일정 종료보다 기존 시작이 빠르고
            end_time__gt=start_time       # 새 일정 시작보다 기존 종료가 늦은 경우
        ).exists()

        if conflict_exists:
            # 3. 겹치면 에러를 던져서 저장을 막음
            from rest_framework.exceptions import ValidationError
            raise ValidationError("해당 시간에 이미 다른 일정이 있어 저장할 수 없습니다.")

        # 4. 겹치지 않을 때만 안전하게 저장
        serializer.save(user=user)

    # ---------- [여기서부터 이동 시간 계산 핵심 로직] ----------

    @action(detail=False, methods=['post'])
    def add_travel_time(self, request):
        """
        [POST] /api/events/add_travel_time/
        이동 시간을 계산하고, 시간이 비어있을 때만 일정을 등록합니다.
        """
        user = request.user
        data = request.data

        start_place = data.get('start_place')
        end_place = data.get('end_place')
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
            return Response({"error": "경로 계산에 실패했습니다."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # 4. 시간 계산 (도착 시간 - 소요 시간)
        arrival_time = next_event.start_time
        travel_start_time = arrival_time - timedelta(seconds=duration_seconds)

        # 🔥 [추가 로직] 5. 시간 충돌 체크 (앞 시간이 비어있는지 확인)
        # 내가 이동해야 할 시간대에 다른 일정이 겹치는지 DB에서 조회
        conflict_exists = Event.objects.filter(
            user=user,
            start_time__lt=arrival_time,      # 기존 일정의 시작이 이동 종료보다 빠르고
            end_time__gt=travel_start_time    # 기존 일정의 종료가 이동 시작보다 늦은 경우
        ).exists()

        if conflict_exists:
            return Response({
                "error": "이동 시간 계산 불가",
                "message": "해당 시간대에 이미 다른 일정이 있어 이동 시간을 등록할 수 없습니다. 앞 일정을 조정해주세요."
            }, status=status.HTTP_400_BAD_REQUEST)

        # 6. 카카오맵 길찾기 URL 생성
        map_url = f"https://map.kakao.com/link/from/{start_place},{start_y},{start_x}/to/{end_place},{end_y},{end_x}"

        # 7. 이동 일정 DB 저장
        travel_event = Event.objects.create(
            user=user,
            title=f"🚗 이동 ({start_place} ➡️ {end_place})",
            start_time=travel_start_time,
            end_time=arrival_time,
            location=f"{start_place} -> {end_place}",
            color="#D3D3D3",
            is_travel_time=1,
            map_url=map_url
        )

        return Response({
            "message": "이동 시간이 성공적으로 등록되었습니다.",
            "travel_event": EventSerializer(travel_event).data
        }, status=status.HTTP_201_CREATED)


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
        except Exception:
            pass
        return None, None

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
        except Exception:
            pass
        return None