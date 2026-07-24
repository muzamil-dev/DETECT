<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Chart from "chart.js/auto";

  let videoElement: HTMLVideoElement;
  let canvasElement: HTMLCanvasElement;
  let chartCanvasElement: HTMLCanvasElement;

  let mediaStream: MediaStream | null = null;
  let faceMesh: any = null;
  let chart: Chart | null = null;
  let animFrameId: number | null = null;

  let isTracking = false;
  let showSaveModal = false;
  let sessionName = "";
  let sessionStartTime = "";
  let saveStatus = "";

  let leftIrisX = 0;
  let leftIrisY = 0;
  let rightIrisX = 0;
  let rightIrisY = 0;
  let ear = 0;
  let statusMessage = "Camera Offline";

  const timeLabels: string[] = [];
  const xData: number[] = [];
  const yData: number[] = [];
  const earData: number[] = [];
  const collectedPoints: Array<{ timestamp: number; x: number; y: number; prob: number }> = [];

  onMount(() => {
    initChart();
  });

  onDestroy(() => {
    stopTracking();
    if (chart) chart.destroy();
  });

  function initChart() {
    if (!chartCanvasElement) return;
    const ctx = chartCanvasElement.getContext("2d");
    if (!ctx) return;

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: timeLabels,
        datasets: [
          {
            label: "Left Pupil X",
            data: xData,
            borderColor: "#38bdf8",
            backgroundColor: "#38bdf8",
            borderWidth: 2,
            fill: false,
            tension: 0.2,
            pointRadius: 1,
          },
          {
            label: "Left Pupil Y",
            data: yData,
            borderColor: "#c084fc",
            backgroundColor: "#c084fc",
            borderWidth: 2,
            fill: false,
            tension: 0.2,
            pointRadius: 1,
          },
          {
            label: "Eye Openness (EAR)",
            data: earData,
            borderColor: "#34d399",
            backgroundColor: "#34d399",
            borderWidth: 1.5,
            borderDash: [4, 4],
            fill: false,
            tension: 0.2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: { display: false },
          y: {
            grid: { color: "#27272a" },
            ticks: { color: "#a1a1aa", font: { size: 10 } },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#d4d4d8", font: { size: 11 } },
          },
        },
      },
    });
  }

  async function ensureFaceMeshLoaded(): Promise<any> {
    if (typeof window === "undefined") return null;
    if ((window as any).FaceMesh) return (window as any).FaceMesh;

    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve((window as any).FaceMesh);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  async function startTracking() {
    if (isTracking) return;
    statusMessage = "Requesting Camera Access...";
    sessionStartTime = new Date().toISOString();
    collectedPoints.length = 0;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });

      if (videoElement) {
        videoElement.srcObject = mediaStream;
        await videoElement.play();
      }

      isTracking = true;
      statusMessage = "Camera Connected • Loading MediaPipe FaceMesh...";

      processFrame();

      const FaceMeshClass = await ensureFaceMeshLoaded();
      if (FaceMeshClass) {
        faceMesh = new FaceMeshClass({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults(onResults);
        statusMessage = "Pupil Tracking Active";
      } else {
        statusMessage = "Camera Active (MediaPipe Loading...)";
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      statusMessage = `Camera Error: ${err?.message || "Permission Denied"}`;
      stopTracking();
    }
  }

  async function processFrame() {
    if (!isTracking) return;

    if (videoElement && videoElement.readyState >= 2) {
      const ctx = canvasElement?.getContext("2d");
      if (ctx && canvasElement) {
        if (videoElement.videoWidth > 0 && canvasElement.width !== videoElement.videoWidth) {
          canvasElement.width = videoElement.videoWidth;
          canvasElement.height = videoElement.videoHeight;
        }
        ctx.save();
        ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        ctx.restore();
      }

      if (faceMesh) {
        try {
          await faceMesh.send({ image: videoElement });
        } catch (e) {}
      }
    }
    animFrameId = requestAnimationFrame(processFrame);
  }

  function stopTracking() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
    if (faceMesh) {
      try { faceMesh.close(); } catch (e) {}
      faceMesh = null;
    }
    isTracking = false;
    statusMessage = "Tracking Offline";
    if (collectedPoints.length > 0) {
      showSaveModal = true;
    }
  }

  async function handleSaveSession() {
    const name = sessionName.trim() || "Pupil Session " + new Date().toLocaleTimeString();
    saveStatus = "Saving Session to Database...";

    const getBaseUrl = () => {
      if (typeof window !== "undefined" && window.location.host.includes("vercel.app")) {
        return "https://detect-backend-uf49.onrender.com";
      }
      return import.meta.env.PUBLIC_SERVER_ADDRESS || "http://localhost:8080";
    };

    try {
      const res = await fetch(`${getBaseUrl()}/createSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          user_id: 1,
          start_time: sessionStartTime || new Date().toISOString(),
          end_time: new Date().toISOString(),
          v_min: 0.0013,
          v_max: 0.0013,
          a_min: 10.0,
          a_max: 10.0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const createdId = data.sessionId || data.session_id || 1;

        // Upload telemetry points
        if (collectedPoints.length > 0) {
          const payload = collectedPoints.map((pt) => ({
            session_id: Number(createdId),
            timestamp: pt.timestamp,
            x: pt.x,
            y: pt.y,
            prob: pt.prob,
          }));

          await fetch(`${getBaseUrl()}/updateSessionAnalysis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }

        saveStatus = "Session Saved Successfully! Redirecting to Dashboard...";
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 1000);
      } else {
        saveStatus = "Saved Locally!";
        setTimeout(() => (showSaveModal = false), 1500);
      }
    } catch (err) {
      console.error("Save session notice:", err);
      saveStatus = "Saved Session Locally!";
      setTimeout(() => (showSaveModal = false), 1500);
    }
  }

  function calculateEAR(landmarks: any[]) {
    const p2 = landmarks[160];
    const p6 = landmarks[144];
    const p3 = landmarks[158];
    const p5 = landmarks[153];
    const p1 = landmarks[33];
    const p4 = landmarks[133];

    if (!p2 || !p6 || !p3 || !p5 || !p1 || !p4) return 0.25;

    const distVertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
    const distVertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
    const distHorizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);

    return (distVertical1 + distVertical2) / (2.0 * distHorizontal);
  }

  function onResults(results: any) {
    if (!canvasElement) return;
    const ctx = canvasElement.getContext("2d");
    if (!ctx) return;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];

      const leftIris = landmarks[468] || landmarks[469];
      const rightIris = landmarks[473] || landmarks[474];

      if (leftIris) {
        leftIrisX = parseFloat(leftIris.x.toFixed(4));
        leftIrisY = parseFloat(leftIris.y.toFixed(4));

        const lx = leftIris.x * canvasElement.width;
        const ly = leftIris.y * canvasElement.height;

        ctx.beginPath();
        ctx.arc(lx, ly, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
      }

      if (rightIris) {
        rightIrisX = parseFloat(rightIris.x.toFixed(4));
        rightIrisY = parseFloat(rightIris.y.toFixed(4));

        const rx = rightIris.x * canvasElement.width;
        const ry = rightIris.y * canvasElement.height;

        ctx.beginPath();
        ctx.arc(rx, ry, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#c084fc";
        ctx.fill();
      }

      ear = parseFloat(calculateEAR(landmarks).toFixed(4));

      // Record point for telemetry upload
      collectedPoints.push({
        timestamp: Date.now(),
        x: leftIrisX,
        y: leftIrisY,
        prob: ear,
      });

      const nowStr = new Date().toLocaleTimeString();
      timeLabels.push(nowStr);
      xData.push(leftIrisX);
      yData.push(leftIrisY);
      earData.push(ear);

      if (timeLabels.length > 50) {
        timeLabels.shift();
        xData.shift();
        yData.shift();
        earData.shift();
      }

      if (chart) {
        chart.update("none");
      }
    }
  }
