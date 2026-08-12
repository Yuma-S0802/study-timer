"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  display: $("#timeDisplay"),
  phaseLabel: $("#phaseLabel"),
  progressLabel: $("#progressLabel"),
  status: $("#statusMessage"),
  timerSetup: $("#timerSetup"),
  pomodoroSetup: $("#pomodoroSetup"),
  timerHours: $("#timerHours"),
  timerMinutes: $("#timerMinutes"),
  timerSeconds: $("#timerSeconds"),
  pomodoroSets: $("#pomodoroSets"),
  start: $("#startButton"),
  pause: $("#pauseButton"),
  reset: $("#resetButton"),
  modeTabs: $$(".mode-tab"),
  settings: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  openSettings: $("#openSettings"),
  footerSettings: $("#footerSettings"),
  closeSettings: $("#closeSettings"),
  themeCaption: $("#themeCaption"),
  audio: $("#themeAudio"),
  volume: $("#volumeControl"),
  volumeValue: $("#volumeValue"),
  toast: $("#completionToast"),
};

const THEMES = {
  ocean: {
    label: "Ocean",
    caption: "Ocean — 波音の環境",
    accent: "#89e6dd",
    backgroundTop: "#1a5f87",
    backgroundBottom: "#041b35",
    audio: "assets/ocean.mp3",
  },
  fire: {
    label: "Campfire",
    caption: "Campfire — 焚火の環境",
    accent: "#ffcd8e",
    backgroundTop: "#4c2935",
    backgroundBottom: "#130d1c",
    audio: "assets/campfire.mp3",
  },
  forest: {
    label: "Forest",
    caption: "Forest — 雨音の環境",
    accent: "#c8edab",
    backgroundTop: "#4d7964",
    backgroundBottom: "#082a30",
    audio: "assets/forest.mp3",
  },
};

const FOCUS_MS = 30 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const STORAGE_KEY = "focus-flow-settings-v2";

let savedSettings = loadSettings();
let state = {
  mode: "timer",
  status: "idle",
  remainingMs: 25 * 60 * 1000,
  elapsedMs: 0,
  deadline: 0,
  startedAt: 0,
  intervalId: null,
  pomodoro: { phase: "focus", set: 1 },
};
let toastTimer = null;
let audioContext = null;

