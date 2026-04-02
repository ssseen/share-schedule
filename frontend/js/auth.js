const loginForm = document.querySelector(".login-login-area");
const loginIdInput = document.getElementById("login-id");
const loginPwInput = document.getElementById("login-pw");
const loginMessage = document.getElementById("login-message");
const signupButton = document.getElementById("login-signup-box");

// 로그인
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = loginIdInput.value.trim();
  const password = loginPwInput.value.trim();

  if (!username || !password) {
    loginMessage.textContent = "아이디와 비밀번호를 입력해주세요.";
    return;
  }

  try {
    const data = await request(
      "/api/login/",
      {
        method: "POST",
        body: JSON.stringify({
          username: username,
          password: password
        })
      },
      false
    );

    localStorage.setItem("access", data.access);
    localStorage.setItem("refresh", data.refresh);

    loginMessage.textContent = "로그인 성공!";
    location.href = "personal.html";
  } catch (error) {
    console.log(error);
    loginMessage.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
  }
});

// 회원가입
signupButton.addEventListener("click", async () => {
  const username = loginIdInput.value.trim();
  const password = loginPwInput.value.trim();

  if (!username || !password) {
    loginMessage.textContent = "아이디와 비밀번호를 입력해주세요.";
    return;
  }

  try {
    await request(
      "/api/users/register/",
      {
        method: "POST",
        body: JSON.stringify({
          username: username,
          password: password
        })
      },
      false
    );

    loginMessage.textContent = "회원가입 완료! 로그인 해주세요.";
  } catch (error) {
    console.log(error);
    loginMessage.textContent = "이미 존재하는 아이디입니다.";
  }
});