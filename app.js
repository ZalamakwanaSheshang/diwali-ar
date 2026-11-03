import { MindARThree } from "mindar-image-three";

const $ = (id) => document.getElementById(id);
const startButton = $("startButton");
const soundButton = $("soundButton");
const container = $("ar-container");
const welcome = $("welcome");
const status = $("status");
const controls = $("controls");
const videoStage = $("videoStage");
const video = $("arVideo");
const diagnostic = $("diagnostic");

let mindarThree;
let started = false;
let targetVisible = false;
let hasPlayedOnce = false;
let waitingForRescan = false;
let videoPlaying = false;
let soundEnabled = true;

function showError(message) {
  diagnostic.style.display = "block";
  diagnostic.textContent = message;
  status.style.display = "block";
  status.textContent = "AR could not start. See the error below.";
  startButton.disabled = false;
  startButton.textContent = "Try Again";
}

function showVideo() {
  videoStage.classList.add("visible");
}

function hideVideo() {
  videoStage.classList.remove("visible");
}

async function playGreeting() {
  if (videoPlaying) return;

  videoPlaying = true;
  waitingForRescan = false;
  hasPlayedOnce = true;
  video.currentTime = 0;
  showVideo();
  status.textContent = "✨ Your Diwali greeting is playing!";

  // Try sound-on first. Mobile browsers may reject audible autoplay even
  // after camera permission; in that case start muted and expose the sound button.
  video.muted = !soundEnabled;

  try {
    await video.play();
    if (video.muted) {
      soundButton.textContent = "🔊 Enable Sound";
      status.textContent = "✨ Greeting playing. Tap Enable Sound if you want audio.";
    } else {
      soundButton.textContent = "🔇 Mute Sound";
    }
  } catch (error) {
    console.warn("Audible playback was blocked; retrying muted.", error);
    soundEnabled = false;
    video.muted = true;
    soundButton.textContent = "🔊 Enable Sound";
    try {
      await video.play();
      status.textContent = "✨ Greeting playing. Tap Enable Sound for audio.";
    } catch (mutedError) {
      videoPlaying = false;
      hideVideo();
      showError("Video playback failed: " + mutedError.message);
    }
  }
}

if (!startButton || !soundButton || !container || !welcome || !status ||
    !controls || !videoStage || !video || !diagnostic) {
  throw new Error("A required page element is missing. Check index.html.");
}

video.muted = true;
video.addEventListener("ended", () => {
  videoPlaying = false;
  hideVideo();
  waitingForRescan = true;
  status.textContent = "🪔 Greeting finished. Point at the invitation again to replay.";
});

startButton.addEventListener("click", async () => {
  if (started) return;
  started = true;
  startButton.disabled = true;
  startButton.textContent = "Starting camera...";
  diagnostic.style.display = "none";
  container.style.display = "block";

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera access is unavailable. Open this site using its HTTPS GitHub Pages address in Chrome.");
    }

    mindarThree = new MindARThree({
      container,
      imageTargetSrc: "./target.mind",
      maxTrack: 1,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no"
    });

    const anchor = mindarThree.addAnchor(0);

    anchor.onTargetFound = () => {
      const isNewDetection = !targetVisible;
      targetVisible = true;

      // First detection starts the greeting. After it finishes, only a fresh
      // loss-and-reacquisition cycle can replay it.
      if (!videoPlaying && (!hasPlayedOnce || (waitingForRescan && isNewDetection))) {
        void playGreeting();
      }
      status.textContent = videoPlaying
        ? "✨ Your Diwali greeting is playing!"
        : "Invitation detected.";
    };

    anchor.onTargetLost = () => {
      targetVisible = false;
      if (!videoPlaying && waitingForRescan) {
        status.textContent = "Point at the invitation again to replay.";
      }
      // The video is a screen-fixed overlay, not attached to the target.
      // It therefore remains visible while the phone moves anywhere.
    };

    status.style.display = "block";
    status.textContent = "Requesting camera access...";
    await mindarThree.start();

    mindarThree.renderer.setAnimationLoop(() => {
      mindarThree.renderer.render(mindarThree.scene, mindarThree.camera);
    });

    welcome.style.display = "none";
    controls.style.display = "block";
    status.textContent = "Point your camera at the invitation to start.";
  } catch (error) {
    console.error("AR startup failed:", error);
    try {
      if (mindarThree) await mindarThree.stop();
    } catch (_) {}
    container.style.display = "none";
    started = false;
    showError("AR startup error: " + (error && error.message ? error.message : String(error)));
  }
});

soundButton.addEventListener("click", async () => {
  soundEnabled = !soundEnabled;
  video.muted = !soundEnabled;
  soundButton.textContent = soundEnabled ? "🔇 Mute Sound" : "🔊 Enable Sound";

  if (soundEnabled && videoPlaying) {
    try {
      await video.play();
      status.textContent = "✨ Your Diwali greeting is playing with sound!";
    } catch (error) {
      soundEnabled = false;
      video.muted = true;
      soundButton.textContent = "🔊 Enable Sound";
      status.textContent = "Sound was blocked. Tap Enable Sound again.";
    }
  }
});

console.info("Diwali AR stable-overlay app.js loaded.");
