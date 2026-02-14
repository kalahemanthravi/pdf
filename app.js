const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const apiKeyEl = document.getElementById("apiKey");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");

const GEMINI_MODELS = ["gemini-3-flash-preview"];

const state = {
  recognition: null,
  shouldListen: false,
  recognitionRunning: false,
  awake: false,
  speaking: false,
  lastSpoken: "",
  lastSpokenAt: 0,
  duplicateGuard: {
    command: "",
    at: 0,
  },
  history: [],
  timerId: null,
  stopwatch: {
    running: false,
    startedAt: 0,
    elapsedBeforeStart: 0,
  },
};

const SYSTEM_PROMPT = `You are the reasoning and command planner for a browser voice assistant named Friday.
Return ONLY compact JSON with this schema:
{
  "action": "answer|open_url|search_google|search_youtube|play_song|set_timer|start_stopwatch|stop_stopwatch|reset_stopwatch|sleep|wake|none",
  "responseText": "assistant message",
  "query": "optional search query or song name",
  "url": "optional full URL",
  "seconds": 0
}
Rules:
- Prefer deterministic action values from schema.
- If user asks to open a known website, use open_url with full URL.
- For timer durations convert to seconds in 'seconds'.
- For pure knowledge questions use action='answer'.
- Keep responseText concise and helpful.
- Never include markdown fences.`;

function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
}

function log(message) {
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.prepend(li);
}

function sanitize(text) {
  return text.toLowerCase().replace(/[.,!?]/g, "").trim();
}

function rememberConversation(role, text) {
  state.history.push({ role, text, at: Date.now() });
  if (state.history.length > 20) {
    state.history = state.history.slice(-20);
  }
}

function getLastConversations(limit = 3) {
  return state.history.slice(-limit * 2);
}

function speak(text) {
  if (!text) return;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  state.speaking = true;
  state.lastSpoken = sanitize(text);
  state.lastSpokenAt = Date.now();

  safelyStopRecognition();

  utterance.onstart = () => setStatus("speaking");
  utterance.onend = () => {
    state.speaking = false;
    setStatus(state.awake ? "awake and listening" : "sleeping (wake word only)");
    if (state.shouldListen) {
      setTimeout(safelyStartRecognition, 350);
    }
  };

  window.speechSynthesis.speak(utterance);
}

function commandIsDuplicate(command) {
  const now = Date.now();
  const isDuplicate =
    state.duplicateGuard.command === command && now - state.duplicateGuard.at < 2200;

  state.duplicateGuard.command = command;
  state.duplicateGuard.at = now;
  return isDuplicate;
}

function likelySelfEcho(input) {
  if (!state.lastSpoken || Date.now() - state.lastSpokenAt > 6000) return false;
  return input.includes(state.lastSpoken) || state.lastSpoken.includes(input);
}

function safelyStartRecognition() {
  if (!state.recognition || state.recognitionRunning || state.speaking) return;
  try {
    state.recognition.start();
    state.recognitionRunning = true;
  } catch {
    // Ignore intermittent start collisions.
  }
}

function safelyStopRecognition() {
  if (!state.recognition || !state.recognitionRunning) return;
  try {
    state.recognition.stop();
  } catch {
    // Ignore when recognition already ended.
  }
}

function normalizeDurationSeconds(text) {
  const secMatch = text.match(/(\d+)\s*(second|seconds|sec)/);
  const minMatch = text.match(/(\d+)\s*(minute|minutes|min)/);
  const hourMatch = text.match(/(\d+)\s*(hour|hours)/);
  let total = 0;
  if (hourMatch) total += Number(hourMatch[1]) * 3600;
  if (minMatch) total += Number(minMatch[1]) * 60;
  if (secMatch) total += Number(secMatch[1]);
  return total;
}

