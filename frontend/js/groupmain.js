document.addEventListener("DOMContentLoaded", () => {
  const teamNameInput = document.getElementById("team-name");
  const enterIcon = document.querySelector(".enter-icon");
  const createCodeArea = document.querySelector(".create-code");
  const enterCodeArea = document.querySelector(".enter-code");
  const enterBtn = document.getElementById("enter-btn");
  const rightArea = document.querySelector(".right-area");

  if (!teamNameInput || !createCodeArea || !enterCodeArea || !enterBtn || !rightArea) {
    console.error("groupmain.html의 필수 요소를 찾지 못했습니다.");
    return;
  }

  function setupCodeOverlay() {
    let codeText = createCodeArea.querySelector(".code-text");

    if (!codeText) {
      codeText = document.createElement("div");
      codeText.className = "code-text";
      createCodeArea.appendChild(codeText);
    }

    return codeText;
  }

  const codeTextEl = setupCodeOverlay();

  function showInviteCode(code) {
    codeTextEl.textContent = code || "";
  }

  function setupInviteInput() {
    let inviteInput = document.getElementById("invite-code-input");

    if (!inviteInput) {
      inviteInput = document.createElement("input");
      inviteInput.type = "text";
      inviteInput.id = "invite-code-input";
      inviteInput.autocomplete = "off";

      enterCodeArea.appendChild(inviteInput);
    }

    return inviteInput;
  }

  const inviteCodeInput = setupInviteInput();

  function setupTeamListBox() {
    let teamListBox = rightArea.querySelector(".team-list-box");

    if (!teamListBox) {
      teamListBox = document.createElement("div");
      teamListBox.className = "team-list-box";
      rightArea.appendChild(teamListBox);
    }

    return teamListBox;
  }

  const teamListBox = setupTeamListBox();

  function getSafeCurrentUserId() {
    try {
      if (typeof getCurrentUserId === "function") {
        return Number(getCurrentUserId());
      }
    } catch (error) {
      console.error("현재 사용자 ID 확인 실패:", error);
    }

    return null;
  }

  function isGroupOwner(group) {
    const currentUserId = getSafeCurrentUserId();

    if (currentUserId == null || !group) {
      return false;
    }

    if (typeof group.owner === "number" || typeof group.owner === "string") {
      return Number(group.owner) === currentUserId;
    }

    if (group.owner && typeof group.owner === "object") {
      return Number(group.owner.id) === currentUserId;
    }

    if (typeof group.is_owner === "boolean") {
      return group.is_owner;
    }

    return false;
  }

  function goToGroupPage(group) {
    const role = isGroupOwner(group) ? "leader" : "member";
    location.href = `group.html?groupId=${group.id}&role=${role}`;
  }

  async function renderTeamList() {
    try {
      const groups = await getMyGroups();
      teamListBox.innerHTML = "";

      if (!groups || groups.length === 0) {
        const emptyText = document.createElement("div");
        emptyText.className = "team-empty-text";
        emptyText.textContent = "참여 중인 팀이 없습니다.";
        teamListBox.appendChild(emptyText);
        return;
      }

      groups.forEach(group => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "team-item";
        item.textContent = group.name;

        item.addEventListener("click", () => {
          goToGroupPage(group);
        });

        teamListBox.appendChild(item);
      });
    } catch (error) {
      console.error(error);
      alert(error.message || "그룹 목록을 불러오지 못했습니다.");
    }
  }


  async function handleCreateGroup() {
    const teamName = teamNameInput.value.trim();

    if (!teamName) {
      alert("팀명을 입력해주세요.");
      return;
    }

    try {
      const newGroup = await createGroup(teamName);

      showInviteCode(newGroup.invite_code);
      teamNameInput.value = "";
      await renderTeamList();

    } catch (error) {
      console.error(error);
      alert(error.message || "그룹 생성에 실패했습니다.");
    }
  }


  async function handleJoinGroup() {
    const inviteCode = inviteCodeInput.value.trim();

    if (!inviteCode) {
      alert("초대코드를 입력해주세요.");
      return;
    }

    try {
      const joinedGroup = await joinGroup(inviteCode);

      inviteCodeInput.value = "";
      await renderTeamList();
      alert("그룹에 가입됐습니다.");

    } catch (error) {
      console.error(error);
      alert(error.message || "그룹 가입에 실패했습니다.");
    }
  }

  teamNameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      handleCreateGroup();
    }
  });

  if (enterIcon) {
    enterIcon.addEventListener("click", handleCreateGroup);
  }

  inviteCodeInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      handleJoinGroup();
    }
  });

  enterBtn.addEventListener("click", handleJoinGroup);

  renderTeamList();
});