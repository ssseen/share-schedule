from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import Group, GroupMember, AppointmentProposal, CandidateSlot
from .serializers import GroupSerializer
from events.models import Event
from datetime import datetime, timedelta, time
from django.db import transaction

class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        # 그룹 생성 시 생성자를 owner로 설정하고 멤버로 자동 추가
        group = serializer.save(owner=self.request.user)
        GroupMember.objects.create(user=self.request.user, group=group)

    # --- [기능 1] 초대 코드로 그룹 가입 ---
    @action(detail=False, methods=['post'])
    def join(self, request):
        invite_code = request.data.get('invite_code')
        try:
            group = Group.objects.get(invite_code=invite_code)
            if GroupMember.objects.filter(user=request.user, group=group).exists():
                return Response({"message": "이미 이 그룹의 멤버입니다."}, status=status.HTTP_400_BAD_REQUEST)
            
            GroupMember.objects.create(user=request.user, group=group)
            return Response({
                "message": f"'{group.name}' 그룹 가입 완료!",
                "group_id": group.id
            }, status=status.HTTP_201_CREATED)
        except (Group.DoesNotExist, ValueError):
            return Response({"message": "유효하지 않은 초대 코드입니다."}, status=status.HTTP_404_NOT_FOUND)

    # --- [기능 2] 주간 합산 데이터 (왼쪽 타임테이블용) ---
    @action(detail=True, methods=['get'])
    def weekly_availability(self, request, pk=None):
        group = self.get_object()
        return Response(self._get_availability_data(group))

    # --- [기능 3] 팀장의 약속 제안 & 알고리즘 (추천 리스트 생성) ---
    @action(detail=True, methods=['post'])
    def propose(self, request, pk=None):
        group = self.get_object()
        
        # 팀장 권한 체크
        if group.owner != request.user:
            return Response({"message": "팀장만 약속을 잡을 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

        location = request.data.get('location')
        duration_minutes = int(request.data.get('duration_minutes', 60))
        duration_slots = duration_minutes // 30

        # 기존 활성화된 제안은 종료 처리
        AppointmentProposal.objects.filter(group=group, is_active=True).update(is_active=False)

        with transaction.atomic():
            # 1. 새 약속 제안 데이터 생성
            proposal = AppointmentProposal.objects.create(
                group=group, creator=request.user, location=location, duration_minutes=duration_minutes
            )

            # 2. 알고리즘: 전원 가능 시간(slots == 0) 찾기
            availability_data = self._get_availability_data(group)
            
            for day in availability_data:
                date_obj = datetime.strptime(day['date'], '%Y-%m-%d').date()
                slots = day['slots']
                
                # 슬라이딩 윈도우 방식으로 연속된 0을 찾음
                for i in range(len(slots) - duration_slots + 1):
                    if all(s == 0 for s in slots[i : i + duration_slots]):
                        start_dt = datetime.combine(date_obj, time(i // 2, (i % 2) * 30))
                        end_dt = start_dt + timedelta(minutes=duration_minutes)
                        
                        # 후보 시간 DB 저장
                        CandidateSlot.objects.create(
                            proposal=proposal, start_time=start_dt, end_time=end_dt
                        )
            
            candidate_list = proposal.candidates.all()
            if not candidate_list.exists():
                proposal.delete() # 추천 시간이 없으면 제안 삭제
                return Response({"message": "모두가 가능한 시간이 없습니다. 조건을 변경해주세요."}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "message": "알고리즘 추천 완료!",
            "proposal_id": proposal.id,
            "candidates": [
                {
                    "id": c.id, 
                    "start": c.start_time.strftime("%Y-%m-%d %H:%M"), 
                    "end": c.end_time.strftime("%H:%M")
                } for c in candidate_list
            ]
        })

    # --- [기능 4] 후보지에 투표하기 & 자동 확정 ---
    @action(detail=False, methods=['post'])
    def vote_slot(self, request):
        slot_id = request.data.get('slot_id')
        user = request.user
        
        try:
            slot = CandidateSlot.objects.get(id=slot_id)
            group = slot.proposal.group
            
            # 투표 토글 (있으면 제거, 없으면 추가)
            if user in slot.voters.all():
                slot.voters.remove(user)
                status_msg = "취소"
            else:
                slot.voters.add(user)
                status_msg = "완료"
            
            # 전원 투표 여부 확인
            total_members = GroupMember.objects.filter(group=group).count()
            current_voters = slot.voters.count()
            
            # [자동 확정 로직] 전원이 이 슬롯에 투표했다면?
            if current_voters == total_members:
                self._finalize_event(slot)
                return Response({
                    "status": "confirmed",
                    "message": "🎉 전원 일치! 모든 팀원의 개인 캘린더에 일정이 추가되었습니다."
                }, status=status.HTTP_200_OK)
                
            return Response({
                "status": "voting",
                "message": f"투표 {status_msg}",
                "current_count": current_voters,
                "total_count": total_members
            })

        except CandidateSlot.DoesNotExist:
            return Response({"message": "존재하지 않는 슬롯입니다."}, status=status.HTTP_404_NOT_FOUND)

    # --- 내부 헬퍼 함수들 (로직 재사용용) ---

    def _get_availability_data(self, group):
        """그룹 멤버들의 주간 0~47 슬롯 데이터를 계산하는 공통 로직"""
        members = GroupMember.objects.filter(group=group).values_list('user_id', flat=True)
        today = datetime.now().date()
        start_of_week = today - timedelta(days=today.weekday())
        
        result = []
        for i in range(7):
            current_date = start_of_week + timedelta(days=i)
            slots = [0] * 48
            events = Event.objects.filter(user_id__in=members, start_time__date=current_date)
            for event in events:
                s_idx = event.start_time.hour * 2 + (1 if event.start_time.minute >= 30 else 0)
                e_idx = event.end_time.hour * 2 + (1 if event.end_time.minute >= 30 else 0)
                for idx in range(s_idx, e_idx):
                    if idx < 48: slots[idx] += 1
            result.append({"date": current_date.strftime("%Y-%m-%d"), "slots": slots})
        return result

    def _finalize_event(self, slot):
        """확정된 슬롯을 모든 멤버의 개인 Event 모델로 복사 저장"""
        proposal = slot.proposal
        members = GroupMember.objects.filter(group=proposal.group)
        with transaction.atomic():
            for member in members:
                Event.objects.create(
                    user=member.user,
                    title=f"[{proposal.group.name}] 팀 약속",
                    start_time=slot.start_time,
                    end_time=slot.end_time,
                    location=proposal.location,
                    color="#FFD700" # 확정된 약속 색상
                )
            proposal.is_active = False
            proposal.save()