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

let mindarThree;
let videoPlane;
let videoPlaying = false;
let videoFinished = false;
let targetVisible = false;
let needsFreshDetection = false;
let soundEnabled = false;
let started = false;

function showError(message) {
  diagnostic.style.display = "block";
  diagnostic.textContent = message;
  status.style.display = "block";
  status.textContent = "AR could not start. See the error message below.";
  startButton.disabled = false;
  startButton.textContent = "Try Again";
}

if (!startButton || !soundButton || !container || !welcome || !status || !controls || !video) {
  throw new Error("A required page element is missing. Check that the latest index.html was uploaded.");
}

startButton.addEventListener("click", async () => {
  if (started) return;
  started = true;
  startButton.disabled = true;
  startButton.textContent = "Starting camera...";
  diagnostic.style.display = "none";
  container.style.display = "block";

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera access is unavailable. Open this website using its HTTPS GitHub Pages address in Chrome.");
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
    const anchor = mindarThree.addAnchor(0);

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.PlaneGeometry(0.5625, 1);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });

    videoPlane = new THREE.Mesh(geometry, material);
    videoPlane.position.set(0, 0.85, 0.05);
    videoPlane.visible = false;
    anchor.group.add(videoPlane);

    async function playGreeting() {
      try {
        video.currentTime = 0;
        videoPlane.visible = true;
        videoPlaying = true;
        videoFinished = false;
        needsFreshDetection = false;
        status.textContent = "✨ Your Diwali greeting is playing!";
        await video.play();
      } catch (error) {
        console.error("Video playback failed:", error);
        videoPlaying = false;
        videoPlane.visible = false;
        status.textContent = "Video could not play. Check that diwali.mp4 is uploaded.";
        showError("Video playback error: " + error.message);
      }
    }

    anchor.onTargetFound = () => {
      targetVisible = true;
      anchor.group.visible = true;
      if (!videoPlaying && !videoFinished) {
        void playGreeting();
      } else if (videoFinished && needsFreshDetection) {
        void playGreeting();
      }
    };

    anchor.onTargetLost = () => {
      targetVisible = false;
      // Keep the last tracked pose visible while the greeting is playing.
      anchor.group.visible = true;
      if (videoFinished) needsFreshDetection = true;
      status.textContent = videoPlaying
        ? "✨ Enjoy your Diwali greeting!"
        : "Point camera at the invitation again";
    };

    video.addEventListener("ended", () => {
      videoPlaying = false;
      videoFinished = true;
      videoPlane.visible = false;
      needsFreshDetection = !targetVisible;
      status.textContent = "🪔 Greeting completed! Scan the invitation again to replay.";
    });

    status.style.display = "block";
    status.textContent = "Requesting camera access...";
    await mindarThree.start();

    renderer.setAnimationLoop(() => renderer.render(scene, camera));
    welcome.style.display = "none";
    controls.style.display = "block";
    status.textContent = "Point your camera at the invitation";
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

soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  video.muted = !soundEnabled;
  soundButton.textContent = soundEnabled ? "🔇 Mute Sound" : "🔊 Enable Sound";
});

// Let the user know the module loaded successfully.
console.info("Diwali AR app.js loaded successfully.");