function loadSettings() {
  try {
    return { theme: "ocean", volume: 35, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { theme: "ocean", volume: 35 };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSettings));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timerInputMilliseconds() {
  const hours = clamp(elements.timerHours.value, 0, 23);
  const minutes = clamp(elements.timerMinutes.value, 0, 59);
  const seconds = clamp(elements.timerSeconds.value, 0, 59);
  elements.timerHours.value = hours;
  elements.timerMinutes.value = minutes;
  elements.timerSeconds.value = seconds;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function pomodoroSetCount() {
  const sets = clamp(elements.pomodoroSets.value, 1, 12);
  elements.pomodoroSets.value = sets;
  return sets;
}

function currentTheme() {
  return THEMES[savedSettings.theme];
}

function isFocusSession() {
  return state.mode !== "pomodoro" || state.pomodoro.phase === "focus";
}

function render() {
  if (state.mode === "stopwatch") {
    elements.display.value = formatTime(state.elapsedMs);
    elements.phaseLabel.textContent = "経過時間";
    elements.progressLabel.textContent = state.status === "running" ? "作業中…" : state.status === "paused" ? "一時停止中…" : "経過時間を計測します。";
  } else if (state.mode === "pomodoro") {
    elements.display.value = formatTime(state.remainingMs);
    elements.phaseLabel.textContent = state.pomodoro.phase === "focus" ? "作業時間" : "休憩時間";
    elements.progressLabel.textContent = `${state.pomodoro.set} / ${pomodoroSetCount()} セット${state.status === "paused" ? " ・ 一時停止中" : ""}`;
  } else {
    elements.display.value = formatTime(state.remainingMs);
    elements.phaseLabel.textContent = "残り時間";
    elements.progressLabel.textContent = state.status === "running" ? "作業中…" : state.status === "paused" ? "一時停止中…" : "時間を設定して開始してください。";
  }

  elements.start.textContent = state.status === "paused" ? "再開" : state.status === "running" ? "進行中" : state.status === "finished" ? "もう一度" : "開始";
  elements.start.disabled = state.status === "running";
  elements.pause.disabled = state.status !== "running";
  elements.status.textContent = `現在のテーマ：${currentTheme().label}`;
}

function clearTicker() {
  if (state.intervalId) window.clearInterval(state.intervalId);
  state.intervalId = null;
}

function start() {
  if (state.status === "running") return;
  if (state.status === "finished") reset();

  if (state.mode === "timer") {
    if (state.status === "idle") state.remainingMs = timerInputMilliseconds();
    if (state.remainingMs <= 0) {
      showToast("1秒以上の時間を設定してください。");
      return;
    }
    state.deadline = Date.now() + state.remainingMs;
  } else if (state.mode === "stopwatch") {
    state.startedAt = Date.now() - state.elapsedMs;
  } else {
    if (state.status === "idle") {
      state.pomodoro = { phase: "focus", set: 1 };
      state.remainingMs = FOCUS_MS;
    }
    state.deadline = Date.now() + state.remainingMs;
  }

  state.status = "running";
  clearTicker();
  state.intervalId = window.setInterval(tick, 250);
  syncThemeAudio();
  render();
}

function pause() {
  if (state.status !== "running") return;
  if (state.mode === "stopwatch") state.elapsedMs = Date.now() - state.startedAt;
  else state.remainingMs = Math.max(0, state.deadline - Date.now());
  state.status = "paused";
  clearTicker();
  stopThemeAudio();
  render();
}

function reset() {
  clearTicker();
  stopThemeAudio();
  state.status = "idle";
  state.elapsedMs = 0;
  state.pomodoro = { phase: "focus", set: 1 };
  state.remainingMs = state.mode === "timer" ? timerInputMilliseconds() : state.mode === "pomodoro" ? FOCUS_MS : 0;
  render();
}

function tick() {
  if (state.status !== "running") return;

  if (state.mode === "stopwatch") {
    state.elapsedMs = Date.now() - state.startedAt;
    render();
    return;
  }

  state.remainingMs = Math.max(0, state.deadline - Date.now());
  if (state.remainingMs > 0) {
    render();
    return;
  }

  if (state.mode === "timer") finish("タイマーが終了しました。おつかれさまでした。");
  else advancePomodoro();
}

function finish(message) {
  clearTicker();
  state.status = "finished";
  state.remainingMs = 0;
  stopThemeAudio();
  playBell();
  render();
  showToast(message);
  window.setTimeout(() => window.alert(message), 80);
}

function advancePomodoro() {
  if (state.pomodoro.phase === "focus") {
    state.pomodoro.phase = "break";
    state.remainingMs = BREAK_MS;
    state.deadline = Date.now() + BREAK_MS;
    stopThemeAudio();
    playBell();
    showToast("作業時間が終了しました。5分間、休憩しましょう。");
    window.setTimeout(() => window.alert("作業時間が終了しました。休憩を開始します。"), 80);
  } else if (state.pomodoro.set >= pomodoroSetCount()) {
    finish("すべてのポモドーロが終了しました。おつかれさまでした。");
    return;
  } else {
    state.pomodoro.set += 1;
    state.pomodoro.phase = "focus";
    state.remainingMs = FOCUS_MS;
    state.deadline = Date.now() + FOCUS_MS;
    syncThemeAudio();
    playBell();
    showToast("休憩時間が終了しました。次の作業を始めましょう。");
    window.setTimeout(() => window.alert("休憩時間が終了しました。次の作業を開始します。"), 80);
  }
  render();
}

function selectMode(mode) {
  if (mode === state.mode) return;
  clearTicker();
  stopThemeAudio();
  state.mode = mode;
  state.status = "idle";
  state.elapsedMs = 0;
  state.pomodoro = { phase: "focus", set: 1 };
  state.remainingMs = mode === "timer" ? timerInputMilliseconds() : mode === "pomodoro" ? FOCUS_MS : 0;
  elements.timerSetup.classList.toggle("is-hidden", mode !== "timer");
  elements.pomodoroSetup.classList.toggle("is-hidden", mode !== "pomodoro");
  elements.modeTabs.forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  render();
}

function syncThemeAudio() {
  if (state.status === "running" && isFocusSession()) startThemeAudio();
  else stopThemeAudio();
}

function startThemeAudio() {
  const theme = currentTheme();
  if (!elements.audio.src.endsWith(theme.audio)) elements.audio.src = theme.audio;
  elements.audio.volume = savedSettings.volume / 100;
  elements.audio.play().catch(() => showToast("BGMを再生できませんでした。音声ファイルの配置を確認してください。"));
}

function stopThemeAudio() {
  elements.audio.pause();
  elements.audio.currentTime = 0;
}

function playBell() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const now = audioContext.currentTime;
    [659.25, 783.99].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.03 + index * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85 + index * 0.16);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now + index * 0.16);
      oscillator.stop(now + 0.9 + index * 0.16);
    });
  } catch {
    // アラート表示は音声を使えない環境でも継続します。
  }
}

function applyTheme() {
  savedSettings = {
    theme: $("input[name=theme]:checked").value,
    volume: Number(elements.volume.value),
  };
  saveSettings();
  const theme = currentTheme();
  document.documentElement.style.setProperty("--accent", theme.accent);
  document.documentElement.style.setProperty("--background-top", theme.backgroundTop);
  document.documentElement.style.setProperty("--background-bottom", theme.backgroundBottom);
  elements.themeCaption.textContent = theme.caption;
  if (state.status === "running" && isFocusSession()) {
    stopThemeAudio();
    startThemeAudio();
  }
  render();
}

function openSettings() {
  elements.volume.value = savedSettings.volume;
  elements.volumeValue.value = `${savedSettings.volume}%`;
  const selected = $(`input[name="theme"][value="${savedSettings.theme}"]`);
  if (selected) selected.checked = true;
  elements.settings.showModal();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 5500);
}

elements.modeTabs.forEach((button) => button.addEventListener("click", () => selectMode(button.dataset.mode)));
elements.start.addEventListener("click", start);
elements.pause.addEventListener("click", pause);
elements.reset.addEventListener("click", reset);
[elements.timerHours, elements.timerMinutes, elements.timerSeconds].forEach((input) => {
  input.addEventListener("input", () => {
    if (state.mode === "timer" && state.status === "idle") {
      state.remainingMs = timerInputMilliseconds();
      render();
    }
  });
});
elements.pomodoroSets.addEventListener("input", () => {
  if (state.mode === "pomodoro") render();
});
elements.openSettings.addEventListener("click", openSettings);
elements.footerSettings.addEventListener("click", openSettings);
elements.closeSettings.addEventListener("click", () => elements.settings.close());
elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applyTheme();
  elements.settings.close();
  showToast("テーマ設定を保存しました。");
});
elements.volume.addEventListener("input", () => {
  elements.volumeValue.value = `${elements.volume.value}%`;
});
window.addEventListener("beforeunload", stopThemeAudio);

applyTheme();
reset();
