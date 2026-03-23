import uuid
from django.db import models
from django.contrib.auth.models import User

class Group(models.Model):
    name = models.CharField(max_length=100)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='owned_groups')
    invite_code = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

class GroupMember(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='members')
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'group')

class AppointmentProposal(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='proposals')
    creator = models.ForeignKey(User, on_delete=models.CASCADE)
    location = models.CharField(max_length=255) # 팀장이 정한 장소
    duration_minutes = models.IntegerField(default=60) # 소요 시간 (분 단위)
    is_active = models.BooleanField(default=True) # 현재 진행 중인 약속 잡기인지
    created_at = models.DateTimeField(auto_now_add=True)

class CandidateSlot(models.Model):
    proposal = models.ForeignKey(AppointmentProposal, on_delete=models.CASCADE, related_name='candidates')
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    # 누가 이 시간에 "좋아요(체크)"를 눌렀는지 저장
    voters = models.ManyToManyField(User, blank=True, related_name='voted_candidates')

    def __str__(self):
        return f"{self.start_time.strftime('%m/%d %H:%M')} 후보"