(async function extractPDF() {
  console.log("Extracting text from PDF...");

  try {
      // Dynamically import pdf.js from your local lib folder
      const pdfjsLib = await import(chrome.runtime.getURL("lib/pdf.mjs"));

      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.mjs");

      const url = window.location.href;
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;
      let extractedText = "";

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const textItems = textContent.items.map((item) => item.str);
          extractedText += textItems.join(" ") + "\n";
      }

      // Store extracted text in Chrome Storage
      chrome.storage.local.set({ pdfText: extractedText });
      console.log("Extracted text:", extractedText);
  } catch (error) {
      console.error("Error extracting PDF text:", error);
  }
})();