function openUrl(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function searchGoogle(query) {
  openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

function searchYouTube(query) {
  openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
}

function setTimer(seconds) {
  if (!seconds || Number.isNaN(seconds) || seconds <= 0) {
    speak("Please provide a valid timer duration.");
    return;
  }

  clearTimeout(state.timerId);
  state.timerId = setTimeout(() => {
    speak(`Timer finished for ${seconds} seconds.`);
    log(`⏱️ Timer completed (${seconds}s).`);
  }, seconds * 1000);

  speak(`Timer set for ${seconds} seconds.`);
  log(`⏱️ Timer set (${seconds}s).`);
}

function getStopwatchSeconds() {
  if (!state.stopwatch.running) return Math.floor(state.stopwatch.elapsedBeforeStart / 1000);
  return Math.floor((Date.now() - state.stopwatch.startedAt + state.stopwatch.elapsedBeforeStart) / 1000);
}

function startStopwatch() {
  if (state.stopwatch.running) {
    speak("Stopwatch is already running.");
    return;
  }
  state.stopwatch.running = true;
  state.stopwatch.startedAt = Date.now();
  speak("Stopwatch started.");
}

function stopStopwatch() {
  if (!state.stopwatch.running) {
    speak("Stopwatch is not running.");
    return;
  }
  state.stopwatch.elapsedBeforeStart += Date.now() - state.stopwatch.startedAt;
  state.stopwatch.running = false;
  const seconds = getStopwatchSeconds();
  speak(`Stopwatch stopped at ${seconds} seconds.`);
}

function resetStopwatch() {
  state.stopwatch.running = false;
  state.stopwatch.startedAt = 0;
  state.stopwatch.elapsedBeforeStart = 0;
  speak("Stopwatch reset.");
}

function sleep() {
  state.awake = false;
  speak("Going to sleep. Say Friday when you need me.");
}

function wake() {
  if (state.awake) {
    speak("I am already awake.");
    return;
  }
  state.awake = true;
  speak("I am awake and listening.");
}

function executeAction(action) {
  switch (action.action) {
    case "open_url":
      if (action.url) openUrl(action.url);
      speak(action.responseText || "Opening website.");
      break;
    case "search_google":
      if (action.query) searchGoogle(action.query);
      speak(action.responseText || `Searching Google for ${action.query}.`);
      break;
    case "search_youtube":
      if (action.query) searchYouTube(action.query);
      speak(action.responseText || `Searching YouTube for ${action.query}.`);
      break;
    case "play_song":
      if (action.query) searchYouTube(`${action.query} official audio`);
      speak(action.responseText || `Playing ${action.query}.`);
      break;
    case "set_timer":
      setTimer(Number(action.seconds));
      break;
    case "start_stopwatch":
      startStopwatch();
      break;
    case "stop_stopwatch":
      stopStopwatch();
      break;
    case "reset_stopwatch":
      resetStopwatch();
      break;
    case "sleep":
      sleep();
      break;
    case "wake":
      wake();
      break;
    case "answer":
      speak(action.responseText || "Done.");
      break;
    default:
      if (action.responseText) speak(action.responseText);
  }
}

async function askGemini(userText) {
  const apiKey = apiKeyEl.value.trim();
  if (!apiKey) {
    speak("Please add your Google AI Studio API key first.");
    return null;
  }

  const lastConvos = getLastConversations(3)
    .map((x) => `${x.role}: ${x.text}`)
    .join("\n");

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Conversation context:\n${lastConvos || "(none)"}\n\nUser command: ${userText}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  let data = null;
  let lastError = "";

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      data = await res.json();
      break;
    }

    const errText = await res.text();
    lastError = `[${model}] ${res.status} ${errText}`;
    console.error("Gemini API error", { model, status: res.status, body: errText });
  }

  if (!data) {
    throw new Error(`Gemini request failed: ${lastError}`);
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join("\n")
      .trim() || "";

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

async function processWithAI(rawCommand) {
  try {
    const action = await askGemini(rawCommand);
    if (!action) return;
    log(`AI action: ${JSON.stringify(action)}`);
    executeAction(action);
    if (action.responseText) rememberConversation("assistant", action.responseText);
  } catch (error) {
    log(`AI error: ${error.message}`);
    speak("I could not process that via AI. Please try again.");
  }
}

function processLocalCommand(raw, normalized) {
  if (normalized === "friday") {
    wake();
    return true;
  }

  if (!state.awake) {
    log("Ignored command while asleep.");
    return true;
  }

  if (normalized.includes("go to sleep") || normalized === "sleep mode") {
    sleep();
    return true;
  }

  if (normalized.startsWith("open youtube")) {
    openUrl("https://youtube.com");
    speak("Opening YouTube.");
    return true;
  }

  if (normalized.startsWith("open google")) {
    openUrl("https://google.com");
    speak("Opening Google.");
    return true;
  }

  const openWebsiteMatch = normalized.match(/^open website (.+)$/);
  if (openWebsiteMatch) {
    let website = openWebsiteMatch[1].trim();
    if (!website.startsWith("http")) website = `https://${website}`;
    openUrl(website);
    speak(`Opening ${website}.`);
    return true;
  }

  const ytSearchMatch = normalized.match(/^(search youtube for|youtube search) (.+)$/);
  if (ytSearchMatch) {
    searchYouTube(ytSearchMatch[2]);
    speak(`Searching YouTube for ${ytSearchMatch[2]}.`);
    return true;
  }

  const gSearchMatch = normalized.match(/^(search google for|google search) (.+)$/);
  if (gSearchMatch) {
    searchGoogle(gSearchMatch[2]);
    speak(`Searching Google for ${gSearchMatch[2]}.`);
    return true;
  }

  const songMatch = normalized.match(/^(play song|play) (.+)$/);
  if (songMatch) {
    searchYouTube(`${songMatch[2]} official audio`);
    speak(`Playing ${songMatch[2]}.`);
    return true;
  }

  if (normalized.startsWith("set timer")) {
    const seconds = normalizeDurationSeconds(normalized);
    setTimer(seconds);
    return true;
  }

  if (normalized === "start stopwatch") {
    startStopwatch();
    return true;
  }

  if (normalized === "stop stopwatch") {
    stopStopwatch();
    return true;
  }

  if (normalized === "reset stopwatch") {
    resetStopwatch();
    return true;
  }

  if (normalized === "stopwatch status") {
    speak(`Stopwatch is at ${getStopwatchSeconds()} seconds.`);
    return true;
  }

  if (normalized === "what time is it") {
    speak(`It is ${new Date().toLocaleTimeString()}.`);
    return true;
  }

  return false;
}

async function onTranscript(transcript) {
  const normalized = sanitize(transcript);
  if (!normalized) return;

  if (likelySelfEcho(normalized)) {
    log(`Skipped likely self-echo: "${normalized}"`);
    return;
  }

  if (commandIsDuplicate(normalized)) {
    log(`Skipped duplicate command: "${normalized}"`);
    return;
  }

  log(`User: ${transcript}`);
  rememberConversation("user", transcript);

  const aiPrefix = "database ";
  if (normalized.startsWith(aiPrefix)) {
    const aiCommand = transcript.slice(aiPrefix.length).trim();
    await processWithAI(aiCommand);
    return;
  }

  const locallyHandled = processLocalCommand(transcript, normalized);

  if (!locallyHandled && state.awake) {
    await processWithAI(transcript);
  }
}

function initRecognition() {
  if (!SpeechRecognition) {
    setStatus("Speech recognition is not supported in this browser.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.recognitionRunning = true;
    setStatus(state.awake ? "awake and listening" : "sleeping (wake word only)");
  };

  recognition.onend = () => {
    state.recognitionRunning = false;
    if (state.shouldListen && !state.speaking) {
      setTimeout(safelyStartRecognition, 250);
    }
  };

  recognition.onerror = (event) => {
    log(`Recognition error: ${event.error}`);
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const transcript = result[0].transcript.trim();
      onTranscript(transcript);
    }
  };

  state.recognition = recognition;
}

startBtn.addEventListener("click", () => {
  state.shouldListen = true;
  safelyStartRecognition();
  speak("Friday initialized. Say Friday to wake me up.");
});

stopBtn.addEventListener("click", () => {
  state.shouldListen = false;
  safelyStopRecognition();
  window.speechSynthesis.cancel();
  state.speaking = false;
  setStatus("stopped");
});

clearBtn.addEventListener("click", () => {
  logEl.innerHTML = "";
});

apiKeyEl.addEventListener("input", () => {
  localStorage.setItem("friday_api_key", apiKeyEl.value);
});

(function boot() {
  apiKeyEl.value =
    localStorage.getItem("friday_api_key") ||
    "AIzaSyBQ1K6o4z6pEIcI4LC1lF236vIBt7iNy5g";
  initRecognition();
  setStatus("ready");
  log("Ready. Press Start Listening.");
})();
