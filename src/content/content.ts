/**
 * Content script that captures input in editable fields and performs transliteration
 */
interface TransliterationSettings {
  enabled: boolean;
  language: string;
  autoReplace: boolean;
}

interface TransliterationResponse {
  success: boolean;
  suggestions: string[];
}

interface ChromeMessage {
  action: string;
  settings?: TransliterationSettings;
  success?: boolean;
  suggestions?: string[];
  error?: string;
}

class TransliterationHandler {
  private settings: TransliterationSettings = {
    enabled: false,
    language: 'kn', // Default to Kannada
    autoReplace: false
  };
  
  private currentField: HTMLElement | null = null;
  private inputBuffer = '';
  private lastWordBoundary = 0;
  private suggestions: string[] = [];
  private suggestionBox: HTMLDivElement | null = null;
  
  constructor() {
    this.initEventListeners();
    this.loadSettings();
  }
  
  private async loadSettings(): Promise<void> {
    // Request settings from background script
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response: {settings?: TransliterationSettings}) => {
      if (response && response.settings) {
        this.settings = response.settings;
      }
    });
    
    // Listen for settings changes
    chrome.runtime.onMessage.addListener((message: ChromeMessage) => {
      if (message.action === 'settingsChanged') {
        if (message.settings) {
          this.settings = message.settings;
        }
      }
      return true;
    });
  }
  
  private initEventListeners(): void {
    // Listen for focus events on editable elements
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    
    // Listen for key events
    document.addEventListener('keydown', this.handleKeyDown.bind(this), true);
    
    // Handle clicks outside of suggestion box
    document.addEventListener('click', this.handleDocumentClick.bind(this));
  }
  
  private handleFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (this.isEditableElement(target)) {
      this.currentField = target;
    } else {
      this.currentField = null;
    }
  }
  
  private isEditableElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    return (
      (tagName === 'input' && 
       ['text', 'search', 'email', 'url'].includes((element as HTMLInputElement).type)) ||
      tagName === 'textarea' ||
      element.contentEditable === 'true'
    );
  }
  
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === ' ' && this.settings.enabled && this.currentField) {
      this.updateInputBuffer();
      this.processCurrentWord();
      event.preventDefault(); // prevent default space, we'll re‑insert after translation
    }
    // Handle special keys like Enter/Tab to select suggestion
    if (!this.suggestionBox || !this.suggestions.length) return;
    
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      // compute before-word context
      const before = this.inputBuffer.substring(0, this.lastWordBoundary);
      this.replaceWithSuggestion(before, this.suggestions[0]);
      this.removeSuggestionBox();
    } else if (event.key === 'Escape') {
      this.removeSuggestionBox();
    }
  }
  
  private async processCurrentWord(): Promise<void> {
    // lastWordBoundary already set by updateInputBuffer()
    const before = this.inputBuffer.substring(0, this.lastWordBoundary);
    const word = this.inputBuffer.substring(this.lastWordBoundary).trim();
    if (!word) return;

    // request transliteration
    chrome.runtime.sendMessage({
      action: 'transliterate',
      text: word,
      language: this.settings.language
    }, (response: TransliterationResponse) => {
      if (response?.success && response.suggestions.length) {
        // Store suggestions
        this.suggestions = response.suggestions;
        
        if (this.settings.autoReplace) {
          // Auto-replace with first suggestion
          this.replaceWithSuggestion(before, this.suggestions[0]);
        } else {
          // Show suggestion dropdown when auto-replace is disabled
          this.showSuggestions();
        }
      } else {
        // no suggestions: just insert a space
        this.replaceWithSuggestion(before, word, true);
      }
    });
  }
  
  private replaceWithSuggestion(beforeWord: string, suggestion: string, noTrans?: boolean): void {
    if (!this.currentField) return;
    const suffix = noTrans ? ' ' : ' '; // always add a space
    if (this.currentField.tagName === 'INPUT' || this.currentField.tagName === 'TEXTAREA') {
      const input = this.currentField as HTMLInputElement;
      input.value = beforeWord + suggestion + suffix;
      const pos = (beforeWord + suggestion + suffix).length;
      input.setSelectionRange(pos, pos);
    } else {
      const sel = window.getSelection();
      if (!sel) return;
      const nodeText = beforeWord + suggestion + suffix;
      this.currentField.textContent = nodeText;
      const range = document.createRange();
      range.setStart(this.currentField.firstChild!, nodeText.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  
  private showSuggestions(): void {
    if (!this.currentField || this.suggestions.length === 0) return;
    
    // Remove existing suggestion box if any
    this.removeSuggestionBox();
    
    // Create suggestion box
    this.suggestionBox = document.createElement('div');
    this.suggestionBox.className = 'transliteration-suggestions';
    this.suggestionBox.style.position = 'absolute';
    this.suggestionBox.style.zIndex = '10000';
    this.suggestionBox.style.backgroundColor = '#fff';
    this.suggestionBox.style.border = '1px solid #ccc';
    this.suggestionBox.style.borderRadius = '4px';
    this.suggestionBox.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    this.suggestionBox.style.padding = '5px 0';
    
    // Position the box near the current field
    const rect = this.currentField.getBoundingClientRect();
    this.suggestionBox.style.left = rect.left + 'px';
    this.suggestionBox.style.top = (rect.bottom + window.scrollY) + 'px';
    
    // Add suggestions
    this.suggestions.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = suggestion;
      item.style.padding = '5px 10px';
      item.style.cursor = 'pointer';
      
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f0f0f0';
      });
      
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = '';
      });
      
      item.addEventListener('click', () => {
        // compute before-word context
        this.updateInputBuffer();
        const before = this.inputBuffer.substring(0, this.lastWordBoundary);
        this.replaceWithSuggestion(before, suggestion);
        this.removeSuggestionBox();
      });
      
      if (this.suggestionBox) {
        this.suggestionBox.appendChild(item);
      }
    });
    
    // inject dark/light styles once
    if (!document.getElementById('translit-style')) {
      const style = document.createElement('style');
      style.id = 'translit-style';
      style.textContent = `
        .transliteration-suggestions {
          font-family: inherit;
        }
        @media (prefers-color-scheme: dark) {
          .transliteration-suggestions {
            background: #2e2e2e;
            color: #eee;
            border-color: #555;
          }
          .transliteration-suggestions .suggestion-item:hover {
            background: #3e3e3e;
          }
        }
        @media (prefers-color-scheme: light) {
          .transliteration-suggestions {
            background: #fff;
            color: #000;
            border-color: #ccc;
          }
          .transliteration-suggestions .suggestion-item:hover {
            background: #f0f0f0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(this.suggestionBox);
  }
  
  private handleDocumentClick(event: MouseEvent): void {
    if (this.suggestionBox && 
        event.target instanceof Node && 
        !this.suggestionBox.contains(event.target)) {
      this.removeSuggestionBox();
    }
  }
  
  private removeSuggestionBox(): void {
    if (this.suggestionBox && this.suggestionBox.parentNode) {
      this.suggestionBox.parentNode.removeChild(this.suggestionBox);
      this.suggestionBox = null;
    }
  }
  
  private updateInputBuffer(): void {
    if (!this.currentField) return;
    
    let text = '';
    if (this.currentField.tagName.toLowerCase() === 'input' || 
        this.currentField.tagName.toLowerCase() === 'textarea') {
      text = (this.currentField as HTMLInputElement).value;
    } else {
      text = this.currentField.textContent || '';
    }
    
    this.inputBuffer = text;
    
    // Find the last word boundary (space or beginning of input)
    const lastSpaceIndex = this.inputBuffer.lastIndexOf(' ');
    this.lastWordBoundary = lastSpaceIndex !== -1 ? lastSpaceIndex + 1 : 0;
  }
}

// Initialize the transliteration handler when the content script loads
new TransliterationHandler();
