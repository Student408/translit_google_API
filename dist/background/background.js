import { TransliterationService } from '../services/transliteration';
// Default settings
const DEFAULT_SETTINGS = {
    enabled: true,
    language: 'kn', // Default to Kannada
    autoReplace: false
};
// Initialize settings in storage if not already set
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get('translitSettings', (data) => {
        if (!data.translitSettings) {
            chrome.storage.sync.set({ translitSettings: DEFAULT_SETTINGS });
        }
    });
});
// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getSettings') {
        chrome.storage.sync.get('translitSettings', (data) => {
            sendResponse({ settings: data.translitSettings || DEFAULT_SETTINGS });
        });
        return true; // Required for async response
    }
    else if (message.action === 'updateSettings') {
        chrome.storage.sync.set({ translitSettings: message.settings }, () => {
            // Notify all tabs about the settings change
            chrome.tabs.query({}, (tabs) => {
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
