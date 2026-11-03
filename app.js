import * as THREE from "three";
import { MindARThree } from "mindar-image-three";

const $ = (id) => document.getElementById(id);
const startButton = $("startButton");
const soundButton = $("soundButton");
const sizeProfile = $("sizeProfile");
const container = $("ar-container");
const welcome = $("welcome");
const status = $("status");
const controls = $("controls");
const video = $("arVideo");
const diagnostic = $("diagnostic");

const TRACKING_LOSS_GRACE_MS = 1600;
const VIDEO_CLEARANCE = 0.025;
const ORIENTATION_SMOOTHING = 0.12;

// User estimates: poster QR 5–6 cm (midpoint 5.5 cm),
// standalone QR 7–8 cm (midpoint 7.5 cm).
// Keep the AR panel about 7 cm wide in the real world for either print size.
const DESIRED_VIDEO_WIDTH_CM = 7;
const SIZE_PROFILES = {
  poster: { qrWidthCm: 5.5, label: "poster QR (about 5–6 cm)" },
  standalone: { qrWidthCm: 7.5, label: "standalone QR (about 7–8 cm)" }
};

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
let selectedProfile = SIZE_PROFILES.poster;
let videoWidthUnits = DESIRED_VIDEO_WIDTH_CM / selectedProfile.qrWidthCm;
let videoHeightUnits = videoWidthUnits * (16 / 9);

let latestOrientation = null;
let panelQuaternionInitialized = false;
const panelQuaternion = new THREE.Quaternion();

const euler = new THREE.Euler();
const qEuler = new THREE.Quaternion();
const qScreen = new THREE.Quaternion();
const qDeviceToWorld = new THREE.Quaternion();
const qWorldToDevice = new THREE.Quaternion();
const qCameraToWorld = new THREE.Quaternion();
const qWorldToAnchor = new THREE.Quaternion();
const qAnchorToWorld = new THREE.Quaternion();

const gravityWorld = new THREE.Vector3(0, -1, 0);
const gravityDevice = new THREE.Vector3();
const gravityCamera = new THREE.Vector3();
const gravityAnchor = new THREE.Vector3();
const upAnchor = new THREE.Vector3();
const panelNormalAnchor = new THREE.Vector3();
const panelRightAnchor = new THREE.Vector3();
const cameraPositionWorld = new THREE.Vector3();
const cameraPositionAnchor = new THREE.Vector3();
const anchorOriginWorld = new THREE.Vector3();
const basis = new THREE.Matrix4();
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);

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

function onDeviceOrientation(event) {
  if (event.beta == null || event.gamma == null) return;
  latestOrientation = {
    alpha: Number(event.alpha || 0),
    beta: Number(event.beta),
    gamma: Number(event.gamma)
  };
}

function startOrientationSensor() {
  window.addEventListener("deviceorientation", onDeviceOrientation, true);
  window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
}

async function requestOrientationPermissionIfNeeded() {
  if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== "granted") {
      throw new Error("Motion/orientation permission was not granted. Allow motion access and try again.");
    }
  }
}

/*
 * DeviceOrientation API -> device/camera gravity.
 * Uses the DeviceOrientationControls axis convention. Only gravity is used;
 * compass heading (alpha) does not determine the panel's upright direction.
 */
function readGravityInCamera() {
  if (!latestOrientation) return false;

  const deg = Math.PI / 180;
  const { alpha, beta, gamma } = latestOrientation;

  euler.set(beta * deg, alpha * deg, -gamma * deg, "YXZ");
  qEuler.setFromEuler(euler);

  const angle = (screen.orientation && Number.isFinite(screen.orientation.angle))
    ? screen.orientation.angle
    : (Number(window.orientation) || 0);
  qScreen.setFromAxisAngle(axisZ, -angle * deg);

  // Rear camera optical frame relative to the device frame.
  const qCameraMount = new THREE.Quaternion().setFromAxisAngle(axisX, -Math.PI / 2);
  qDeviceToWorld.copy(qCameraMount).multiply(qEuler).multiply(qScreen).normalize();
  qWorldToDevice.copy(qDeviceToWorld).invert();

  gravityDevice.copy(gravityWorld).applyQuaternion(qWorldToDevice).normalize();
  // MindAR's Three camera uses the camera coordinate frame for its pose.
  gravityCamera.copy(gravityDevice);
  return true;
}

