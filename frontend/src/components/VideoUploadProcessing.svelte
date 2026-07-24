
<script lang="ts">
  function getDrawLandmarks() {
    return (window as any).drawLandmarks;
  }
  function getFaceMeshClass() {
    return (window as any).FaceMesh;
  }
  type Results = any;
  import { onDestroy, onMount } from "svelte";
  import { writable, get } from "svelte/store";
  import { createSession } from "../scripts/session";
  import { userSettings } from '../scripts/settings';

  import {
      applyAffineTransformation,
      calculateAffineTransformation,
  } from "../scripts/affineTransformation";
  import {
      LEFT_EYE_CORNER,
      LEFT_IRIS_CENTER,
      NOSE_TIP,
      RIGHT_EYE_CORNER,
      RIGHT_IRIS_CENTER,
      getLandmarks,
      getNormalizedIrisPosition,
  } from "../scripts/utils";

  import type { Coordinates } from "../scripts/affineTransformation";
  import { applySmoothing } from "../scripts/smoothing";
  import { WebSocketConnection } from "../scripts/websocket";
  // import { number } from "astro:schema";
  // import { ProbabilityGraph } from "../scripts/graph";  // Import the ProbabilityGraph class

  // UI state variables
  let isPlaying = false;
  let videoLoaded = false;
  let isProcessing = false;
  let isLoadingFile = false;

  // Offscreen processing variables
  let videoElement: HTMLVideoElement;
  let processingCanvas: HTMLCanvasElement;
  let offscreenCtx: CanvasRenderingContext2D | null;
  let faceMesh: FaceMesh;
  let animationFrameId: number;

  const canvasWidth = 640;
  const canvasHeight = 480;

  let userId: string | null = null;
  let WEBSOCKET_URL = "ws://localhost:8080/websocket";
  if (typeof window !== "undefined") {
    userId = sessionStorage.getItem("userId");
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "localhost";
    WEBSOCKET_URL = `${wsProto}//${host}:8080/websocket?user_id=${encodeURIComponent(userId || '1')}`;
  }

  let variance: number | null = null;
  let acceleration: number | null = null;
  let probability: number | null = null;

  let ws: WebSocketConnection | null = null;
  // let probabilityGraph: ProbabilityGraph;  // Declare a ProbabilityGraph instance

  let isModalVisible = writable(false);
  let sessionName = "";
  let sessionCreated = false;
  let startTime = new Date().toISOString();
  let initialNoseTip: Coordinates | null = null; // Track the initial nose tip position

  let previousXValues: number[] = [];
  let previousYValues: number[] = [];

  let remainingTime = 0;
  let countdownTimer: number;

  let sensitivity: number | null = null;

   export const shouldShowGraph = writable(false);

   export const minMaxEnabled = writable<boolean>(false);

   let affineTransformEnabled = writable(false);

   let starttime = 0;
   let timestamp = 0;

   let varMaxValue: number | null = 0.0013;
   let accMaxValue: number | null = 10.0;

   // Log the settings whenever they change
   userSettings.subscribe((settings: any) => {
       console.log("User settings:", settings);
       sensitivity = settings.sensitivity;
       affineTransformEnabled.set(settings.affine ?? false);
       minMaxEnabled.set(settings.min_max ?? false);
   });

  
  if (typeof window !== "undefined") {
    if(get(minMaxEnabled)) {
      // Get the values from sessionStorage if minMaxEnabled is true
      const storedVariance = sessionStorage.getItem("variance");
      const storedAcceleration = sessionStorage.getItem("acceleration");

      if (storedVariance) {
        varMaxValue = parseFloat(storedVariance);
      }
      if (storedAcceleration) {
        accMaxValue = parseFloat(storedAcceleration);
      }
    }
    
    const variance = sessionStorage.getItem("variance");
    const acceleration = sessionStorage.getItem("acceleration");

    if (variance) {
      varMaxValue = parseFloat(variance);
    }
    if (acceleration) {
      accMaxValue = parseFloat(acceleration);
    }
  }

  // Create writable stores with the final values
  export const varMax = writable<number | null>(varMaxValue);
  export const accMax = writable<number | null>(accMaxValue);

  function handleWebSocketMessage(data: any) {
    if (
      data.variance !== undefined &&
      data.acceleration !== undefined &&
      data.probability !== undefined
    ) {
      probability = data.probability;
      console.log("Probability:", probability);
    }
  }

  function startWebSocket() {
    if (ws) {
        ws.close();// Ensure previous connection is closed
        ws = null;
    }

    ws = new WebSocketConnection(WEBSOCKET_URL, handleWebSocketMessage);
    console.log("WebSocket initialized:", WEBSOCKET_URL);
    ws.start();
  }

  function processFrame() {
    if (faceMesh && videoElement) {
      faceMesh.send({ image: videoElement });
    }
  }

  // Start the countdown when video metadata is available
  function startCountdown() {
    clearInterval(countdownTimer);
    remainingTime = videoElement.duration;
    countdownTimer = setInterval(() => {
      remainingTime = Math.max(remainingTime - 1, 0);
      if (remainingTime === 0) {
        clearInterval(countdownTimer);
      }
    }, 1000);
  }

  function stopCountdown() {
    clearInterval(countdownTimer);
  }

  onMount(() => {
    // Initialize the probability graph
    // const graphCanvas = document.createElement("canvas");
    // graphCanvas.width = canvasWidth;
    // graphCanvas.height = 200; // Set a fixed height for the graph
    // document.body.appendChild(graphCanvas);
    // probabilityGraph = new ProbabilityGraph(graphCanvas);

    // Create a hidden video element for loading and playback
    videoElement = document.createElement("video");
    videoElement.style.display = "none";
    // Ensure inline playback (especially for mobile)
    videoElement.setAttribute("playsinline", "true");
    document.body.appendChild(videoElement);

    // === IMPORTANT ===
    // This "ended" event closes the modal automatically when the video finishes playing.
    // Instead of automatically ending the session when the video ends,
    // show the modal so the user can input the session name.
    videoElement.onended = () => {
      isModalVisible.set(true);
    };

    // Create a hidden canvas element for processing
    processingCanvas = document.createElement("canvas");
    processingCanvas.width = canvasWidth;
    processingCanvas.height = canvasHeight;
    processingCanvas.style.display = "none";
    document.body.appendChild(processingCanvas);
    offscreenCtx = processingCanvas.getContext("2d");

    // Initialize MediaPipe FaceMesh
    const FaceMeshClass = getFaceMeshClass();
    if (FaceMeshClass) {
      faceMesh = new FaceMeshClass({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
    }
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.43,
      minTrackingConfidence: 0.5,
    });

    if (!offscreenCtx) return;

    // Process results – drawing to the offscreen canvas (not displayed)
    // Inside the onResults function, after drawing landmarks:
    faceMesh.onResults((results: Results) => {
      if (offscreenCtx) {
        offscreenCtx.save();
        offscreenCtx.clearRect(
          0,
          0,
          processingCanvas.width,
          processingCanvas.height,
        );
        offscreenCtx.drawImage(
          results.image,
          0,
          0,
          processingCanvas.width,
          processingCanvas.height,
        );
      }

      if (results.multiFaceLandmarks) {
        for (const landmarks of results.multiFaceLandmarks) {
          if (offscreenCtx) {
            const leftIris = landmarks[LEFT_IRIS_CENTER];
            const rightIris = landmarks[RIGHT_IRIS_CENTER];

            if (leftIris) {
              const lx = leftIris.x * processingCanvas.width;
              const ly = leftIris.y * processingCanvas.height;
              offscreenCtx.beginPath();
              offscreenCtx.arc(lx, ly, 8, 0, 2 * Math.PI);
              offscreenCtx.strokeStyle = "#38bdf8";
              offscreenCtx.lineWidth = 2;
              offscreenCtx.stroke();
            }

            if (rightIris) {
              const rx = rightIris.x * processingCanvas.width;
              const ry = rightIris.y * processingCanvas.height;
              offscreenCtx.beginPath();
              offscreenCtx.arc(rx, ry, 8, 0, 2 * Math.PI);
              offscreenCtx.strokeStyle = "#c084fc";
              offscreenCtx.lineWidth = 2;
              offscreenCtx.stroke();
            }
          }

          timestamp = performance.now() - starttime;

          // Smoothing iris positions
          const { normX, normY } = getNormalizedIrisPosition(
            landmarks,
            processingCanvas.width,
            processingCanvas.height,
            timestamp
          );

          // Apply smoothing to the iris position
          const smoothedNormX = applySmoothing(normX, previousXValues);
          const smoothedNormY = applySmoothing(normY, previousYValues);

          // Track the current nose tip for affine transformation
          const currentNoseTip: Coordinates = getLandmarks(landmarks, [
            NOSE_TIP,
          ])[0];

          if (initialNoseTip && affineTransformEnabled) {
            // Calculate the affine transformation matrix based on initial and current nose tip positions
            const transformationMatrix = calculateAffineTransformation(
              initialNoseTip,
              currentNoseTip,
            );

            // Apply the transformation to all landmarks (using smoothed iris position)
            const transformedLandmarks = landmarks.map((landmark) =>
              applyAffineTransformation(landmark, transformationMatrix),
            );

            // Draw the transformed landmarks on the canvas
            if (offscreenCtx) {
              drawLandmarks(offscreenCtx, transformedLandmarks, {
                color: "#0000FF",
                lineWidth: 2,
              });
            }
          }

          const timestampInSeconds = timestamp / 1000; // Convert timestamp to seconds

          const metrics = {
            x: smoothedNormX,
            y: smoothedNormY,
            time: timestampInSeconds,
            sensitivity: sensitivity ?? 1.0,
            acceleration: get(accMax),
            variance: get(varMax)
          };

          if (ws) {
            ws.sendMessage(metrics);
            console.log("WebSocket Sent:", metrics);
          }
        }
      }
      if (offscreenCtx) {
        offscreenCtx.restore();
      }
    });

    // === Pre-warm mediapipe: perform a dummy send on a blank frame ===
    if (offscreenCtx) {
      // Draw a blank frame (or any minimal dummy content)
      offscreenCtx.fillStyle = "#000";
      offscreenCtx.fillRect(0, 0, canvasWidth, canvasHeight);
      // Send the blank frame. This call will download and compile WASM, create a WebGL context, etc.
      faceMesh
        .send({ image: processingCanvas })
        .catch((error) => console.error("Error during warm-up:", error));
    }

    // Start WebSocket connection
    startWebSocket();
  });

  onDestroy(() => {
    if (videoElement) {
      videoElement.pause();
      videoElement.src = "";
      videoElement.remove();
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  });

  // Process the video frame by frame:
  async function processVideoFrame() {
    // Check immediately: if paused or ended, stop processing.
    if (videoElement.paused || videoElement.ended) {
      isProcessing = false;
      return;
    }
    if (offscreenCtx) {
      offscreenCtx.drawImage(videoElement, 0, 0, canvasWidth, canvasHeight);
    }
    // Check again before processing the frame.
    if (videoElement.paused || videoElement.ended) {
      isProcessing = false;
      return;
    }
    try {
      await faceMesh.send({ image: processingCanvas });
    } catch (error) {
      console.error("Error processing frame:", error);
    }
    // If video got paused while processing, stop here.
    if (videoElement.paused || videoElement.ended) {
      isProcessing = false;
      return;
    }
    animationFrameId = requestAnimationFrame(processVideoFrame);
  }

  // Triggered when a file is selected.
  function handleVideoUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files ? input.files[0] : null;
    if (file) {
      starttime = performance.now();
      const url = URL.createObjectURL(file);
      videoElement.src = url;
      // Start countdown once metadata is available (duration etc.)
      videoElement.onloadedmetadata = () => {
        startCountdown();
      };
      videoElement.onloadeddata = () => {
        // Close the modal automatically when the video is done uploading
        isModalVisible.set(false);
        videoLoaded = true;
        isPlaying = true;
        isProcessing = true;
        videoElement.play();
        processVideoFrame();
      };
    }
  }
  
  async function endSession() {
    try {
        // Close WebSocket if it exists
        if (ws) {
            ws.close();
            ws = null;
            console.log("WebSocket closed before session creation.");
        }

        // Only create session if it hasn't been created already
        if (!sessionCreated) {
            const sessionData = {
                name: sessionName || "Session", // Default name if none provided
                start_time: startTime,
                end_time: new Date().toISOString(),
                var_min: variance ?? 0,
                var_max: variance ?? 0,
                acc_min: acceleration ?? 0,
                acc_max: acceleration ?? 0,
            };

            // Await the session creation process (assuming createSession is an async function)
            await createSession(sessionData);
            sessionCreated = true;
            isModalVisible.set(false);
        }

        // Stop video and reset if video is loaded
        if (videoLoaded) {
            isPlaying = false;
            videoLoaded = false;
            videoElement.pause();
            videoElement.currentTime = 0;
            if (offscreenCtx) {
                offscreenCtx.clearRect(0, 0, canvasWidth, canvasHeight);
            }
        }
        previousXValues = [];
        previousYValues = [];

        // After everything completes, redirect to the dashboard
        window.location.href = "/dashboard";
    } catch (error) {
        console.error("Error during session end:", error);
    }
}
</script>

