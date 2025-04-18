import { TransliterationService, SUPPORTED_LANGUAGES } from '../services/transliteration';

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

// Default settings
const DEFAULT_SETTINGS: TransliterationSettings = {
  enabled: true,
  language: 'kn', // Default to Kannada
  autoReplace: false
};

// Initialize settings on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated, initializing settings...');
  
  // Check if settings exist, if not initialize them
  chrome.storage.sync.get('translitSettings', (data) => {
    if (!data.translitSettings) {
      console.log('No settings found, initializing with defaults');
      chrome.storage.sync.set({ translitSettings: DEFAULT_SETTINGS });
    } else {
      console.log('Existing settings found:', data.translitSettings);
    }
  });
});

// Initialize settings in storage if not already set
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('translitSettings', (data: {translitSettings?: TransliterationSettings}) => {
    if (!data.translitSettings) {
      chrome.storage.sync.set({ translitSettings: DEFAULT_SETTINGS });
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
