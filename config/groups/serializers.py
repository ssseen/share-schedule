from rest_framework import serializers
from .models import Group, GroupMember
from django.contrib.auth.models import User

class GroupSerializer(serializers.ModelSerializer):
    owner_name = serializers.ReadOnlyField(source='owner.username')

    class Meta:
        model = Group
        fields = ['id', 'name', 'owner', 'owner_name', 'invite_code', 'created_at']
        read_only_fields = ['invite_code', 'owner']