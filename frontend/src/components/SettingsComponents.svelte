<script lang="ts">
  import { onMount } from "svelte";

  let affine = false;
  let minMax = false;
  let plotting = true;
  let sensitivity = 1.0;
  let saveStatus = "";

  onMount(() => {
    if (typeof window !== "undefined") {
      affine = localStorage.getItem("setting_affine") === "true";
      minMax = localStorage.getItem("setting_min_max") === "true";
      plotting = localStorage.getItem("setting_plotting") !== "false"; // default true
      sensitivity = parseFloat(localStorage.getItem("setting_sensitivity") || "1.0");
    }
  });

  function saveSettings() {
    if (typeof window !== "undefined") {
      localStorage.setItem("setting_affine", String(affine));
      localStorage.setItem("setting_min_max", String(minMax));
      localStorage.setItem("setting_plotting", String(plotting));
      localStorage.setItem("setting_sensitivity", String(sensitivity));
    }
    saveStatus = "Settings saved successfully!";
    setTimeout(() => (saveStatus = ""), 3000);
  }
</script>

<div class="space-y-6 max-w-2xl mx-auto">
  <div class="p-6 bg-zinc-900 border border-zinc-800 rounded-lg space-y-6">
    <h2 class="text-xl font-bold text-zinc-100 border-b border-zinc-800 pb-3">Tracking & Analytics Settings</h2>

    {#if saveStatus}
      <div class="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-sm rounded">
        {saveStatus}
      </div>
    {/if}

    <!-- Affine Normalization -->
    <div class="flex items-center justify-between">
      <div>
        <div class="text-sm font-semibold text-zinc-200">Face Normalization (Affine)</div>
        <div class="text-xs text-zinc-500">Correct pupil tracking coordinates for head tilt and position shift</div>
      </div>
      <input
        type="checkbox"
        bind:checked={affine}
        onchange={saveSettings}
        class="w-5 h-5 rounded accent-sky-400 cursor-pointer"
      />
    </div>

    <!-- Min/Max Normalization -->
    <div class="flex items-center justify-between">
      <div>
        <div class="text-sm font-semibold text-zinc-200">Min/Max Variance Scaling</div>
        <div class="text-xs text-zinc-500">Dynamic scaling of velocity and movement variance</div>
      </div>
      <input
        type="checkbox"
        bind:checked={minMax}
        onchange={saveSettings}
        class="w-5 h-5 rounded accent-sky-400 cursor-pointer"
      />
    </div>

    <!-- Real-time Plotting -->
    <div class="flex items-center justify-between">
      <div>
        <div class="text-sm font-semibold text-zinc-200">Real-Time Graph Plotting</div>
        <div class="text-xs text-zinc-500">Display 60 FPS pupil movement line graph on live camera view</div>
      </div>
      <input
        type="checkbox"
        bind:checked={plotting}
        onchange={saveSettings}
        class="w-5 h-5 rounded accent-sky-400 cursor-pointer"
      />
    </div>

    <!-- Sensitivity Slider -->
    <div class="space-y-2">
      <div class="flex justify-between items-center text-sm">
        <span class="font-semibold text-zinc-200">Tracking Sensitivity</span>
        <span class="font-mono text-sky-400 font-bold">{sensitivity}x</span>
      </div>
      <input
        type="range"
        min="0.5"
        max="2.0"
        step="0.05"
        bind:value={sensitivity}
        oninput={saveSettings}
        class="w-full accent-sky-400 cursor-pointer"
      />
      <div class="flex justify-between text-xs text-zinc-500 font-mono">
        <span>0.5x (Low)</span>
        <span>1.0x (Standard)</span>
        <span>2.0x (High)</span>
      </div>
    </div>
  </div>
</div>
