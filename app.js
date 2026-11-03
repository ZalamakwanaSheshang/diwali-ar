import * as THREE from "three";
import { MindARThree } from "mindar-image-three";

const $ = (id) => document.getElementById(id);
const startButton = $("startButton");
const soundButton = $("soundButton");
const container = $("ar-container");
const welcome = $("welcome");
const status = $("status");
const controls = $("controls");
const video = $("arVideo");
const diagnostic = $("diagnostic");

const TRACKING_LOSS_GRACE_MS = 1600;

// Position and size are in MindAR target coordinates.
// The target image width is normalized to approximately 1 unit.
const VIDEO_WIDTH = 0.34;
const VIDEO_HEIGHT = VIDEO_WIDTH * (16 / 9);
const VIDEO_LIFT = 0.42;
const VIDEO_DEPTH = 0.035;

let mindarThree;
let anchor;
let videoPlane;
let videoPlaying = false;
let videoFinished = false;
let targetVisible = false;
let waitingForFreshScan = false;
let lossTimer = null;
let soundEnabled = true;
let started = false;

function showError(message) {
  diagnostic.style.display = "block";
  diagnostic.textContent = message;
  status.style.display = "block";
  status.textContent = "AR could not start. See the error below.";
  startButton.disabled = false;
  startButton.textContent = "Try Again";
}

function clearLossTimer() {
  if (lossTimer !== null) {
    window.clearTimeout(lossTimer);
    lossTimer = null;
  }
}

function setVideoPlaneVisible(visible) {
  if (videoPlane) videoPlane.visible = visible;
}

async function playGreeting() {
  if (videoPlaying) return;

  clearLossTimer();
  video.currentTime = 0;
  videoFinished = false;
  waitingForFreshScan = false;
  videoPlaying = true;
  setVideoPlaneVisible(true);
  status.textContent = "✨ Your Diwali greeting is floating above the invitation!";

  // Try audio-on first. Mobile browsers may reject audible playback;
  // if rejected, play muted and let the guest enable sound with one tap.
  video.muted = !soundEnabled;
  try {
    await video.play();
    soundButton.textContent = video.muted ? "🔊 Enable Sound" : "🔇 Mute Sound";
  } catch (error) {
    console.warn("Audible autoplay blocked; retrying muted.", error);
    soundEnabled = false;
    video.muted = true;
    soundButton.textContent = "🔊 Enable Sound";
    try {
      await video.play();
      status.textContent = "✨ Greeting is playing. Tap Enable Sound for audio.";
    } catch (mutedError) {
      videoPlaying = false;
      setVideoPlaneVisible(false);
      showError("Video playback failed: " + mutedError.message);
    }
  }
}

if (!startButton || !soundButton || !container || !welcome || !status || !controls || !video || !diagnostic) {
  throw new Error("A required page element is missing. Check index.html.");
}

video.muted = true;
video.addEventListener("ended", () => {
  videoPlaying = false;
  videoFinished = true;
  setVideoPlaneVisible(false);
  clearLossTimer();
  waitingForFreshScan = true;
  status.textContent = "🪔 Greeting completed. Point at the invitation again to replay.";
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

    const { renderer, scene, camera } = mindarThree;
    anchor = mindarThree.addAnchor(0);

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;

    // A portrait video plane rotated upright from the flat image-target plane.
    // It is spatially attached while tracking works, not screen-fixed.
    const geometry = new THREE.PlaneGeometry(VIDEO_WIDTH, VIDEO_HEIGHT);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: false
    });

    videoPlane = new THREE.Mesh(geometry, material);
    videoPlane.rotation.x = -Math.PI / 2;
    videoPlane.position.set(0, VIDEO_LIFT, VIDEO_DEPTH);
    videoPlane.visible = false;
    anchor.group.add(videoPlane);

    anchor.onTargetFound = () => {
      const isFreshDetection = !targetVisible;
      targetVisible = true;
      clearLossTimer();

      // Restore the target's tracked pose and the floating plane.
      anchor.group.visible = true;

      if (videoPlaying) {
        setVideoPlaneVisible(true);
        status.textContent = "✨ Your greeting is following the invitation.";
        return;
      }

      // Initial detection starts playback. After completion, a new
      // loss-then-reacquisition is required before replay.
      if (!videoFinished) {
        void playGreeting();
      } else if (waitingForFreshScan && isFreshDetection) {
        void playGreeting();
      }
    };

    anchor.onTargetLost = () => {
      targetVisible = false;

      if (!videoPlaying) {
        status.textContent = waitingForFreshScan
          ? "Point at the invitation again to replay."
          : "Point camera at the invitation.";
        return;
      }

      // Freeze the last known anchor pose briefly. If tracking returns,
      // onTargetFound cancels this timer and resumes following the target.
      status.textContent = "✨ Keeping the last floating position briefly...";
      clearLossTimer();
      lossTimer = window.setTimeout(() => {
        lossTimer = null;
        if (videoPlaying && !targetVisible) {
          // Continue video/audio, but hide the inaccurate spatial overlay.
          setVideoPlaneVisible(false);
          status.textContent = "✨ Greeting continues. Point at the invitation to bring the floating video back.";
        }
      }, TRACKING_LOSS_GRACE_MS);
    };

    status.style.display = "block";
    status.textContent = "Requesting camera access...";
    await mindarThree.start();

    renderer.setAnimationLoop(() => renderer.render(scene, camera));

    welcome.style.display = "none";
    controls.style.display = "block";
    status.textContent = "Point your camera at the invitation to start.";
  } catch (error) {
    console.error("AR startup failed:", error);
    clearLossTimer();
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

console.info("Diwali AR hybrid tracking app loaded.");
