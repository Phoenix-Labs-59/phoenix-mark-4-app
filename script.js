const inputField = document.getElementById("userInput");
const sendBtn = document.getElementById("send-btn");
const chatBox = document.getElementById("chat-box");

const uploadBtn = document.getElementById("upload-btn");
const uploadInput = document.getElementById("upload-input");

function addMessage(sender, text) {
  const message = document.createElement("div");
  message.classList.add("message", sender);

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.innerText = text;

  message.appendChild(bubble);
  chatBox.appendChild(message);

  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

// Detect a YouTube URL in text
function extractYouTubeUrl(text) {
  const regex =
    /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{11}|youtu\.be\/[\w-]{11}|youtube\.com\/shorts\/[\w-]{11}))/;
  const match = text.match(regex);
  return match ? match[1] : null;
}

async function callPhoenixChat(messages) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) throw new Error("Network / server error");

  const data = await res.json();
  if (!data.reply) throw new Error("Empty reply from Phoenix");
  return data.reply;
}

async function handleSend() {
  const userText = inputField.value.trim();
  if (!userText) return;

  addMessage("user", userText);
  inputField.value = "";

  const loadingMsg = document.createElement("div");
  loadingMsg.classList.add("message", "ai");
  loadingMsg.innerHTML = `<div class="bubble">PHOENIX MARK 4 is thinking...</div>`;
  chatBox.appendChild(loadingMsg);
  loadingMsg.scrollIntoView({ behavior: "smooth", block: "end" });

  try {
    const ytUrl = extractYouTubeUrl(userText);

    if (ytUrl) {
      const questionOnly = userText.replace(ytUrl, "").trim();

      const res = await fetch("/api/youtube-transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: ytUrl,
          question: questionOnly,
        }),
      });

      const data = await res.json();
      loadingMsg.remove();

      if (!res.ok) {
        addMessage(
          "ai",
          data.error ||
            "Phoenix couldn't summarize this video right now. Try another link."
        );
      } else {
        addMessage("ai", data.reply || "Got the transcript but reply was empty.");
      }
    } else {
      const history = [];
      const msgs = chatBox.querySelectorAll(".message");
      msgs.forEach((msgEl) => {
        const role = msgEl.classList.contains("user") ? "user" : "assistant";
        const content = msgEl.querySelector(".bubble")?.innerText || "";
        if (content) history.push({ role, content });
      });

      const reply = await callPhoenixChat(history);
      loadingMsg.remove();
      addMessage("ai", reply);
    }
  } catch (err) {
    console.error(err);
    loadingMsg.remove();
    addMessage(
      "ai",
      "Bro Damnn it someone just disconnected me from the backend. Man I have to cut these guys salary."
    );
  }
}

// Handle file upload (images + pdf) + note text
async function handleFileUpload(file) {
  if (!file) return;

  const userNote = inputField.value.trim();
  if (userNote) {
    addMessage("user", `${userNote}\n\n[Attached: ${file.name}]`);
    inputField.value = "";
  } else {
    addMessage("user", `Uploaded: ${file.name}`);
  }

  const loadingMsg = document.createElement("div");
  loadingMsg.classList.add("message", "ai");
  loadingMsg.innerHTML = `<div class="bubble">PHOENIX MARK 4 is reading your file...</div>`;
  chatBox.appendChild(loadingMsg);
  loadingMsg.scrollIntoView({ behavior: "smooth", block: "end" });

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append(
      "question",
      userNote || "Explain this file and tell me what you see."
    );

    const res = await fetch("/api/file-analyze", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    loadingMsg.remove();

    if (!res.ok) {
      addMessage(
        "ai",
        data.error ||
          "Phoenix couldn't analyze this file right now. Try another one."
      );
    } else {
      addMessage("ai", data.reply || "Got the file but reply was empty.");
    }
  } catch (err) {
    console.error(err);
    loadingMsg.remove();
    addMessage(
      "ai",
      "Bro Damnn it someone just disconnected me from the backend. Man I have to cut these guys salary."
    );
  }
}

sendBtn.addEventListener("click", handleSend);

inputField.addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleSend();
});

// Clicking the pin opens file picker
uploadBtn.addEventListener("click", () => {
  uploadInput.click();
});

// When a file is chosen, upload it
uploadInput.addEventListener("change", () => {
  const file = uploadInput.files[0];
  if (file) {
    handleFileUpload(file);
  }
  uploadInput.value = "";
});

// Initial welcome
addMessage(
  "ai",
  "Hello I am your personal assistant PHOENIX MARK IV. Lets talk."
);