<!--
  1) Loading Spinner for when the file is being selected and loaded
     If you want it in a different place, move this {#if isLoadingFile} block
-->
{#if isLoadingFile}
  <div class="spinner mt-4 flex justify-center">
    <div class="loader"></div>
  </div>
{/if}

{#if videoLoaded && isPlaying}
  <div class="mt-2 text-center">
    Estimated Time Remaining: {Math.floor(remainingTime)} sec
  </div>
{/if}

<div
  class="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 my-4 p-6 text-zinc-100"
>
  <!-- Processing indicator: Spinner while processing, Pause symbol when paused -->
  {#if isProcessing}
    <div class="spinner my-4 flex justify-center">
      <div class="loader"></div>
    </div>
  {:else if videoLoaded && !isPlaying}
    <div class="pause-icon my-4 flex justify-center">
      <div class="pause-symbol">&#10074;&#10074;</div>
    </div>
  {/if}

  <label for="fileInput" class="block text-sm font-medium text-zinc-300 mb-2">
    Select Video File (.mp4, .webm, .mov)
  </label>

  <input
    type="file"
    accept="video/*"
    onchange={handleVideoUpload}
    id="fileInput"
    class="block text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-zinc-100 file:text-zinc-950 hover:file:bg-white cursor-pointer"
    disabled={isLoadingFile}
  />

  <!-- Session Name Modal -->
  {#if $isModalVisible}
    <div class="fixed inset-0 bg-black/70 flex justify-center items-center z-50">
      <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg w-96 shadow-xl text-zinc-100">
        <h2 class="font-semibold text-center text-lg mb-2">
          Save Video Analysis Session
        </h2>
        <p class="text-xs text-zinc-400 text-center mb-4">
          Please name your session to save the tracking metrics.
        </p>
        <input
          type="text"
          bind:value={sessionName}
          class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-sm text-zinc-100 placeholder-zinc-500 mb-4 focus:outline-none focus:border-zinc-500"
          placeholder="Session Name"
        />
        <div class="flex justify-end gap-2">
          <button
            onclick={() => isModalVisible.set(false)}
            class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onclick={endSession}
            class="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-sm rounded transition-colors cursor-pointer"
          >
            Save Session
          </button>
        </div>
      </div>
    </div>
  {/if}

</div>

<style>
  /* Basic spinner styling */
  .spinner {
    margin: 1rem auto;
  }
  .loader {
    border: 8px solid rgba(0, 0, 0, 0.1);
    border-top: 8px solid #3498db; /* or your color choice */
    border-radius: 50%;
    width: 48px;
    height: 48px;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Optional pause symbol styling */
  .pause-symbol {
    font-size: 2rem;
    color: #fff;
  }
</style>
