import * as THREE from "three";
import { MindARThree } from "mindar-image-three";

const startButton = document.getElementById("startButton");

const soundButton = document.getElementById("soundButton");

const container = document.getElementById("ar-container");

const welcome = document.getElementById("welcome");

const status = document.getElementById("status");

const controls = document.getElementById("controls");

const video = document.getElementById("arVideo");

let mindarThree;
let videoPlane;

let videoPlaying = false;
let videoFinished = false;
let targetVisible = false;
let needsFreshDetection = false;
let soundEnabled = false;

// Start AR experience
startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  startButton.textContent = "Starting camera...";

  try {
    container.style.display = "block";

    // Initialize MindAR
    mindarThree = new MindARThree({
      container: container,
      imageTargetSrc: "./target.mind",
      maxTrack: 1,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
    });

    const { renderer, scene, camera } = mindarThree;

    // Create image tracking anchor
    const anchor = mindarThree.addAnchor(0);

    // Prepare video texture
    const texture = new THREE.VideoTexture(video);

    texture.colorSpace = THREE.SRGBColorSpace;

    // Vertical 9:16 video plane
    const geometry = new THREE.PlaneGeometry(0.5625, 1);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });

    videoPlane = new THREE.Mesh(geometry, material);

    // Position video above the invitation
    videoPlane.position.set(0, 0.85, 0.05);

    videoPlane.visible = false;

    anchor.group.add(videoPlane);

    // Start video playback
    async function playGreeting() {
      video.currentTime = 0;

      videoPlane.visible = true;

      videoPlaying = true;
      videoFinished = false;
      needsFreshDetection = false;

      status.textContent = "✨ Your Diwali greeting is playing!";

      try {
        await video.play();
      } catch (error) {
        console.error("Video playback failed:", error);

        videoPlaying = false;
        videoPlane.visible = false;

        status.textContent = "Video could not play. Please try again.";
      }
    }

    // When target is detected
    anchor.onTargetFound = () => {
      targetVisible = true;

      // Retain visibility after reacquisition
      anchor.group.visible = true;

      if (!videoPlaying && !videoFinished) {
        playGreeting();
      }

      // Replay only after a fresh scan following completion
      else if (videoFinished && needsFreshDetection) {
        playGreeting();
      }
    };

    // When target disappears from camera
    anchor.onTargetLost = () => {
      targetVisible = false;

      // Keep last rendered pose while video plays
      anchor.group.visible = true;

      if (videoFinished) {
        needsFreshDetection = true;
      }

      status.textContent = videoPlaying
        ? "✨ Enjoy your Diwali greeting!"
        : "Point camera at the invitation again";
    };

    // When video completes
    video.addEventListener("ended", () => {
      videoPlaying = false;
      videoFinished = true;

      videoPlane.visible = false;

      needsFreshDetection = !targetVisible;

      status.textContent =
        "🪔 Greeting completed! Scan the invitation again to replay.";
    });

    // Start camera
    await mindarThree.start();

    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
    });

    welcome.style.display = "none";

    status.style.display = "block";
    controls.style.display = "block";

    status.textContent = "Point your camera at the invitation";
  } catch (error) {
    console.error(error);

    alert(
      "Unable to start AR. Check camera permission and internet connection."
    );

    container.style.display = "none";

    startButton.disabled = false;
    startButton.textContent = "Try Again";
  }
});

// Enable or disable audio
soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;

  video.muted = !soundEnabled;

  soundButton.textContent = soundEnabled ? "🔇 Mute Sound" : "🔊 Enable Sound";
});
