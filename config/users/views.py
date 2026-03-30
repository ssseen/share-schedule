from django.shortcuts import render
from rest_framework import generics
from rest_framework.permissions import AllowAny  # 1. AllowAny 임포트
from django.contrib.auth.models import User      # User 모델 임포트 확인
from .serializers import RegisterSerializer

class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()                # 추가해주는 것이 좋습니다.
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]              # 2. 누구나 접근 가능하게 설정!