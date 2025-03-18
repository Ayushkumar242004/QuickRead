/* globals DOMPurify, Readability, marked */
// import { GoogleGenerativeAI } from "@google/generative-ai";
import { applyTheme, loadTemplate, displayLoadingMessage } from "./utils.js";
import { getDocument, GlobalWorkerOptions } from "./lib/pdf.mjs";
import { getModelId } from './utils.js';

GlobalWorkerOptions.workerSrc = "./lib/pdf.worker.mjs";

let resultIndex = 0;
let content = "";

const copyContent = async () => {
  const copyButton = document.getElementById("copy");
  let clipboardContent = content.replace(/\n+$/, "") + "\n\n";

  // Copy the content to the clipboard
  await navigator.clipboard.writeText(clipboardContent);

  // Change the button text to "Copied!" and add a tick icon
  copyButton.innerHTML = "✓ Copied";
  copyButton.style.backgroundColor = "#a6a6a646"; // Green background
  copyButton.style.borderColor = "#a6a6a646";

  // Reset the button after 2 seconds
  setTimeout(() => {
    copyButton.innerHTML = "Copy";
    copyButton.style.backgroundColor = "transparent";
    copyButton.style.borderColor = "#a6a6a646";
  }, 2000);
};

const getSelectedText = () => {
  // Return the selected text
  return window.getSelection().toString();
};

