# groups/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import GroupViewSet

router = DefaultRouter()
router.register(r'', GroupViewSet) # r'' 또는 r'groups' 확인

urlpatterns = [
    path('', include(router.urls)),
]