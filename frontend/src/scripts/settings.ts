// src/settings.ts
import { writable } from 'svelte/store';

const serverAddress = import.meta.env.PUBLIC_SERVER_ADDRESS;

// The store for user settings
export const userSettings = writable({
  affine: false,
  min_max: false,
  plotting: true,
  sensitivity: 1.0,
});

// Store for tracking the loading state
export const isLoading = writable(true);

// Fetch user settings from the server
export async function fetchUserSettings() {
  try {
    const userId = sessionStorage.getItem("userId") || "1";
    const response = await fetch(`${serverAddress || ''}/getUserSettings?user_id=${userId}`, {
      method: "GET",
    });
    if (response.ok) {
      const data = await response.json();
      userSettings.update(settings => {
        settings.affine = data.affine ?? false;
        settings.min_max = data.min_max ?? false;
        settings.plotting = data.plotting ?? true;
        settings.sensitivity = data.sensitivity ?? 1.0;
        return settings;
      });
    }
  } catch (error) {
    console.error("Notice fetching user settings (using defaults):", error);
  } finally {
    isLoading.set(false);
  }
}
