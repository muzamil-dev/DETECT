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

    try {
      // 1. Get Camera Media Stream
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

      // Start continuous video rendering frame loop
      processFrame();

      // 2. Load and Instantiate MediaPipe FaceMesh
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
        statusMessage = "Camera Active (MediaPipe Load Pending)";
      }
    } catch (err: any) {
      console.error("Camera permission / access error:", err);
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
        } catch (e) {
          // ignore frame drops
        }
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

      // Left Pupil (468) & Right Pupil (473)
      const leftIris = landmarks[468] || landmarks[469];
      const rightIris = landmarks[473] || landmarks[474];

      if (leftIris) {
        leftIrisX = parseFloat(leftIris.x.toFixed(4));
        leftIrisY = parseFloat(leftIris.y.toFixed(4));

        const lx = leftIris.x * canvasElement.width;
        const ly = leftIris.y * canvasElement.height;

        // Glowing Cyan Target Ring over Left Pupil
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

        // Glowing Purple Target Ring over Right Pupil
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

      // Push real-time metrics to Chart.js graph
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
  <!-- Status & Controls -->
  <div class="p-4 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <span class="w-3 h-3 rounded-full {isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}"></span>
      <span class="text-sm font-semibold text-zinc-200">{statusMessage}</span>
    </div>

    <div>
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
          Stop Tracking
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
</div>
