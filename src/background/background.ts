/**
 * Background script for the transliteration extension
 */

// Add missing interfaces
interface TransliterationSettings {
  enabled: boolean;
  language: string;
  autoReplace: boolean;
}

// Updated interface to include reverse transliteration
interface TransliterationMessage {
  action: string;
  text?: string;
  language?: string;
  settings?: TransliterationSettings;
  sourceLanguage?: string;
}

// Use a namespace to avoid variable conflict with popup.ts
namespace BackgroundModule {
  // Map of supported languages with their codes
  export const SUPPORTED_LANGUAGES_MAP = {
    "Kannada": "kn",
    "Hindi": "hi",
    "Bengali": "bn",
    "Tamil": "ta",
    "Telugu": "te",
    "Malayalam": "ml",
    "Marathi": "mr",
    "Gujarati": "gu",
    "Nepali": "ne",
    "Urdu": "ur",
    "Sanskrit": "sa",
    "Arabic": "ar",
    "Persian": "fa",
    "Russian": "ru",
    "Japanese": "ja",
    "Korean": "ko",
    "Chinese": "zh"
  };
}

// Include service code directly to avoid import issues
interface TransliterationOptions {
  text: string;
  language: string;
  numSuggestions?: number;
}

interface TransliterationResponse {
  success: boolean;
  suggestions: string[];
  error?: string;
}

