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
        
    def perform_update(self, serializer):
        """일정 수정 시 시간이 겹치는지 검사"""
        user = self.request.user
        # 수정하려는 일정의 ID와 새로운 시간 정보
        instance = self.get_object()
        start_time = serializer.validated_data.get('start_time', instance.start_time)
        end_time = serializer.validated_data.get('end_time', instance.end_time)

        # DB에 겹치는 시간이 있는지 검사 (단, 현재 수정 중인 내 일정(ID)은 제외!)
        conflict_exists = Event.objects.filter(
            user=user,
            start_time__lt=end_time,
            end_time__gt=start_time
        ).exclude(id=instance.id).exists() # ⭐ 이 부분이 핵심! 나 자신은 빼고 검사

        if conflict_exists:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("수정하려는 시간에 이미 다른 일정이 있습니다.")

        serializer.save()
    # ---------- [여기서부터 이동 시간 계산 핵심 로직] ----------

    @action(detail=False, methods=['post'])
    def add_travel_time(self, request):
        user = request.user
        data = request.data

        # [수정 1] 이제 end_place는 입력받지 않습니다.
        start_place = data.get('start_place')
        next_event_id = data.get('next_event_id')

        # [수정 2] 필수 값 체크에서 end_place 제외
        if not all([start_place, next_event_id]):
            return Response({"error": "출발지와 다음 일정 ID가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

        # 1. 기준이 되는 다음 일정 가져오기
        try:
            next_event = Event.objects.get(id=next_event_id, user=user)
            # [수정 3] DB에 저장된 장소를 end_place 변수에 담기
            end_place = next_event.location 
        except Event.DoesNotExist:
            return Response({"error": "해당 일정을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

        # 2. 좌표(x, y) 추출 (이 로직은 유지하되, 위에서 가져온 end_place를 씁니다!)
        start_x, start_y = self._get_coords(start_place)
        end_x, end_y = self._get_coords(end_place) # ⬅️ DB에서 가져온 장소로 좌표 변환!

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
            color="#B7C9E2",
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
    # ---------- [3-1번 페이지용: 미리보기 로직 추가] ----------

    @action(detail=False, methods=['post'])
    def preview_travel_time(self, request):
        user = request.user
        data = request.data

        start_place = data.get('start_place')
        next_event_id = data.get('next_event_id')

    # 1. 필수 값 체크 (end_place는 뺍니다!)
        if not all([start_place, next_event_id]):
            return Response({"error": "출발지와 다음 일정 ID가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

    # 2. 기준 일정 확인 및 도착지(location) 가져오기
        try:
            next_event = Event.objects.get(id=next_event_id, user=user)
            end_place = next_event.location  # ⭐ 여기서 DB에 저장된 장소를 자동으로 가져옵니다!
        except Event.DoesNotExist:
            return Response({"error": "일정을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    # 3. 좌표 및 시간 계산 (기존 로직 동일)
        start_x, start_y = self._get_coords(start_place)
        end_x, end_y = self._get_coords(end_place) # 위에서 가져온 end_place 사용!
        
        if not start_x or not end_x:
            return Response({"error": "장소를 찾을 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

        duration_seconds = self._get_driving_duration(start_x, start_y, end_x, end_y)
        
        if duration_seconds is None:
            return Response({"error": "경로 계산 실패"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # 4. 결과 조립 (저장 X, 정보만 리턴)
        duration_minutes = duration_seconds // 60
        arrival_time = next_event.start_time
        travel_start_time = arrival_time - timedelta(seconds=duration_seconds)

        return Response({
            "start_place": start_place,
            "end_place": end_place,
            "duration_minutes": duration_minutes,
            "expected_start": travel_start_time.isoformat(),
            "expected_end": arrival_time.isoformat(),
            "message": f"{duration_minutes}"
        }, status=status.HTTP_200_OK)