// Function to extract and summarize text content
const getWholeText = () => {
  try {
    const documentClone = document.cloneNode(true);

    // Remove unnecessary elements (ads, sidebars)
    const unwantedSelectors = ["aside", ".sidebar", ".ads", ".advertisement", "[role='complementary']"];
    unwantedSelectors.forEach(selector => {
      documentClone.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Parse document using Readability
    if (typeof Readability !== "undefined") {
      const article = new Readability(documentClone).parse();
      return article ? article.textContent : document.body.innerText;
    } else {
      console.warn("Readability is not available. Returning raw text.");
      return document.body.innerText;
    }
  } catch (error) {
    console.error("Error in summarizing text:", error);
    return document.body.innerText;
  }
};

const getCaptions = async (videoUrl, languageCode) => {
  // Return the captions of the YouTube video
  const languageCodeForCaptions = en;

  const preferredLanguages = [languageCodeForCaptions[languageCode], "en"];
  const videoResponse = await fetch(videoUrl);
  const videoBody = await videoResponse.text();
  const captionsConfigJson = videoBody.match(
    /"captions":(.*?),"videoDetails":/s
  );
  let captions = "";

  if (captionsConfigJson) {
    const captionsConfig = JSON.parse(captionsConfigJson[1]);

    if (captionsConfig?.playerCaptionsTracklistRenderer?.captionTracks) {
      const captionTracks =
        captionsConfig.playerCaptionsTracklistRenderer.captionTracks;

      const calculateValue = (a) => {
        let value = preferredLanguages.indexOf(a.languageCode);
        value = value === -1 ? 9999 : value;
        value += a.kind === "asr" ? 0.5 : 0;
        return value;
      };

      // Sort the caption tracks by the preferred languages and the kind
      captionTracks.sort((a, b) => {
        const valueA = calculateValue(a);
        const valueB = calculateValue(b);
        return valueA - valueB;
      });

      const captionsUrl = captionTracks[0].baseUrl;
      const captionsResponse = await fetch(captionsUrl);
      const captionsXml = await captionsResponse.text();
      const xmlDocument = new DOMParser().parseFromString(
        captionsXml,
        "application/xml"
      );
      const textElements = xmlDocument.getElementsByTagName("text");
      captions = Array.from(textElements)
        .map((element) => element.textContent)
        .join("\n");
    } else {
      console.log("No captionTracks found.");
    }
  } else {
    console.log("No captions found.");
  }

  return captions;
};

const extractPDFText = async (pdfUrl) => {
  
  try {
  
    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();
    const pdfData = new Uint8Array(arrayBuffer);

    const loadingTask = getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      text += textContent.items.map((item) => item.str).join(" ") + " ";
    }

    return text.trim();
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error("Error extracting text from PDF: " + error.message);
  }
};

const extractTaskInformation = async (languageCode) => {
  let actionType = "";
  let mediaType = "";
  let taskInput = "";
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    taskInput = (
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getSelectedText,
      })
    )[0]?.result || "";
  } catch (error) {
    console.error("Error extracting selected text:", error);
  }

  if (taskInput) {
    actionType =
      (await chrome.storage.local.get("textAction")).textAction || "translate";
    mediaType = "text";
  } else {
    actionType = (await chrome.storage.local.get({ noTextAction: "translate" }))
      .noTextAction;

      if (tab.url.endsWith(".pdf")) {
        mediaType = "text";
        try {
          taskInput = await extractPDFText(tab.url);
      
          // Retrieve API key from chrome.storage.local
          const options = await chrome.storage.local.get("apiKey");
          const apiKey = options.apiKey || ""; // Use stored key or default to empty
          const modelId = getModelId("2.0-flash");
      
          if (!apiKey) {
            console.error("API key is missing.");
            document.getElementById("content").textContent = "Error: API key is missing.";
            return;
          }
      
          taskInput = removeHtmlTags(marked.parse(await getSummaryFromGemini(taskInput, apiKey, modelId)));
      
          // document.getElementById("content").textContent = taskInput;
          
        } catch (error) {
          console.error("Error extracting text from PDF:", error);
          taskInput = "";
        }
    } else if (
      tab.url.includes("https://www.youtube.com/watch?v=") ||
      tab.url.includes("https://m.youtube.com/watch?v=")
    ) {
      mediaType = "captions";
      try {
        taskInput = (
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getCaptions,
            args: [tab.url, languageCode],
          })
        )[0]?.result || "";
      } catch (error) {
        console.error("Error extracting captions:", error);
      }
    } else {
      mediaType = "text";
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["lib/Readability.min.js"],
        });

        taskInput = (
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getWholeText,
          })
        )[0]?.result || "";
      } catch (error) {
        console.error("Error extracting whole text:", error);
      }

      if (!tab.url.endsWith(".pdf") && !tab.url.startsWith("chrome://")) {
        mediaType = "ad";
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const isRelevantImage = (imageUrl) => {
                return !(
                  imageUrl.includes("icon") ||
                  imageUrl.includes("logo") ||
                  imageUrl.includes("placeholder") ||
                  imageUrl.includes("ads")
                );
              };

              let imageURLs = new Set();
              document.querySelectorAll("img").forEach((img) => {
                let imageUrl = img.src;
                if (
                  imageUrl &&
                  !imageUrl.startsWith("data:image") &&
                  isRelevantImage(imageUrl)
                ) {
                  imageURLs.add(imageUrl);
                }
              });

              return [...imageURLs].slice(0, 2);
            },
          });

          const imageUrls = results?.[0]?.result || [];
          if (imageUrls.length > 0) {
            try {
              const options = await chrome.storage.local.get("apiKey");
              const apiKey = options.apiKey || ""; 
              const modelId = "gemini-1.5-flash"; 
          
              if (!apiKey) {
                console.error("API key is missing. Please set it in the options.");
                return;
              }

              const imageDescriptions = await Promise.all(
                imageUrls.map(async (url) => {
                  try {
                    const base64Data = await convertImageToBase64(url);
                    if (!base64Data) {
                      return `Image: ${url}\nDescription: Error converting image to Base64.`;
                    }

                    const [mimeTypePart, base64String] = base64Data.split(";base64,");
                    const mimeType = mimeTypePart.replace("data:", "");

                    const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
                    if (!validMimeTypes.includes(mimeType)) {
                      return `Image: ${url}\nDescription: Unsupported MIME type: ${mimeType}`;
                    }

                    const description = await analyzeImageWithGemini(
                      base64String,
                      mimeType,
                      apiKey,
                      modelId
                    );
                    
                    return `Image Description: ${description}`;
                  } catch (error) {
                    console.error("Error analyzing image:", error);
                    return `Image: ${url}\nDescription: Error analyzing image`;
                  }
                })
              );

              const imageSummary = imageDescriptions.join("\n\n");
             
              taskInput += `\n\n**Image Summary:**\n${imageSummary}`;
              
              // document.getElementById("content").textContent = taskInput;
             
              
            } catch (error) {
              console.error("Error processing images:", error);
              taskInput = "Error processing images.";
            }
          } else {
            taskInput = "No relevant images found.";
          }
        } catch (error) {
          console.error("Error extracting images from webpage:", error);
        }
      }
    }
  }

  return { actionType, mediaType, taskInput };
};

