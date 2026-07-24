<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { writable, get } from "svelte/store";
  import { createSession } from "../scripts/session";
  import { fetchUserSettings, userSettings } from "../scripts/settings";

  import {
      applyAffineTransformation,
      calculateAffineTransformation,
  } from "../scripts/affineTransformation";

  import cameraUtilsPkg from "@mediapipe/camera_utils";
  import drawingUtilsPkg from "@mediapipe/drawing_utils";
  import faceMeshPkg from "@mediapipe/face_mesh";

  const Camera = (cameraUtilsPkg as any).Camera || (cameraUtilsPkg as any).default?.Camera || cameraUtilsPkg;
  const drawLandmarks = (drawingUtilsPkg as any).drawLandmarks || (drawingUtilsPkg as any).default?.drawLandmarks || drawingUtilsPkg;
  const FaceMesh = (faceMeshPkg as any).FaceMesh || (faceMeshPkg as any).default?.FaceMesh || faceMeshPkg;
  type Results = any;
  import type { Coordinates } from "../scripts/affineTransformation";
  import { applySmoothing } from "../scripts/smoothing";

  import {
      LEFT_EYE_CORNER,
      LEFT_IRIS_CENTER,
      NOSE_TIP,
      RIGHT_EYE_CORNER,
      RIGHT_IRIS_CENTER,
      getLandmarks,
      getNormalizedIrisPosition,
  } from "../scripts/utils";

  import { ProbabilityGraph } from "../scripts/graph";
  import { WebSocketConnection } from "../scripts/websocket";

  let videoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;
  let graphCanvasEl: HTMLCanvasElement;

  let camera: Camera | null = null;
  let faceMesh: FaceMesh | null = null;
  let ws: WebSocketConnection | null = null;

  let userId: string | null = null;
  let WEBSOCKET_URL = "ws://localhost:8080/websocket";
  if (typeof window !== "undefined") {
    userId = sessionStorage.getItem("userId");
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "localhost";
    WEBSOCKET_URL = `${wsProto}//${host}:8080/websocket?user_id=${encodeURIComponent(userId || '1')}`;
  }

  let variance: number = 0.0;
  let acceleration: number = 0.0;

  let probability: number | null = null;
  let startTime = new Date().toISOString(); // Capture the start time

  let probabilityGraph: ProbabilityGraph | null = null;
  let sessionName: string = ""; // Default session name

  export const webcamState = writable(false); // Default state: off
  let sessionCreated = false;

  // Flag to handle modal visibility
  let isModalVisible = writable(false);

  // Flag to track whether webcam has started (for disabling Stop button initially)
  let canStop = writable(false);

  let initialNoseTip: Coordinates | null = null; // Track the initial nose tip position

  let previousXValues: number[] = [];
  let previousYValues: number[] = [];

  let sensitivity: number | null = null;

  export const shouldShowGraph = writable(false);

  let affineTransformEnabled = writable(false);

  export const minMaxEnabled = writable<boolean>(false);

  let starttime = 0;
  let timestamp = 0;

  let varMaxValue: number | null = 0.0013;
  let accMaxValue: number | null = 10.0;

  // Log the settings whenever they change
  userSettings.subscribe((settings: any) => {
    console.log("User settings:", settings);
    sensitivity = settings.sensitivity;
    shouldShowGraph.set(settings.plotting ?? false);
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
  }
  // Create writable stores with the final values
  export const varMax = writable<number | null>(varMaxValue);
  export const accMax = writable<number | null>(accMaxValue);

  $: {
    $shouldShowGraph;

    if (graphCanvasEl && $shouldShowGraph) {
      probabilityGraph = new ProbabilityGraph(graphCanvasEl);
    } else {
      probabilityGraph = null;
    }
  }

  // Function to close any existing WebSocket connection before opening a new one
  function closeExistingWebSocket() {
    if (typeof window !== "undefined") {
      const existingWs = sessionStorage.getItem("activeWebSocket");
      if (existingWs) {
        try {
          const wsInstance = JSON.parse(existingWs);
          if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
            wsInstance.close();
          }
        } catch (error) {
          console.error("Error closing existing WebSocket:", error);
        }
      }
    }
  }

  // Function to initialize WebSocket
  function initializeWebSocket() {
    closeExistingWebSocket(); // Close any previous connection

    ws = new WebSocketConnection(WEBSOCKET_URL, handleWebSocketMessage);
    console.log("WebSocket initialized:", WEBSOCKET_URL);
    ws.start();

    // Store the reference in sessionStorage if client-side
    if (typeof window !== "undefined") {
      sessionStorage.setItem("activeWebSocket", JSON.stringify(ws));
    }
  }

  // WebSocket message handler
  function handleWebSocketMessage(data: any) {
    if (
      data.variance !== undefined &&
      data.acceleration !== undefined &&
      data.probability !== undefined
    ) {
      probability = data.probability;
      console.log("Probability:", probability);

      if (probabilityGraph) {
        if (probability !== null) {
          probabilityGraph.updateProbability(probability);
        }
      }
    }
  }

  // Start webcam capture
  function startCapture() {
    starttime = performance.now();
    if (!camera && faceMesh && videoEl) {
      camera = new Camera(videoEl, {
        onFrame: async () => {
          if (faceMesh && videoEl) {
            await faceMesh.send({ image: videoEl });
          }
        },
        width: 640,
        height: 480,
      });
      camera.start();
      canStop.set(true); // Enable Stop button once webcam has started
    }
  }

  // Stop the webcam capture
  function stopCapture() {
    if (camera && canvasEl) {
      camera.stop();
      camera = null;
      const canvasCtx = canvasEl.getContext("2d");
      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      }
    }

    if (!sessionCreated) {
      isModalVisible.set(true); // Show the modal to input the session name
    } else {
      endSession();
    }
  }

  // Handle closing the modal
  function closeModal() {
    isModalVisible.set(false);
  }

  // Handle the form submit for the session name
  function onSubmitSessionName() {
    if (sessionName) {
      endSession(); // End the session and create session data
    }
  }

  // Finalize the session creation
  function endSession() {
    if (camera && canvasEl) {
      camera.stop();
      camera = null;
      const canvasCtx = canvasEl.getContext("2d");
      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      }
    }

    if (!sessionCreated) {
      const sessionData = {
        name: sessionName || "Session",
        start_time: startTime,
        end_time: new Date().toISOString(),
        var_min: variance ?? 0,
        var_max: variance ?? 0,
        acc_min: acceleration ?? 0,
        acc_max: acceleration ?? 0,
      };
      createSession(sessionData);
      sessionCreated = true;

    }
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 1000);
  }

  onMount(() => {
    
    // Fetch user settings on component mount
    fetchUserSettings();

    // Initialize WebSocket
    initializeWebSocket();

    // Initialize FaceMesh
    faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // Draw face landmarks to canvas
    const canvasCtx = canvasEl.getContext("2d");
    if (!canvasCtx) return;

    // Inside the onResults function, after drawing landmarks:
    faceMesh.onResults((results: Results) => {
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      canvasCtx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);

      if (results.multiFaceLandmarks) {
        for (const landmarks of results.multiFaceLandmarks) {
          const irisCenters = getLandmarks(landmarks, [
            LEFT_IRIS_CENTER,
            RIGHT_IRIS_CENTER,
          ]);
          drawLandmarks(canvasCtx, irisCenters, {
            color: "#FF0000",
            lineWidth: 2,
          });

          const eyeCorners = getLandmarks(landmarks, [
            LEFT_EYE_CORNER,
            RIGHT_EYE_CORNER,
          ]);
          drawLandmarks(canvasCtx, eyeCorners, {
            color: "#FF0000",
            lineWidth: 1,
          });

          const noseTip = getLandmarks(landmarks, [NOSE_TIP]);
          drawLandmarks(canvasCtx, noseTip, {
            color: "#FF0000",
            lineWidth: 1,
          });

          timestamp = performance.now() - starttime;

          // Smoothing iris positions
          const { normX, normY } = getNormalizedIrisPosition(
            landmarks,
            canvasEl.width,
            canvasEl.height,
            timestamp
          );

          // Apply smoothing to the iris position
          const smoothedNormX = applySmoothing(normX, previousXValues);
          const smoothedNormY = applySmoothing(normY, previousYValues);

          // Track the current nose tip for affine transformation
          const currentNoseTip: Coordinates = getLandmarks(landmarks, [
            NOSE_TIP,
          ])[0];

          // Conditionally apply affine transformation
          if (initialNoseTip && $affineTransformEnabled) {
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
            drawLandmarks(canvasCtx, transformedLandmarks, {
              color: "#0000FF",
              lineWidth: 2,
            });
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
      canvasCtx.restore();
    });
    if (canvasEl) {
      canvasEl.width = Math.floor(window.innerWidth * 0.9);
      canvasEl.height = Math.floor(window.innerHeight * 0.9);
    }
  });

  onDestroy(() => {
    if (faceMesh) {
      faceMesh.close();
    }
    if (camera) {
      camera.stop();
    }
    if (ws) {
        ws.close();
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("activeWebSocket"); // Remove reference
        }
    }
  });
</script>

<!-- Outer container -->
<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 my-4 relative">
  <!-- Row container for the webcam canvas (left) and graph canvas (right) -->
  <div class="flex flex-col md:flex-row w-full gap-4 items-center justify-center">
    <!-- Left side: Webcam -->
    <div
      class="flex justify-center items-center w-full"
      style="width: {$shouldShowGraph ? '50%' : '100%'}"
    >
      <!-- Hidden video (used by FaceMesh) -->
      <video bind:this={videoEl} class="hidden">
        <track kind="captions" />
      </video>

      <!-- Webcam canvas -->
      <canvas
        bind:this={canvasEl}
        class="rounded border border-zinc-800 bg-zinc-950 w-full h-[55vh]"
      ></canvas>
    </div>

    <!-- Right side: Graph (conditionally rendered) -->
    {#if $shouldShowGraph}
      <div class="w-full md:w-1/2 flex justify-center items-center">
        <canvas
          bind:this={graphCanvasEl}
          class="rounded border border-zinc-800 bg-zinc-950 w-full h-[55vh]"
        ></canvas>
      </div>
    {/if}
  </div>

  <!-- Control buttons at the bottom -->
  <div class="flex gap-3 w-full mt-4 font-medium text-sm">
    <button
      on:click={startCapture}
      class="flex-1 py-2 px-4 bg-zinc-100 hover:bg-white text-zinc-950 rounded transition-colors duration-150"
    >
      Start Camera Tracking
    </button>
    <button
      on:click={stopCapture}
      class="flex-1 py-2 px-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded transition-colors duration-150"
      disabled={!$canStop}
    >
      Stop Tracking
    </button>
  </div>

  <!-- Modal for session name -->
  {#if $isModalVisible}
    <div class="fixed inset-0 bg-black/70 flex justify-center items-center z-50">
      <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg w-96 shadow-xl text-zinc-100">
        <h2 class="font-semibold text-center text-lg mb-3">
          Save Eye Tracking Session
        </h2>

        <input
          type="text"
          bind:value={sessionName}
          class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-sm text-zinc-100 placeholder-zinc-500 mb-4 focus:outline-none focus:border-zinc-500"
          placeholder="Session Name"
        />

        <div class="flex justify-end gap-2">
          <button
            on:click={closeModal}
            class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded transition-colors"
          >
            Cancel
          </button>
          <button
            on:click={onSubmitSessionName}
            class="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-sm rounded transition-colors"
          >
            Save Session
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
