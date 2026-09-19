import { ingestionWorker } from "./workers/ingestion.worker.js";

ingestionWorker.on("ready", () => {
  console.log("Chiffra ingestion worker ready.");
});

