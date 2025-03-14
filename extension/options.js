import { applyTheme, loadTemplate } from "./utils.js";

const restoreOptions = async () => {
  const options = await chrome.storage.local.get({
    apiKey: "",
    languageModel: "2.0-flash",
    userModelId: "gemini-2.0-flash-001",
    noTextAction: "summarize",
    textAction: "summarize",
    theme: "system"
  });

  document.getElementById("apiKey").value = options.apiKey;
  document.getElementById("languageModel").value = options.languageModel;
  document.getElementById("userModelId").value = options.userModelId;
  document.getElementById("theme").value = options.theme;

  // Set the default language model if the language model is not set
  if (!document.getElementById("languageModel").value) {
    document.getElementById("languageModel").value = "2.0-flash";
  }
};

const saveOptions = async () => {
  const options = {
    apiKey: document.getElementById("apiKey").value,
    languageModel: document.getElementById("languageModel").value,
    userModelId: document.getElementById("userModelId").value,
    noTextAction: document.querySelector('input[name="noTextAction"]:checked').value,
    textAction: document.querySelector('input[name="textAction"]:checked').value,
    theme: document.getElementById("theme").value
  };

  await chrome.storage.local.set(options);
  await chrome.storage.session.set({ responseCacheQueue: [] });
  const status = document.getElementById("save");
  status.textContent = chrome.i18n.getMessage("options_saved");
  setTimeout(() => status.textContent = "Save Options", 2000);
  applyTheme((await chrome.storage.local.get({ theme: "system" })).theme);
};

const initialize = async () => {
  // Apply the theme
  applyTheme((await chrome.storage.local.get({ theme: "system" })).theme);


  // Load the language model template
  const languageModelTemplate = await loadTemplate("languageModelTemplate");
  document.getElementById("languageModelContainer").appendChild(languageModelTemplate);

  // Set the text direction of the body
  document.body.setAttribute("dir", chrome.i18n.getMessage("@@bidi_dir"));

  // Set the text of elements with the data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = chrome.i18n.getMessage(element.getAttribute("data-i18n"));
  });

  restoreOptions();
};

document.addEventListener("DOMContentLoaded", initialize);
document.getElementById("save").addEventListener("click", saveOptions);
