import { writable, get } from "svelte/store";
import { insertAnalysisData } from "./insert";
import { analysisData } from "../scripts/websocket";
import { tick } from "svelte";

export const sessionId = writable<number | null>(null); 

const getBaseUrl = () => {
  if (typeof window !== "undefined" && window.location.host.includes("vercel.app")) {
    return "https://detect-backend-uf49.onrender.com";
  }
  return import.meta.env.PUBLIC_SERVER_ADDRESS || "http://localhost:8080";
};

export async function createSession(sessionData: {
  name: string;
  start_time: string;
  end_time: string;
  var_min: number;
  var_max: number;
  acc_min: number;
  acc_max: number;
}) {
  try {
    await tick();
    const userId = sessionStorage.getItem("userId") || "1";

    const payload = {
      name: sessionData.name || "Session",
      user_id: Number(userId),
      start_time: sessionData.start_time,
      end_time: sessionData.end_time,
      v_min: sessionData.var_min ?? 0,
      v_max: sessionData.var_max ?? 0,
      a_min: sessionData.acc_min ?? 0,
      a_max: sessionData.acc_max ?? 0,
      var_min: sessionData.var_min ?? 0,
      var_max: sessionData.var_max ?? 0,
      acc_min: sessionData.acc_min ?? 0,
      acc_max: sessionData.acc_max ?? 0,
    };

    const response = await fetch(`${getBaseUrl()}/createSession`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log("Creating session:", payload);

    if (!response.ok) {
      throw new Error("Failed to create session");
    }

    const result = await response.json();
    console.log("Session created response:", result);

    const createdId = result.sessionId || result.session_id;
    if (createdId) {
      sessionId.set(Number(createdId));
      await tick();
      uploadData();
    }    

  } catch (error) {
    console.error("Error creating session:", error);
  }
}

async function uploadData() {
  await tick();
  const currentSessionId = get(sessionId);
  console.log("Session Id for telemetry upload:", currentSessionId);
  if (currentSessionId) {
    analysisData.update((data) => {
      return data.map(item => ({
        ...item,
        session_id: currentSessionId,
      }));
    });
    insertAnalysisData(get(analysisData));
  } else {
    console.error('Session ID is not available for uploadData');
  }
}
