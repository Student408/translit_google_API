import { SUPPORTED_LANGUAGES } from '../services/transliteration';
class PopupManager {
    constructor() {
        // Get DOM elements
        this.enabledToggle = document.getElementById('enableTransliteration');
        this.languageSelect = document.getElementById('languageSelect');
        this.autoReplaceToggle = document.getElementById('autoReplace');
        this.initLanguageOptions();
        this.loadSettings();
        this.setupEventListeners();
    }
    initLanguageOptions() {
        // Populate language dropdown
        Object.entries(SUPPORTED_LANGUAGES).forEach(([name, code]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = name;
            this.languageSelect.appendChild(option);
        });
    }
    async loadSettings() {
        // Get settings from storage
        chrome.storage.sync.get('translitSettings', (data) => {
            const settings = data.translitSettings;
            if (settings) {
                this.enabledToggle.checked = settings.enabled;
                this.languageSelect.value = settings.language;
                this.autoReplaceToggle.checked = settings.autoReplace;
            }
        });
    }
    setupEventListeners() {
        // Add change listeners to all controls
        this.enabledToggle.addEventListener('change', this.saveSettings.bind(this));
        this.languageSelect.addEventListener('change', this.saveSettings.bind(this));
        this.autoReplaceToggle.addEventListener('change', this.saveSettings.bind(this));
    }
    saveSettings() {
        const settings = {
            enabled: this.enabledToggle.checked,
            language: this.languageSelect.value,
            autoReplace: this.autoReplaceToggle.checked
        };
        // Save to storage and notify background script
        chrome.runtime.sendMessage({
            action: 'updateSettings',
            settings: settings
        });
    }
}
// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});
