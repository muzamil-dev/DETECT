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
  let statusText = "Ready";

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
              label: "Pupil X",
              data: lxData,
              borderColor: "#38bdf8",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.2,
            },
            {
              label: "Pupil Y",
              data: lyData,
              borderColor: "#c084fc",
              borderWidth: 2,
              pointRadius: 0,
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

  async function start() {
    if (isTracking) return;
    statusText = "Starting camera...";

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();

      isTracking = true;
      statusText = "Loading MediaPipe...";

      const FaceMeshClass = (window as any).FaceMesh;
      if (FaceMeshClass) {
        faceMesh = new FaceMeshClass({
          locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);
        statusText = "Tracking Pupils Active";
      } else {
        statusText = "Camera Active";
      }

      loop();
    } catch (e: any) {
      statusText = "Camera Error: " + (e?.message || "Denied");
      stop();
    }
  }

  async function loop() {
    if (!isTracking) return;
    if (videoEl && videoEl.readyState >= 2) {
      const ctx = canvasEl?.getContext("2d");
      if (ctx && canvasEl) {
        if (canvasEl.width !== videoEl.videoWidth && videoEl.videoWidth > 0) {
          canvasEl.width = videoEl.videoWidth;
          canvasEl.height = videoEl.videoHeight;
        }
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
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
    statusText = "Stopped";
  }

  function onResults(res: any) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    if (res.multiFaceLandmarks && res.multiFaceLandmarks.length > 0) {
      const lms = res.multiFaceLandmarks[0];
      const pLeft = lms[468];
      const pRight = lms[473];

      if (pLeft) {
        lx = parseFloat(pLeft.x.toFixed(4));
        ly = parseFloat(pLeft.y.toFixed(4));

        const px = pLeft.x * canvasEl.width;
        const py = pLeft.y * canvasEl.height;

        ctx.beginPath();
        ctx.arc(px, py, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      if (pRight) {
        rx = parseFloat(pRight.x.toFixed(4));
        ry = parseFloat(pRight.y.toFixed(4));

        const px = pRight.x * canvasEl.width;
        const py = pRight.y * canvasEl.height;

        ctx.beginPath();
        ctx.arc(px, py, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 3;
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
  <!-- Status & Start/Stop -->
  <div class="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
    <div class="flex items-center space-x-3">
      <span class="w-3 h-3 rounded-full {isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}"></span>
      <span class="text-sm font-semibold text-zinc-200">{statusText}</span>
    </div>
    {#if !isTracking}
      <button
        onclick={start}
        class="px-6 py-2.5 bg-sky-400 hover:bg-sky-300 text-zinc-950 font-bold text-sm rounded transition-colors cursor-pointer"
      >
        Start Camera Tracking
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

  <!-- Telemetry Row -->
  <div class="grid grid-cols-2 gap-4 text-center">
    <div class="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
      <span class="text-xs text-zinc-400 font-mono">LEFT PUPIL X:</span>
      <span class="text-xl font-bold font-mono text-sky-400 ml-2">{lx}</span>
    </div>
    <div class="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
      <span class="text-xs text-zinc-400 font-mono">LEFT PUPIL Y:</span>
      <span class="text-xl font-bold font-mono text-purple-400 ml-2">{ly}</span>
    </div>
  </div>

  <!-- Viewport Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Camera Canvas -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-2 relative flex items-center justify-center min-h-[320px]">
      <video bind:this={videoEl} class="hidden" playsinline muted></video>
      <canvas bind:this={canvasEl} width="640" height="480" class="w-full h-auto rounded border border-zinc-800 bg-black"></canvas>
    </div>

    <!-- Live Line Graph -->
    <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 h-[340px]">
      <h4 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Live Pupil Coordinates Graph</h4>
      <div class="w-full h-[270px]">
        <canvas bind:this={chartEl}></canvas>
      </div>
    </div>
  </div>
</div>