function updateFloatingPanelPose() {
  if (!videoPlane || !anchor || !mindarThree || !targetVisible) return;

  const hasSensor = readGravityInCamera();

  if (hasSensor) {
    // Convert camera-frame gravity into world space, then into target space.
    mindarThree.camera.getWorldQuaternion(qCameraToWorld);
    gravityAnchor.copy(gravityCamera).applyQuaternion(qCameraToWorld).normalize();

    anchor.group.getWorldQuaternion(qAnchorToWorld);
    qWorldToAnchor.copy(qAnchorToWorld).invert();
    gravityAnchor.applyQuaternion(qWorldToAnchor).normalize();

    // Up points opposite gravity.
    upAnchor.copy(gravityAnchor).negate().normalize();
  } else {
    // Fallback: assume the target image's top edge is physically upright.
    // This is stable, but cannot infer whether the target is lying flat.
    upAnchor.copy(axisY);
  }

  // Face the camera while keeping the panel's Y axis aligned with gravity.
  mindarThree.camera.getWorldPosition(cameraPositionWorld);
  anchor.group.getWorldPosition(anchorOriginWorld);
  cameraPositionAnchor.copy(cameraPositionWorld);
  anchor.group.worldToLocal(cameraPositionAnchor);

  // Camera direction from target origin in target-local coordinates.
  panelNormalAnchor.copy(cameraPositionAnchor).normalize();

  // Project viewing direction perpendicular to the physical up vector.
  panelNormalAnchor.addScaledVector(upAnchor, -panelNormalAnchor.dot(upAnchor));

  if (panelNormalAnchor.lengthSq() < 0.0001) {
    // Near-overhead view: use target normal as deterministic fallback.
    panelNormalAnchor.copy(axisZ);
    panelNormalAnchor.addScaledVector(upAnchor, -panelNormalAnchor.dot(upAnchor));
  }
  if (panelNormalAnchor.lengthSq() < 0.0001) {
    panelNormalAnchor.copy(axisX);
    panelNormalAnchor.addScaledVector(upAnchor, -panelNormalAnchor.dot(upAnchor));
  }
  panelNormalAnchor.normalize();

  // Right-handed panel basis: X = right, Y = physical up, Z = toward camera.
  panelRightAnchor.crossVectors(upAnchor, panelNormalAnchor).normalize();
  panelNormalAnchor.crossVectors(panelRightAnchor, upAnchor).normalize();
  basis.makeBasis(panelRightAnchor, upAnchor, panelNormalAnchor);

  const desired = new THREE.Quaternion().setFromRotationMatrix(basis);
  if (!panelQuaternionInitialized) {
    panelQuaternion.copy(desired);
    panelQuaternionInitialized = true;
  } else {
    panelQuaternion.slerp(desired, ORIENTATION_SMOOTHING);
  }
  videoPlane.quaternion.copy(panelQuaternion);

  // CRITICAL POSITION FIX:
  // Move the panel centre along physical UP by half its height, then slightly
  // toward the camera. This makes it stand above a flat QR and outward from
  // a vertically held QR. Do not offset along the target's fixed Z axis.
  videoPlane.position.copy(upAnchor).multiplyScalar(videoHeightUnits / 2);
  videoPlane.position.addScaledVector(panelNormalAnchor, VIDEO_CLEARANCE);
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

if (!startButton || !soundButton || !sizeProfile || !container || !welcome ||
    !status || !controls || !video || !diagnostic) {
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

  selectedProfile = SIZE_PROFILES[sizeProfile.value] || SIZE_PROFILES.poster;
  videoWidthUnits = DESIRED_VIDEO_WIDTH_CM / selectedProfile.qrWidthCm;
  videoHeightUnits = videoWidthUnits * (16 / 9);

  startButton.disabled = true;
  startButton.textContent = "Starting camera...";
  diagnostic.style.display = "none";
  container.style.display = "block";

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera access is unavailable. Open the HTTPS GitHub Pages address in Chrome.");
    }

    await requestOrientationPermissionIfNeeded();
    startOrientationSensor();

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

    const geometry = new THREE.PlaneGeometry(videoWidthUnits, videoHeightUnits);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });

    videoPlane = new THREE.Mesh(geometry, material);
    videoPlane.visible = false;
    anchor.group.add(videoPlane);

    anchor.onTargetFound = () => {
      const isFreshDetection = !targetVisible;
      targetVisible = true;
      clearLossTimer();
      anchor.group.visible = true;

      if (videoPlaying) {
        setVideoPlaneVisible(true);
        status.textContent = "✨ Your greeting is following the invitation.";
        return;
      }

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

      status.textContent = "✨ Keeping the last floating position briefly...";
      clearLossTimer();
      lossTimer = window.setTimeout(() => {
        lossTimer = null;
        if (videoPlaying && !targetVisible) {
          setVideoPlaneVisible(false);
          status.textContent = "✨ Greeting continues. Point at the invitation to bring back the floating video.";
        }
      }, TRACKING_LOSS_GRACE_MS);
    };

    status.style.display = "block";
    status.textContent = "Requesting camera access...";
    await mindarThree.start();

    renderer.setAnimationLoop(() => {
      if (targetVisible && videoPlaying) updateFloatingPanelPose();
      renderer.render(scene, camera);
    });

    welcome.style.display = "none";
    controls.style.display = "block";
    status.textContent = `Point at the ${selectedProfile.label} to start.`;
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

console.info("Diwali AR adaptive-size, gravity-oriented hybrid app loaded.");