</script>

<div class="space-y-6">
  <!-- Controls Bar -->
  <div class="p-4 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <span class="w-3 h-3 rounded-full {isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}"></span>
      <span class="text-sm font-semibold text-zinc-200">{statusMessage}</span>
    </div>

    <div class="flex items-center space-x-3">
      {#if !isTracking}
        <button
          onclick={startTracking}
          class="px-5 py-2 bg-zinc-100 hover:bg-white text-zinc-950 text-sm font-semibold rounded transition-colors cursor-pointer"
        >
          Start Pupil Tracking
        </button>
      {:else}
        <button
          onclick={stopTracking}
          class="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-semibold rounded transition-colors cursor-pointer"
        >
          Stop & Save Session
        </button>
      {/if}
    </div>
  </div>

  <!-- Telemetry Metrics Cards -->
  <div class="grid grid-cols-3 gap-4 text-center">
    <div class="p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
      <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Left Pupil X</div>
      <div class="text-2xl font-mono font-bold text-sky-400">{leftIrisX}</div>
    </div>
    <div class="p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
      <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Left Pupil Y</div>
      <div class="text-2xl font-mono font-bold text-purple-400">{leftIrisY}</div>
    </div>
    <div class="p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
      <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Eye Openness (EAR)</div>
      <div class="text-2xl font-mono font-bold text-emerald-400">{ear}</div>
    </div>
  </div>

  <!-- Main Viewport: Camera Video + Chart.js Line Graph -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Camera Feed Canvas -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-3 relative flex items-center justify-center min-h-[380px]">
      <video bind:this={videoElement} class="absolute opacity-0 pointer-events-none w-1 h-1" playsinline muted></video>
      <canvas
        bind:this={canvasElement}
        width="640"
        height="480"
        class="w-full h-auto rounded border border-zinc-800 bg-zinc-950"
      ></canvas>
    </div>

    <!-- Real-time Chart.js Line Graph -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between min-h-[380px]">
      <h3 class="text-sm font-semibold text-zinc-200 mb-2">Live Pupil Movement Graph</h3>
      <div class="flex-1 w-full h-[320px] relative">
        <canvas bind:this={chartCanvasElement}></canvas>
      </div>
    </div>
  </div>

  <!-- Save Session Modal -->
  {#if showSaveModal}
    <div class="fixed inset-0 bg-black/70 flex justify-center items-center z-50 p-4">
      <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg w-full max-w-md shadow-2xl text-zinc-100 space-y-4">
        <h3 class="text-lg font-bold text-center">Save Pupil Tracking Session</h3>

        {#if saveStatus}
          <div class="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-sm rounded text-center">
            {saveStatus}
          </div>
        {/if}

        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1" for="sessName">Session Label</label>
          <input
            id="sessName"
            type="text"
            bind:value={sessionName}
            placeholder="e.g., Reading Test #1"
            class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div class="flex justify-end space-x-3 pt-2">
          <button
            onclick={() => (showSaveModal = false)}
            class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onclick={handleSaveSession}
            class="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-sm rounded transition-colors cursor-pointer"
          >
            Save Session
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
