/**
 * Background script for the transliteration extension
 */

// Add missing interfaces
interface TransliterationSettings {
  enabled: boolean;
  language: string;
  autoReplace: boolean;
}

interface TransliterationMessage {
  action: string;
  text?: string;
  language?: string;
  settings?: TransliterationSettings;
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
