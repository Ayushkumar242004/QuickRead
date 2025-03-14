// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === "pdf_detected") {
        console.log("Fetching PDF:", request.pdfUrl);

        fetch(request.pdfUrl)
            .then(response => response.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = function () {
                    const base64data = reader.result.split(",")[1];  // Convert PDF to Base64
                    chrome.runtime.sendMessage({
                        message: "pdf_ready",
                        pdfData: base64data
                    });
                };
                reader.readAsDataURL(blob);
            })
            .catch(error => console.error("Error fetching PDF:", error));
    }
});

