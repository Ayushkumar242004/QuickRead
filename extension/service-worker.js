import { getModelId, generateContent, streamGenerateContent } from "./utils.js";

const getSystemPrompt = async (actionType, mediaType, languageCode, taskInputLength) => {
  const languageNames = {
    en: "English",
  };

 
  const numItems = Math.min(10, 3 + Math.floor(taskInputLength / 2000));
  let systemPrompt = "";

  if (actionType === "summarize") {
    if (mediaType === "image") {
     
      systemPrompt = "Analyze the image and summarize its key details as a structured Markdown numbered list. Ensure each point is clear, concise, and action-oriented. Respond only with the list in " + 
        `${languageNames[languageCode]}.\n` +
        "Format:\n\n" +
        "**Key Observations:**\n\n" +
        "1. **[Main Element]:** [Brief Description]\n" +
        "2. **[Another Key Detail]:** [Brief Explanation]\n" +
        "3. **[Contextual Insight]:** [Additional Information]\n\n" +
        "4. **[Image Description]:** [Image Information]\n\n" +
        "Ensure the response provides insights based on visible elements in the image.";
        
      } 
   
    // else {
    //   console.log("pdf");
    //   systemPrompt = `Summarize the entire text as a well-structured Markdown numbered list with key takeaways. The response should be clear, concise, and action-oriented in ` +
    //     `${languageNames[languageCode]}.\n` +
    //     "Format:\n\n" +
    //     "**Summary:**\n\n" +
    //     "1. **[Key Topic]:** [Short Explanation]\n" +
    //     "2. **[Main Insight]:** [Brief Description]\n" +
    //     "3. **[Supporting Detail]:** [Additional Information]\n\n" +
    //     `Ensure the summary is limited to ${numItems} key points for clarity and readability.`;
    // }
  }
  

  return systemPrompt;
};

