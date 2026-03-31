from django.shortcuts import render
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import transaction
from django.db.models import Q 
from datetime import datetime, timedelta, time

from .models import Group, GroupMember, AppointmentProposal, CandidateSlot
from .serializers import GroupSerializer
from events.models import Event
from django.contrib.auth.models import User

class GroupViewSet(viewsets.ModelViewSet):
    """
    그룹 관리, 가입, 주간 데이터 계산, 약속 제안 및 투표 기능을 포함한 뷰셋
    """
    serializer_class = GroupSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        [필터링] 현재 로그인한 유저가 방장(owner)이거나 멤버인 그룹만 반환
        """
        user = self.request.user
        return Group.objects.filter(
            Q(owner=user) | Q(members__user=user)
        ).distinct()

    def perform_create(self, serializer):
        """
        그룹 생성 시 생성자를 owner로 설정하고 자동으로 멤버 테이블에 추가
        """
        group = serializer.save(owner=self.request.user)
        GroupMember.objects.create(user=self.request.user, group=group)

    # --- [기능 1] 초대 코드로 그룹 가입 ---
    @action(detail=False, methods=['post'])
    def join(self, request):
        invite_code = request.data.get('invite_code')
        try:
            group = Group.objects.get(invite_code=invite_code)
            
            # 이미 가입된 멤버인지 확인
            if GroupMember.objects.filter(user=request.user, group=group).exists():
                return Response({"message": "이미 이 그룹의 멤버입니다."}, status=status.HTTP_400_BAD_REQUEST)
            
            # 실제 DB에 멤버 데이터 생성 (이게 빠져있어서 조회가 안 됐던 거예요!)
            GroupMember.objects.create(user=request.user, group=group)
            
            return Response({
                "message": f"'{group.name}' 그룹 가입 완료!",
                "group_id": group.id
            }, status=status.HTTP_201_CREATED)
            
        except (Group.DoesNotExist, ValueError):
            return Response({"message": "유효하지 않은 초대 코드입니다."}, status=status.HTTP_404_NOT_FOUND)

    # --- [기능 2] 주간 합산 데이터 (팀원 전체 스케줄 겹쳐보기) ---
    @action(detail=True, methods=['get'])
    def weekly_availability(self, request, pk=None):
        group = self.get_object()
        return Response(self._get_availability_data(group))

    # --- [기능 3] 팀장의 약속 제안 & 추천 알고리즘 ---
    @action(detail=True, methods=['post'])
    def propose(self, request, pk=None):
        group = self.get_object()
        
        # 팀장 권한 체크
        if group.owner != request.user:
            return Response({"message": "팀장만 약속을 제안할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

        location = request.data.get('location')
        duration_minutes = int(request.data.get('duration_minutes', 60))
        duration_slots = duration_minutes // 30

        # 기존 활성화된 제안은 종료 처리
        AppointmentProposal.objects.filter(group=group, is_active=True).update(is_active=False)

        with transaction.atomic():
            # 1. 새 약속 제안 생성
            proposal = AppointmentProposal.objects.create(
                group=group, creator=request.user, location=location, duration_minutes=duration_minutes
            )

            # 2. 전원 가능 시간(slots == 0) 찾기 알고리즘
            availability_data = self._get_availability_data(group)
            
            for day in availability_data:
                date_obj = datetime.strptime(day['date'], '%Y-%m-%d').date()
                slots = day['slots']
                
                for i in range(len(slots) - duration_slots + 1):
                    # 연속된 시간 슬롯이 모두 비어있는지(0인지) 확인
                    if all(s == 0 for s in slots[i : i + duration_slots]):
                        start_dt = datetime.combine(date_obj, time(i // 2, (i % 2) * 30))
                        end_dt = start_dt + timedelta(minutes=duration_minutes)
                        
                        CandidateSlot.objects.create(
                            proposal=proposal, start_time=start_dt, end_time=end_dt
                        )
            
            candidate_list = proposal.candidates.all()
            if not candidate_list.exists():
                proposal.delete()
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

    # --- [기능 4 수정] 여러 후보지에 한꺼번에 투표하기 ---
    @action(detail=True, methods=['post'])
    def vote_slots(self, request, pk=None):
        group = self.get_object()
        slot_ids = request.data.get('slot_ids', [])
        user = request.user

        if not slot_ids or not isinstance(slot_ids, list):
            return Response({"message": "올바른 슬롯 ID 리스트를 보내주세요."}, status=400)

        try:
            # 1. 첫 번째 슬롯 정보 가져오기
            first_slot = CandidateSlot.objects.filter(id=slot_ids[0]).first()
            if not first_slot:
                return Response({"message": "슬롯을 찾을 수 없습니다."}, status=404)
            
            proposal = first_slot.proposal

            with transaction.atomic():
                # 2. 투표 처리
                for s_id in slot_ids:
                    slot = CandidateSlot.objects.get(id=s_id)
                    if slot.proposal.group != group:
                        return Response({"message": "권한이 없는 슬롯입니다."}, status=403)
                    slot.voters.add(user)

                # 3. 전원 일치 여부 판별 (수정된 로직 ⭐)
                total_members = GroupMember.objects.filter(group=group).count()
                
                # annotate를 사용하여 투표자 수를 계산한 뒤 필터링합니다.
                from django.db.models import Count
                confirmed_slot = CandidateSlot.objects.filter(proposal=proposal).annotate(
                    num_voters=Count('voters')
                ).filter(num_voters=total_members).first()

                if confirmed_slot:
                    self._finalize_event(confirmed_slot)
                    proposal.delete() # 확정 후 청소
                    return Response({"status": "confirmed", "message": "확정 및 데이터 정리 완료!"})

                # 4. 실패 판별 (모두 투표했으나 겹치는 게 없음)
                voted_users_count = User.objects.filter(voted_candidates__proposal=proposal).distinct().count()

                if voted_users_count == total_members:
                    proposal.delete() # 실패 시 청소
                    return Response({"status": "failed", "message": "합의 실패로 데이터 삭제."})

                return Response({
                    "status": "voted",
                    "current_voter_count": voted_users_count,
                    "total_member_count": total_members
                })

        except Exception as e:
            return Response({"message": str(e)}, status=500)
    
    def _get_availability_data(self, group):
        """그룹 멤버들의 주간 일정 데이터를 합산하여 48개 슬롯으로 반환"""
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
    # --- [추가] 생성된 후보 시간 리스트 조회하기 ---
    @action(detail=True, methods=['get'])
    def candidates(self, request, pk=None):
        group = self.get_object()
        # 가장 최근에 생성된 활성화된 제안 가져오기
        proposal = AppointmentProposal.objects.filter(group=group, is_active=True).last()
        
        if not proposal:
            return Response({"message": "진행 중인 약속 제안이 없습니다."}, status=404)
            
        candidate_list = proposal.candidates.all()
        return Response({
            "proposal_id": proposal.id,
            "location": proposal.location,
            "duration_minutes": proposal.duration_minutes,
            "candidates": [
                {
                    "id": c.id, 
                    "start": c.start_time.strftime("%Y-%m-%d %H:%M"), 
                    "end": c.end_time.strftime("%H:%M"),
                    "voters_count": c.voters.count(),
                    "my_voted": request.user in c.voters.all() # 내가 투표했는지 여부
                } for c in candidate_list
            ]
        })

    def _finalize_event(self, slot):
        """확정된 약속을 모든 팀원의 개인 Event 모델에 저장"""
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
                    color="#FFD700"
                )
            proposal.is_active = False
            proposal.save()