async function analyzeImageWithGemini(base64String, mimeType, apiKey, modelId) {
  try {
    if (!base64String || !mimeType || !apiKey || !modelId) {
      throw new Error("Missing required parameters for Gemini API call.");
    }

    const apiContents = [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64String,
            },
          },
        ],
      },
    ];

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "analyzeImage",
          apiContents,
          apiKey,
          modelId,
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        }
      );
    });

    if (!response || response.error) {
      throw new Error(response?.error || "Invalid response from Gemini API.");
    }
    
    return response.summary;
  } catch (error) {
    console.error("Error analyzing image with Gemini:", error);
    return "Error analyzing image";
  }
}

async function convertImageToBase64(url) {
  try {
    const response = await fetch(`http://localhost:3002/convert-image?url=${encodeURIComponent(url)}`);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
    }

    const { base64 } = await response.json();
    return base64;
  } catch (error) {
    console.error("Error converting image to Base64:", error);
    return null;
  }
}

async function getSummaryFromGemini(text, apiKey, modelId) {
  try {
    // Send the text to the service worker
    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      text,
      apiKey,
      modelId,
    });
    return response.summary;
  } catch (error) {
    console.error("Error communicating with the service worker:", error);
    throw error;
  }
}

function removeHtmlTags(html) {
  return html.replace(/<[^>]*>/g, ''); // Remove all HTML tags
}



const getLoadingMessage = (actionType, mediaType) => {
  let loadingMessage = "";

  if (actionType === "summarize") {
    
      loadingMessage = chrome.i18n.getMessage("popup_summarizing");
   
  } else if (actionType === "translate") {
   
      loadingMessage = chrome.i18n.getMessage("popup_translating");
  
  } else {
    loadingMessage = chrome.i18n.getMessage("popup_processing");
  }

  return loadingMessage;
};