const getCharacterLimit = async (apiKey, modelId, actionType) => {
  // Limit on the number of characters handled at one time
  
  const characterLimits = {
    "gemini-2.0-flash": {
      summarize: 786432,
      translate: 8192,
      noTextCustom: 786432,
      textCustom: 786432
    },
    "gemini-1.5-pro": {
      summarize: 1500000,
      translate: 8192,
      noTextCustom: 1500000,
      textCustom: 1500000
    },
    "gemini-1.5-flash": {
      summarize: 750000,
      translate: 8192,
      noTextCustom: 750000,
      textCustom: 750000
    },
    "gemini-1.5-flash-8b": {
      summarize: 750000,
      translate: 8192,
      noTextCustom: 750000,
      textCustom: 750000
    },
    "gemini-2.0-flash-lite-preview-02-05": {
      summarize: 786432,
      translate: 8192,
      noTextCustom: 786432,
      textCustom: 786432
    },
    "gemini-2.0-pro-exp-02-05": {
      summarize: 1572864,
      translate: 8192,
      noTextCustom: 1572864,
      textCustom: 1572864
    },
    "gemini-2.0-flash-exp": {
      summarize: 786432,
      translate: 8192,
      noTextCustom: 786432,
      textCustom: 786432
    }
  };

  if (!characterLimits[modelId]) {
    // Get the character limits from the API
    const characterLimitsFromAPI = {
      summarize: 8192,
      translate: 8192,
      noTextCustom: 8192,
      textCustom: 8192
    };

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}`, {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey
        }
      });

      if (response.ok) {
        const json = await response.json();

        characterLimitsFromAPI.summarize = json.inputTokenLimit * 3 / 4;
        characterLimitsFromAPI.translate = json.outputTokenLimit;
        characterLimitsFromAPI.noTextCustom = json.inputTokenLimit * 3 / 4;
        characterLimitsFromAPI.textCustom = json.inputTokenLimit * 3 / 4;
      } else {
        console.log(await response.text());
      }
    } catch (error) {
      console.error(error);
    }

    return characterLimitsFromAPI[actionType];
  } else {
    return characterLimits[modelId][actionType];
  }
};

const chunkText = (text, chunkSize) => {
  const chunks = [];
  // ।: U+0964 Devanagari Danda
  const sentenceBreaks = ["\n\n", "।", "。", "．", ".", "\n", " "];
  let remainingText = text.replace(/\r\n?/g, "\n");

  while (remainingText.length > chunkSize) {
    const currentChunk = remainingText.substring(0, chunkSize);
    let index = -1;

    // Look for sentence breaks at 80% of the chunk size or later
    for (const sentenceBreak of sentenceBreaks) {
      index = currentChunk.indexOf(sentenceBreak, Math.floor(chunkSize * 0.8));

      if (index !== -1) {
        index += sentenceBreak.length;
        break;
      }
    }

    if (index === -1) {
      index = chunkSize;
    }

    chunks.push(remainingText.substring(0, index));
    remainingText = remainingText.substring(index);
  }

  chunks.push(remainingText);
  return chunks;
};

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    if (request.message === "chunk") {
      // Split the task input
      const { actionType, taskInput, languageModel } = request;
      const { apiKey, userModelId } = await chrome.storage.local.get({ apiKey: "", userModelId: "gemini-2.0-flash-001" });
      const modelId = getModelId(languageModel, userModelId);
      const chunkSize = await getCharacterLimit(apiKey, modelId, actionType);
      // console.log(`Chunk size: ${chunkSize}`);
      const taskInputChunks = chunkText(taskInput, chunkSize);
      sendResponse(taskInputChunks);
    } else if (request.message === "generate") {
      // Generate content
      const { actionType, mediaType, taskInput, languageModel, languageCode } = request;
      const { apiKey, streaming, userModelId } = await chrome.storage.local.get({ apiKey: "", streaming: false, userModelId: "gemini-2.0-flash-001" });
      const modelId = getModelId(languageModel, userModelId);

      const systemPrompt = await getSystemPrompt(
        actionType,
        mediaType,
        languageCode,
        taskInput.length
      );

      let apiContent = {};
      let response = null;

      if (mediaType === "image") {
        const [mediaInfo, mediaData] = taskInput.split(",");
        const mediaType = mediaInfo.split(":")[1].split(";")[0];

        apiContent = {
          role: "user",
          parts: [
            { text: systemPrompt },
            {
              inline_data: {
                mime_type: mediaType,
                data: mediaData
              }
            }
          ]
        };
      } else {
        apiContent = {
          role: "user",
          parts: [{ text: systemPrompt + "\nText:\n" + taskInput }]
        };
      }

      if (streaming) {
        response = await streamGenerateContent(apiKey, modelId, [apiContent]);
      } else {
        response = await generateContent(apiKey, modelId, [apiContent]);
      }

      // Add the system prompt and the user input to the response
      response.requestApiContent = apiContent;

      if (response.ok) {
        // Update the cache
        const { responseCacheQueue } = await chrome.storage.session.get({ responseCacheQueue: [] });
        const responseCacheKey = JSON.stringify({ actionType, mediaType, taskInput, languageModel, languageCode });

        const updatedQueue = responseCacheQueue
          .filter(item => item.key !== responseCacheKey)
          .concat({ key: responseCacheKey, value: response })
          .slice(-10);

        await chrome.storage.session.set({ responseCacheQueue: updatedQueue });
      }

      sendResponse(response);
    }
  })();

  return true;
});



// Listen for messages from the popup or other parts of the extension
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    try {
      const { text, apiKey, modelId } = request;

      // Prepare the API contents for summarization
      const apiContents = [
        {
          role: 'user',
          parts: [
            {
              text: `Summarize the following text in markdown with detailed, action-oriented bullet points. Ensure the response follows this exact structured format:
      
      Okay, here's a breakdown of the text into more granular, action-oriented bullet points, focusing on understanding and application:
      
      **I. [Main Topic]**
      
      *   **[Key Concept]:** [Short Explanation]
      *   **[Another Key Concept]:** [Short Explanation]
      
      **II. [Next Section]**
      
      *   **[Concept]:** [Explanation]
      *   **[Subtopic]:** [Explanation]
      
      Continue structuring the response using numbered sections (I, II, III, etc.) and ensure each section contains clearly labeled bullet points that define, explain, and provide actionable insights.
      
      Here is the text to summarize:\n\n${text}`
            },
          ],
        },
      ];
      
      // Call the Gemini API using the generateContent function
      const result = await generateContent(apiKey, modelId, apiContents);
      
      if (result.ok) {
        // Extract the summary from the API response
        
        const summary = result.body.candidates[0].content.parts[0].text;
       
        sendResponse({ summary });
        

      } else {
        // Handle API errors
        console.error("Gemini API Error:", result.body.error.message);
        sendResponse({ error: result.body.error.message });
      }
    } catch (error) {
      console.error("Error in service worker:", error);
      sendResponse({ error: error.message });
    }
    // Return true to indicate that the response will be sent asynchronously
    return true;
  }
});



chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === 'analyzeImage') {
    try {
    
       const { apiContents, apiKey, modelId } = request;
      // Call the Gemini API using the generateContent function
      const result = await generateContent(apiKey, modelId, apiContents);
      
      if (result.ok) {
        // Extract the summary from the API response
        
        const summary = result.body.candidates[0].content.parts[0].text;
       
        sendResponse({ summary });
        

      } else {
        // Handle API errors
        console.error("Gemini API Error:", result.body.error.message);
        sendResponse({ error: result.body.error.message });
      }
    } catch (error) {
      console.error("Error in service worker:", error);
      sendResponse({ error: error.message });
    }
    // Return true to indicate that the response will be sent asynchronously
    return true;
  }
});