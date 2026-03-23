from django.contrib import admin
from .models import Group, GroupMember

class GroupAdmin(admin.ModelAdmin):
    # 관리자 목록에서 보여줄 항목들
    list_display = ('id', 'name', 'owner', 'invite_code', 'created_at')
    # 클릭해서 들어갔을 때 상세 페이지에서 보여줄 항목들
    fields = ('name', 'owner', 'invite_code')
    # 초대 코드는 자동 생성이니 수정 못 하게 읽기 전용으로 설정 (선택사항)
    readonly_fields = ('invite_code',)

admin.site.register(Group, GroupAdmin)
admin.site.register(GroupMember)