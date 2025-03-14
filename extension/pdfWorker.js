console.log("pdfWorker.js loaded");

(async function () {
  try {
    // Dynamically import pdf.js module
    const pdfjsLib = await import("./lib/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdf.worker.mjs";

    console.log("pdf.js loaded");

    // Listen for a message from the service worker
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      if (message.action === "processPDF") {
        console.log("Processing PDF:", message.pdfData);
        console.log("6");
        try {
          const pdfData = new Uint8Array(message.pdfData);
          const extractedText = await extractTextFromPDF(pdfData, pdfjsLib);

          console.log("Extracted text:", extractedText);
          console.log("7");
          // Send the extracted text to Gemini
          const summary = await sendToGeminiAI(extractedText);

          // Store in Chrome Storage
          chrome.storage.local.set({ pdfSummary: extractedText, geminiResponse: summary });

          // Send summary to popup.js
          chrome.runtime.sendMessage({
            action: "showSummary",
            summary: summary,
          });
        } catch (error) {
          console.error("Error extracting text:", error);
        }
      }
    });
  } catch (error) {
    console.error("Error loading pdf.js module:", error);
  }
})();

async function extractTextFromPDF(pdfData, pdfjsLib) {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  let text = "";

  console.log("8");
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map((item) => item.str);
    text += textItems.join(" ") + "\n";
  }

  return text;
}

async function sendToGeminiAI(text) {
  const GEMINI_API_KEY = "AIzaSyA4yim2okmVuLZqFfK9ryUa1HQRtRL2JUs"; // Replace with a secure method to store API keys
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/generateText?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: text,
      }),
    });
    console.log("9");
    const data = await response.json();
    return data.text || "Error generating summary.";
  } catch (error) {
    console.error("Error sending text to Gemini:", error);
    return "Failed to get a summary.";
  }
}
