<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Chart from "chart.js/auto";

  let videoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;
  let chartEl: HTMLCanvasElement;

  let stream: MediaStream | null = null;
  let faceMesh: any = null;
  let chart: Chart | null = null;
  let animId: number | null = null;

  let isTracking = false;
  let statusText = "Camera Offline";

  let lx = 0, ly = 0, rx = 0, ry = 0;

  const labels: string[] = [];
  const lxData: number[] = [];
  const lyData: number[] = [];

  onMount(() => {
    const ctx = chartEl?.getContext("2d");
    if (ctx) {
      chart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Left Eye X",
              data: lxData,
              borderColor: "#22c55e",
              backgroundColor: "#22c55e",
              borderWidth: 2,
              pointRadius: 1,
              tension: 0.2,
            },
            {
              label: "Left Eye Y",
              data: lyData,
              borderColor: "#a855f7",
              backgroundColor: "#a855f7",
              borderWidth: 2,
              pointRadius: 1,
              tension: 0.2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: { display: false },
            y: { grid: { color: "#27272a" }, ticks: { color: "#a1a1aa" } },
          },
        },
      });
    }
  });

  onDestroy(() => {
    stop();
    if (chart) chart.destroy();
  });

  async function ensureFaceMeshLoaded(): Promise<any> {
    if (typeof window === "undefined") return null;
    if ((window as any).FaceMesh) return (window as any).FaceMesh;

    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/mediapipe/face_mesh.js";
      s.onload = () => resolve((window as any).FaceMesh);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }

  async function start() {
    if (isTracking) return;
    statusText = "Requesting Camera Access...";

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });

      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }

      isTracking = true;
      statusText = "Camera Active • Loading MediaPipe Engine...";

      // Continuous render loop
      loop();

      const FaceMeshClass = await ensureFaceMeshLoaded();
      if (FaceMeshClass) {
        faceMesh = new FaceMeshClass({
          locateFile: (file: string) => `/mediapipe/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);
        statusText = "Pupil Tracking Active (Green Dots On)";
      } else {
        statusText = "Camera Active (MediaPipe Load Pending)";
      }
    } catch (e: any) {
      console.error("Camera access error:", e);
      statusText = "Camera Error: " + (e?.message || "Permission Denied");
      stop();
    }
  }

  async function loop() {
    if (!isTracking) return;

    if (videoEl && videoEl.readyState >= 2) {
      const ctx = canvasEl?.getContext("2d");
      if (ctx && canvasEl) {
        if (videoEl.videoWidth > 0 && canvasEl.width !== videoEl.videoWidth) {
          canvasEl.width = videoEl.videoWidth;
          canvasEl.height = videoEl.videoHeight;
        }
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        ctx.restore();
      }

      if (faceMesh) {
        try {
          await faceMesh.send({ image: videoEl });
        } catch (e) {}
      }
    }
    animId = requestAnimationFrame(loop);
  }

  function stop() {
    isTracking = false;
    if (animId) cancelAnimationFrame(animId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (videoEl) videoEl.srcObject = null;
    if (faceMesh) {
      try { faceMesh.close(); } catch (e) {}
      faceMesh = null;
    }
    statusText = "Tracking Stopped";
  }

  function onResults(res: any) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    if (res.multiFaceLandmarks && res.multiFaceLandmarks.length > 0) {
      const lms = res.multiFaceLandmarks[0];

      // Primary: Iris landmark 468 (Left Pupil) & 473 (Right Pupil)
      // Fallback: Eye Corner Center (33 + 133) / 2 and (362 + 263) / 2
      const pLeft = lms[468] || (lms[33] && lms[133] ? { x: (lms[33].x + lms[133].x) / 2, y: (lms[33].y + lms[133].y) / 2 } : null);
      const pRight = lms[473] || (lms[362] && lms[263] ? { x: (lms[362].x + lms[263].x) / 2, y: (lms[362].y + lms[263].y) / 2 } : null);

      if (pLeft) {
        lx = parseFloat(pLeft.x.toFixed(4));
        ly = parseFloat(pLeft.y.toFixed(4));

        const px = pLeft.x * canvasEl.width;
        const py = pLeft.y * canvasEl.height;

        // BRIGHT GLOWING GREEN DOT OVER LEFT PUPIL
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, 2 * Math.PI);
        ctx.fillStyle = "#00FF00";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#FFFFFF";
        ctx.stroke();
      }

      if (pRight) {
        rx = parseFloat(pRight.x.toFixed(4));
        ry = parseFloat(pRight.y.toFixed(4));

        const px = pRight.x * canvasEl.width;
        const py = pRight.y * canvasEl.height;

        // BRIGHT GLOWING GREEN DOT OVER RIGHT PUPIL
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, 2 * Math.PI);
        ctx.fillStyle = "#00FF00";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#FFFFFF";
        ctx.stroke();
      }

      labels.push("");
      lxData.push(lx);
      lyData.push(ly);

      if (labels.length > 60) {
        labels.shift();
        lxData.shift();
        lyData.shift();
      }

      if (chart) chart.update("none");
    }
  }
</script>

<div class="space-y-4 max-w-5xl mx-auto p-4">
  <!-- Controls Bar -->
  <div class="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
    <div class="flex items-center space-x-3">
      <span class="w-3 h-3 rounded-full {isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}"></span>
      <span class="text-sm font-semibold text-zinc-200">{statusText}</span>
    </div>

    <div>
      {#if !isTracking}
        <button
          onclick={start}
          class="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded transition-colors cursor-pointer"
        >
          Start Camera (Green Pupil Dots)
        </button>
      {:else}
        <button
          onclick={stop}
          class="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-sm rounded transition-colors cursor-pointer"
        >
          Stop Camera
        </button>
      {/if}
    </div>
  </div>

  <!-- Telemetry Metrics -->
  <div class="grid grid-cols-2 gap-4 text-center">
    <div class="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
      <span class="text-xs text-zinc-400 font-mono">LEFT EYE X:</span>
      <span class="text-xl font-bold font-mono text-emerald-400 ml-2">{lx}</span>
    </div>
    <div class="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
      <span class="text-xs text-zinc-400 font-mono">LEFT EYE Y:</span>
      <span class="text-xl font-bold font-mono text-purple-400 ml-2">{ly}</span>
    </div>
  </div>

  <!-- Viewport Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Camera Viewport Canvas -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-2 relative flex items-center justify-center min-h-[320px]">
      <video bind:this={videoEl} class="absolute opacity-0 pointer-events-none w-1 h-1" playsinline muted></video>
      <canvas bind:this={canvasEl} width="640" height="480" class="w-full h-auto rounded border border-zinc-800 bg-black"></canvas>
    </div>

    <!-- Live Line Graph -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 h-[340px]">
      <h4 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Live Eye Coordinates Graph</h4>
      <div class="w-full h-[270px]">
        <canvas bind:this={chartEl}></canvas>
      </div>
    </div>
  </div>
</div>
