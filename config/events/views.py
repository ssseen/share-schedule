from django.shortcuts import render

from rest_framework import viewsets
from .models import Event
from .serializers import EventSerializer
from rest_framework.permissions import IsAuthenticated

class EventViewSet(viewsets.ModelViewSet):
   queryset = Event.objects.all()
   serializer_class = EventSerializer
   permission_classes = [IsAuthenticated]
   
   def get_queryset(self):
      return Event.objects.filter(user=self.request.user)
   
   def perform_create(self, serializer):
      serializer.save(user=self.request.user)