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
    
    // Set default values
    this.enabledToggle.checked = true;
    this.autoReplaceToggle.checked = false;
    
    this.initLanguageOptions();
    this.loadSettings();
    this.setupEventListeners();
  }
  
  private initLanguageOptions(): void {
    // Clear existing options first
    this.languageSelect.innerHTML = '';
    
    // Populate language dropdown
    Object.entries(SUPPORTED_LANGUAGES).forEach(([name, code]) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      this.languageSelect.appendChild(option);
    });
    
    // Default to Kannada if no language is selected
    if (!this.languageSelect.value) {
      this.languageSelect.value = 'kn';
    }
    
    // Log to verify languages are loaded
    console.log('Language options initialized:', Object.keys(SUPPORTED_LANGUAGES).length);
  }
  
  private async loadSettings(): Promise<void> {
    // Get settings from storage with default values
    const defaultSettings: TransliterationSettings = {
      enabled: true,
      language: 'kn', // Default to Kannada
      autoReplace: false
    };

    try {
      // Get settings from storage
      chrome.storage.sync.get('translitSettings', (data: {translitSettings?: TransliterationSettings}) => {
        console.log('Loaded settings:', data.translitSettings);
        
        // Fallback to default if settings don't exist
        const settings = data.translitSettings || defaultSettings;
        
        // Apply settings to UI
        this.enabledToggle.checked = settings.enabled;
        
        // Ensure language code exists in our options
        if (settings.language && Object.values(SUPPORTED_LANGUAGES).includes(settings.language)) {
          this.languageSelect.value = settings.language;
        } else {
          this.languageSelect.value = 'kn'; // Default to Kannada
        }
        
        this.autoReplaceToggle.checked = settings.autoReplace;
        
        // Save initial settings if they don't exist
        if (!data.translitSettings) {
          this.saveSettings();
        }
      });
    } catch (error) {
      console.error('Error loading settings:', error);
      
      // Apply defaults on error
      this.enabledToggle.checked = defaultSettings.enabled;
      this.languageSelect.value = defaultSettings.language;
      this.autoReplaceToggle.checked = defaultSettings.autoReplace;
    }
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
    
    console.log('Saving settings:', settings);
    
    // Save to storage and notify background script
    chrome.storage.sync.set({ translitSettings: settings }, () => {
      // Check for errors
      if (chrome.runtime.lastError) {
        console.error('Error saving settings:', chrome.runtime.lastError);
        return;
      }
      
      chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings: settings
      });
    });
  }
}

// Initialize popup when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup DOM loaded, initializing...');
  new PopupManager();
});
