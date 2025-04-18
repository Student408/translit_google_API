import { SUPPORTED_LANGUAGES } from '../services/transliteration';

interface TransliterationSettings {
  enabled: boolean;
  language: string;
  autoReplace: boolean;
}

class PopupManager {
  private enabledToggle: HTMLInputElement;
  private languageSelect: HTMLSelectElement;
  private autoReplaceToggle: HTMLInputElement;
  
  constructor() {
    // Get DOM elements
    this.enabledToggle = document.getElementById('enableTransliteration') as HTMLInputElement;
    this.languageSelect = document.getElementById('languageSelect') as HTMLSelectElement;
    this.autoReplaceToggle = document.getElementById('autoReplace') as HTMLInputElement;
    
    this.initLanguageOptions();
    this.loadSettings();
    this.setupEventListeners();
  }
  
  private initLanguageOptions(): void {
    // Populate language dropdown
    Object.entries(SUPPORTED_LANGUAGES).forEach(([name, code]) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      this.languageSelect.appendChild(option);
    });
  }
  
  private async loadSettings(): Promise<void> {
    // Get settings from storage
    chrome.storage.sync.get('translitSettings', (data: {translitSettings?: TransliterationSettings}) => {
      const settings = data.translitSettings as TransliterationSettings;
      
      if (settings) {
        this.enabledToggle.checked = settings.enabled;
        this.languageSelect.value = settings.language;
        this.autoReplaceToggle.checked = settings.autoReplace;
      }
    });
  }
  
  private setupEventListeners(): void {
    // Add change listeners to all controls
    this.enabledToggle.addEventListener('change', this.saveSettings.bind(this));
    this.languageSelect.addEventListener('change', this.saveSettings.bind(this));
    this.autoReplaceToggle.addEventListener('change', this.saveSettings.bind(this));
  }
  
  private saveSettings(): void {
    const settings: TransliterationSettings = {
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
