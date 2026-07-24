import { tick } from "svelte";

export type AnalysisData = {
	session_id: number;
	timestamp: number;
	x: number;
	y: number;
	prob: number;
};
  
const getBaseUrl = () => {
  if (typeof window !== "undefined" && window.location.host.includes("vercel.app")) {
    return "https://detect-backend-uf49.onrender.com";
  }
  return import.meta.env.PUBLIC_SERVER_ADDRESS || "http://localhost:8080";
};

export async function insertAnalysisData(analysisEntries: AnalysisData[]) {
	try {
		await tick();
		if (!analysisEntries || analysisEntries.length === 0) return;

	  	const response = await fetch(`${getBaseUrl()}/updateSessionAnalysis`, {
		method: "POST",
		headers: {
		  "Content-Type": "application/json",
		},
		credentials: "include",
		body: JSON.stringify(analysisEntries),
	  });
  
	  if (!response.ok) {
		throw new Error("Failed to insert analysis data");
	  }
  
	  const result = await response.json();
	  console.log("Analysis insert result:", result.message || result);
  
	} catch (error) {
	  console.error("Error inserting analysis data:", error);
	}
}
