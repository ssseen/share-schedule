from django.db import models

from django.db import models
from django.contrib.auth.models import User

class Event(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=100)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    location = models.CharField(max_length=100, blank=True)
    color = models.CharField(max_length=20, blank=True)
    # 1. 이동 시간인지 구분하는 스위치 (0: 일반, 1: 이동시간)
    is_travel_time = models.PositiveIntegerField(default=0)
    
    # 2. 카카오맵 길찾기 URL 저장 (클릭 시 연결용)
    map_url = models.URLField(max_length=500, null=True, blank=True)

    # --------------------------------------

    def __str__(self):
        return f"{self.user.username} - {self.title}"