const main = async (useCache) => {
  let displayIntervalId = 0;
  let response = {};

  // Clear the content
  content = "";

  // Increment the result index
  resultIndex = (await chrome.storage.session.get({ resultIndex: -1 }))
    .resultIndex;
  resultIndex = (resultIndex + 1) % 10;
  await chrome.storage.session.set({ resultIndex: resultIndex });

  try {
    const { streaming } = await chrome.storage.local.get({ streaming: false });
    const languageModel = document.getElementById("languageModel").value;
    const languageCode = {
      en: "en",
    };
    let taskInputChunks = [];

    // Disable the buttons and input fields
    document.getElementById("content").textContent = "";
    document.getElementById("status").textContent = "";
    document.getElementById("run").disabled = true;
    document.getElementById("languageModel").disabled = true;
    document.getElementById("copy").disabled = true;
    document.getElementById("results").disabled = true;
    
    displayIntervalId = setInterval(
      displayLoadingMessage,
      300,
      "content",
      chrome.i18n.getMessage("popup_processing") // Ensure this key exists
    );
    // Extract the task information
    const { actionType, mediaType, taskInput } = await extractTaskInformation(
      languageCode
      
    );
    clearInterval(displayIntervalId);
    // Display a loading message
    displayIntervalId = setInterval(
      displayLoadingMessage,
      500,
      "content",
      getLoadingMessage(actionType, mediaType)
    );

    // Split the task input
    if (mediaType === "image") {
      taskInputChunks = [taskInput];
    } else if (typeof taskInput === "string") {
      taskInputChunks = await chrome.runtime.sendMessage({
        message: "chunk",
        actionType: actionType,
        taskInput: taskInput,
        languageModel: languageModel,
      });
    } else {
      taskInputChunks = [taskInput];
    }

    for (const taskInputChunk of taskInputChunks) {
      const { responseCacheQueue } = await chrome.storage.session.get({
        responseCacheQueue: [],
      });
      const cacheIdentifier = JSON.stringify({
        actionType,
        mediaType,
        taskInput: taskInputChunk,
        languageModel,
        languageCode,
      });
      const responseCache = responseCacheQueue.find(
        (item) => item.key === cacheIdentifier
      );

      if (useCache && responseCache) {
        // Use the cached response
        response = responseCache.value;
      } else {
        // Generate content
        const responsePromise = chrome.runtime.sendMessage({
          message: "generate",
          actionType: actionType,
          mediaType: mediaType,
          taskInput: taskInputChunk,
          languageModel: languageModel,
          languageCode: languageCode,
        });

        let streamIntervalId = 0;

        if (streaming) {
          // Stream the content
          streamIntervalId = setInterval(async () => {
            const { streamContent } = await chrome.storage.session.get(
              "streamContent"
            );

            if (streamContent) {
              const div = document.createElement("div");
              div.textContent = `${content}\n\n${streamContent}\n\n`;
              document.getElementById("content").innerHTML = DOMPurify.sanitize(
                marked.parse(div.innerHTML)
              );
            }
          }, 1000);
        }

        // Wait for responsePromise
        response = await responsePromise;

        if (streamIntervalId) {
          clearInterval(streamIntervalId);
        }
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (response.ok) {
        if (response.body.promptFeedback?.blockReason) {
          // The prompt was blocked
          content =
            `${chrome.i18n.getMessage("popup_prompt_blocked")} ` +
            `Reason: ${response.body.promptFeedback.blockReason}`;
          break;
        } else if (response.body.candidates?.[0].finishReason !== "STOP") {
          // The response was blocked
          content =
            `${chrome.i18n.getMessage("popup_response_blocked")} ` +
            `Reason: ${response.body.candidates[0].finishReason}`;
          break;
        } else if (response.body.candidates?.[0].content) {
          // A normal response was returned
          content += `${response.body.candidates[0].content.parts[0].text}\n\n`;
          const div = document.createElement("div");
          div.textContent = content;

          document.getElementById("content").innerHTML = DOMPurify.sanitize(
            marked.parse(div.innerHTML)
          );

          // Scroll to the bottom of the page
          if (!streaming) {
            window.scrollTo(0, document.body.scrollHeight);
          }
        } else {
          // The expected response was not returned
          content = chrome.i18n.getMessage("popup_unexpected_response");
          break;
        }
      } else {
        // A response error occurred
        content = `Error: ${response.status}\n\n${response.body.error.message}`;
        break;
      }
    }
  } catch (error) {
    content = chrome.i18n.getMessage("popup_miscellaneous_error");
    console.error(error);
  } finally {
    // Clear the loading message
    if (displayIntervalId) {
      clearInterval(displayIntervalId);
    }

    // Enable the buttons and input fields
    document.getElementById("status").textContent = "";
    document.getElementById("run").disabled = false;
    document.getElementById("languageModel").disabled = false;
    document.getElementById("copy").disabled = false;
    document.getElementById("results").disabled = false;

    // Convert the content from Markdown to HTML
    const div = document.createElement("div");
    div.textContent = content;
    document.getElementById("content").innerHTML = DOMPurify.sanitize(
      marked.parse(div.innerHTML)
    );

    // Save the content to the session storage
    await chrome.storage.session.set({
      [`r_${resultIndex}`]: {
        requestApiContent: response.requestApiContent,
        responseContent: content,
      },
    });
  }
};

const initialize = async () => {
  // Disable links when converting from Markdown to HTML
  marked.use({ renderer: { link: ({ text }) => text } });

  // Apply the theme
  applyTheme((await chrome.storage.local.get({ theme: "system" })).theme);

  // Load the language model template
  const languageModelTemplate = await loadTemplate("languageModelTemplate");
  document
    .getElementById("languageModelContainer")
    .appendChild(languageModelTemplate);

  // Set the text direction of the body
  document.body.setAttribute("dir", chrome.i18n.getMessage("@@bidi_dir"));

  // Restore the language model and language code from the local storage
  const { languageModel, languageCode } = await chrome.storage.local.get({
    languageModel: "2.0-flash",
    languageCode: "en",
  });
  document.getElementById("languageModel").value = languageModel;

  // Set the default language model if the language model is not set
  if (!document.getElementById("languageModel").value) {
    document.getElementById("languageModel").value = "2.0-flash";
  }

  main(true);
};

document.addEventListener("DOMContentLoaded", initialize);

document.getElementById("run").addEventListener("click", () => {
  main(false);
});

document.getElementById("copy").addEventListener("click", copyContent);

document.getElementById("results").addEventListener("click", () => {
  chrome.tabs.create(
    { url: chrome.runtime.getURL(`results.html?i=${resultIndex}`) },
    () => {
      window.close();
    }
  );
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage(() => {
    window.close();
  });
});