// Transliteration service class
class TransliterationService {
  /**
   * Gets transliteration suggestions from Google Input Tools API
   */
  public static async getTransliteration(options: TransliterationOptions): Promise<TransliterationResponse> {
    if (!options.text) {
      return { success: true, suggestions: [] };
    }

    const apiUrl = "https://inputtools.google.com/request";
    const params = new URLSearchParams({
      text: options.text,
      itc: `${options.language}-t-i0-und`, // Language code with transliteration format
      num: String(options.numSuggestions || 5),
      cp: "0",
      cs: "1", 
      ie: "utf-8",
      oe: "utf-8",
      app: "demopage"
    });

    try {
      const response = await fetch(`${apiUrl}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data[0] === "SUCCESS" && data[1] && data[1].length > 0) {
        return {
          success: true,
          suggestions: data[1][0][1] || []
        };
      } else {
        return {
          success: true,
          suggestions: []
        };
      }
    } catch (error) {
      console.error("Transliteration API error:", error);
      return {
        success: false,
        suggestions: [],
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
}

// Default settings
const DEFAULT_SETTINGS: TransliterationSettings = {
  enabled: true,
  language: 'kn', // Default to Kannada
  autoReplace: false
};

// Root context menu ID
const TRANSLITERATE_MENU_ID = "transliterateSelection";
const REVERSE_TRANSLITERATE_MENU_ID = "reverseTransliterateSelection";

// Language detection related constants
const SCRIPT_TO_LANGUAGE = {
  // Devanagari
  '\u0900-\u097F': ['hi', 'sa', 'mr', 'ne'],
  // Bengali
  '\u0980-\u09FF': ['bn'],
  // Gurmukhi (Punjabi)
  '\u0A00-\u0A7F': ['pa'],
  // Gujarati
  '\u0A80-\u0AFF': ['gu'],
  // Oriya
  '\u0B00-\u0B7F': ['or'],
  // Tamil
  '\u0B80-\u0BFF': ['ta'],
  // Telugu
  '\u0C00-\u0C7F': ['te'],
  // Kannada
  '\u0C80-\u0CFF': ['kn'],
  // Malayalam
  '\u0D00-\u0D7F': ['ml'],
  // Sinhala
  '\u0D80-\u0DFF': ['si'],
  // Thai
  '\u0E00-\u0E7F': ['th'],
  // Lao
  '\u0E80-\u0EFF': ['lo'],
  // Tibetan
  '\u0F00-\u0FFF': ['bo'],
  // Myanmar
  '\u1000-\u109F': ['my'],
  // Georgian
  '\u10A0-\u10FF': ['ka'],
  // Hangul (Korean)
  '\uAC00-\uD7AF': ['ko'],
  // Japanese Hiragana and Katakana
  '\u3040-\u30FF': ['ja'],
  // CJK Unified Ideographs (Chinese, Japanese, Korean)
  '\u4E00-\u9FFF': ['zh', 'ja', 'ko'],
  // Cyrillic
  '\u0400-\u04FF': ['ru', 'uk', 'bg', 'sr', 'mk'],
  // Arabic
  '\u0600-\u06FF': ['ar', 'fa', 'ur'],
  // Hebrew
  '\u0590-\u05FF': ['he'],
  // Thai
  '\u0E00-\u0E7F': ['th']
};

// Function to detect script of text
function detectLanguageFromScript(text: string): string[] | null {
  for (const [scriptRange, languages] of Object.entries(SCRIPT_TO_LANGUAGE)) {
    const regex = new RegExp(`[${scriptRange}]`);
    if (regex.test(text)) {
      return languages;
    }
  }
  return null;
}

// Function to create or update the context menus
function setupContextMenus() {
  // Clear previous menus
  chrome.contextMenus.removeAll(() => {
    // Create the main menu for normal transliteration (Latin to non-Latin)
    chrome.contextMenus.create({
      id: TRANSLITERATE_MENU_ID,
      title: "Transliterate to...",
      contexts: ["selection"]
    });
    
    // Create submenu items for each supported language
    Object.entries(BackgroundModule.SUPPORTED_LANGUAGES_MAP).forEach(([name, code]) => {
      chrome.contextMenus.create({
        id: `${TRANSLITERATE_MENU_ID}_${code}`,
        parentId: TRANSLITERATE_MENU_ID,
        title: name,
        contexts: ["selection"]
      });
    });
    
    // Create the reverse menu (non-Latin to Latin)
    chrome.contextMenus.create({
      id: REVERSE_TRANSLITERATE_MENU_ID,
      title: "Transliterate to English",
      contexts: ["selection"]
    });
    
    // Add submenu for manual language selection
    chrome.contextMenus.create({
      id: `${REVERSE_TRANSLITERATE_MENU_ID}_select`,
      parentId: REVERSE_TRANSLITERATE_MENU_ID,
      title: "Select source language...",
      contexts: ["selection"]
    });
    
    // Add language options as children of the select source menu
    Object.entries(BackgroundModule.SUPPORTED_LANGUAGES_MAP).forEach(([name, code]) => {
      chrome.contextMenus.create({
        id: `${REVERSE_TRANSLITERATE_MENU_ID}_${code}`,
        parentId: `${REVERSE_TRANSLITERATE_MENU_ID}_select`,
        title: name,
        contexts: ["selection"]
      });
    });
  });
}

// Initialize settings and context menu on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated, initializing settings and context menus...');
  
  // Check if settings exist, if not initialize them
  chrome.storage.sync.get('translitSettings', (data: {translitSettings?: TransliterationSettings}) => {
    if (!data.translitSettings) {
      console.log('No settings found, initializing with defaults');
      chrome.storage.sync.set({ translitSettings: DEFAULT_SETTINGS });
    } else {
      console.log('Existing settings found:', data.translitSettings);
    }
  });

  // Setup the context menus
  setupContextMenus();
});

// Ensure context menus exist on browser startup
chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

// Handle reverse transliteration (non-Latin to Latin)
async function reverseTransliterate(text: string, sourceLanguage: string, tabId: number): Promise<void> {
  try {
    // Use Google Translate API for reverse transliteration
    const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLanguage}&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    // The response format includes both translation and transliteration
    // [[[translation, source, null, null]], null, source-language, null, null, null, confidence, null, [[transliteration, null, null, null]]]
    // We're interested in the transliteration part if available
    let transliteration = '';
    
    if (data && data[0] && data[0][0]) {
      // Get translation as fallback
      transliteration = data[0][0][0];
      
      // Try to get transliteration if available
      if (data[8] && data[8][0]) {
        transliteration = data[8][0][0];
      }
    }
    
    if (transliteration) {
      // Send to content script to replace the selection
      chrome.tabs.sendMessage(tabId, {
        action: 'replaceSelection',
        suggestion: transliteration
      }).catch(error => {
        console.warn("Could not send message to content script:", error);
      });
    } else {
      console.warn("No transliteration result found");
    }
  } catch (error) {
    console.error("Error in reverse transliteration:", error);
  }
}

// Initialize settings on extension install/update - remove duplicate listener and fix typing
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated, initializing settings...');
  
  // Check if settings exist, if not initialize them
  chrome.storage.sync.get('translitSettings', (data: {translitSettings?: TransliterationSettings}) => {
    if (!data.translitSettings) {
      console.log('No settings found, initializing with defaults');
      chrome.storage.sync.set({ translitSettings: DEFAULT_SETTINGS });
    } else {
      console.log('Existing settings found:', data.translitSettings);
    }
  });
});

// Ensure context menus exist on browser startup
chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((
  message: TransliterationMessage, 
  sender: chrome.runtime.MessageSender, 
  sendResponse: (response?: any) => void
) => {
  if (message.action === 'getSettings') {
    chrome.storage.sync.get('translitSettings', (data: {translitSettings?: TransliterationSettings}) => {
      sendResponse({ settings: data.translitSettings || DEFAULT_SETTINGS });
    });
    return true; // Required for async response
  }
  
  else if (message.action === 'updateSettings') {
    chrome.storage.sync.set({ translitSettings: message.settings }, () => {
      // Notify all tabs about the settings change
      chrome.tabs.query({}, (tabs: chrome.tabs.Tab[]) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              action: 'settingsChanged',
              settings: message.settings
            }).catch(() => {
              // Ignore errors for inactive tabs
            });
          }
        });
      });
      sendResponse({ success: true });
    });
    return true;
  }
  
  else if (message.action === 'transliterate') {
    (async () => {
      const result = await TransliterationService.getTransliteration({
        text: message.text || '',
        language: message.language || 'kn'
      });
      sendResponse(result);
    })();
    return true;
  }
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText || !tab?.id) return;
  
  const menuId = info.menuItemId as string;
  const selectedText = info.selectionText;
  const tabId = tab.id;
  
  // Handle normal transliteration (Latin to non-Latin)
  if (menuId.startsWith(TRANSLITERATE_MENU_ID + '_')) {
    const languageCode = menuId.split('_')[1];
    
    (async () => {
      const result = await TransliterationService.getTransliteration({
        text: selectedText,
        language: languageCode
      });

      if (result.success && result.suggestions.length > 0) {
        chrome.tabs.sendMessage(tabId, {
          action: 'replaceSelection',
          suggestion: result.suggestions[0]
        }).catch(error => console.warn("Could not send message to content script:", error));
      }
    })();
  } 
  // Handle the main reverse transliteration option (auto-detect)
  else if (menuId === REVERSE_TRANSLITERATE_MENU_ID) {
    // Try to auto-detect language from script
    const detectedLanguages = detectLanguageFromScript(selectedText);
    
    if (detectedLanguages && detectedLanguages.length > 0) {
      // Use the first detected language
      reverseTransliterate(selectedText, detectedLanguages[0], tabId);
    } else {
      // If detection fails, notify user to select language manually
      chrome.tabs.sendMessage(tabId, {
        action: 'showLanguageSelectionNotification'
      }).catch(error => console.warn("Could not send notification message:", error));
    }
  }
  // Handle manually selected language for reverse transliteration
  else if (menuId.startsWith(REVERSE_TRANSLITERATE_MENU_ID + '_') && 
           !menuId.endsWith('_select')) {
    const languageCode = menuId.split('_')[1];
    reverseTransliterate(selectedText, languageCode, tabId);
  }
});
