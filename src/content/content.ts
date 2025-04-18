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
    // Only handle space for transliteration if enabled and in an editable field
    if (event.key === ' ' && this.settings.enabled && this.currentField) {
      this.updateInputBuffer();
      const before = this.inputBuffer.substring(0, this.lastWordBoundary);
      const word = this.inputBuffer.substring(this.lastWordBoundary).trim();
      if (word) {
        // Only preventDefault if we are going to process a word
        event.preventDefault();
        this.processCurrentWord();
        return;
      }
      // If no word, let the spacebar work as normal
    }
    // Handle special keys like Enter/Tab to select suggestion
    if (this.suggestionBox && this.suggestions.length > 0) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const before = this.inputBuffer.substring(0, this.lastWordBoundary);
        this.replaceWithSuggestion(before, this.suggestions[0]);
        this.removeSuggestionBox();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.removeSuggestionBox();
      }
    }
  }
  
  private async processCurrentWord(): Promise<void> {
    const before = this.inputBuffer.substring(0, this.lastWordBoundary);
    const word = this.inputBuffer.substring(this.lastWordBoundary).trim();
    if (!word) {
      this.removeSuggestionBox();
      return;
    }
    chrome.runtime.sendMessage({
      action: 'transliterate',
      text: word,
      language: this.settings.language
    }, (response: TransliterationResponse) => {
      if (response?.success && response.suggestions.length) {
        this.suggestions = response.suggestions;
        if (this.settings.autoReplace) {
          this.replaceWithSuggestion(before, this.suggestions[0]);
        } else {
          this.showSuggestions();
        }
      } else {
        this.replaceWithSuggestion(before, word, true);
      }
    });
  }
  
  private replaceWithSuggestion(beforeWord: string, suggestion: string, noTrans?: boolean): void {
    if (!this.currentField) return;
    // Always add a space after the word/suggestion
    const suffix = ' '; 
    const nodeText = beforeWord + suggestion + suffix;

    if (this.currentField.tagName.toLowerCase() === 'input' || 
        this.currentField.tagName.toLowerCase() === 'textarea') {
      const input = this.currentField as HTMLInputElement;
      const currentScroll = input.scrollTop; // Preserve scroll position
      input.value = nodeText;
      const pos = nodeText.length;
      input.setSelectionRange(pos, pos);
      input.scrollTop = currentScroll; // Restore scroll position
    } else { // contentEditable
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;

      const range = sel.getRangeAt(0);
      const textNode = this.currentField.firstChild;

      // More robust handling for contentEditable
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          // If the field only contains text, replace it
          textNode.textContent = nodeText;
          range.setStart(textNode, nodeText.length);
      } else {
          // If the field might contain other elements, clear and insert
          this.currentField.textContent = nodeText;
          const newTextNode = this.currentField.firstChild;
          if (newTextNode) {
              range.setStart(newTextNode, nodeText.length);
          }
      }
      
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      // Ensure the field scrolls into view if necessary
      this.currentField.focus(); 
    }
    // Update buffer after replacement
    this.updateInputBuffer(); 
  }
  
  private showSuggestions(): void {
    if (!this.currentField || this.suggestions.length === 0) return;
    this.removeSuggestionBox();
    this.suggestionBox = document.createElement('div');
    this.suggestionBox.className = 'transliteration-suggestions';
    this.suggestionBox.style.position = 'absolute';
    this.suggestionBox.style.zIndex = '10000';
    this.suggestionBox.style.padding = '5px 0';
    this.suggestionBox.style.borderRadius = '4px';
    this.suggestionBox.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    const rect = this.currentField.getBoundingClientRect();
    this.suggestionBox.style.left = `${rect.left + window.scrollX}px`;
    this.suggestionBox.style.top = `${rect.bottom + window.scrollY}px`;
    this.suggestionBox.style.minWidth = `${rect.width}px`;

    this.suggestions.forEach((suggestion) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = suggestion;
      item.style.padding = '5px 10px';
      item.style.cursor = 'pointer';
      item.style.whiteSpace = 'nowrap';
      item.addEventListener('click', () => {
        this.updateInputBuffer();
        const before = this.inputBuffer.substring(0, this.lastWordBoundary);
        this.replaceWithSuggestion(before, suggestion);
        this.removeSuggestionBox();
      });
      item.addEventListener('mouseenter', () => {
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        item.style.backgroundColor = isDark ? '#3e3e3e' : '#f0f0f0';
        item.style.color = isDark ? '#eee' : '#000';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = '';
        item.style.color = '';
      });
      if (this.suggestionBox) {
        this.suggestionBox.appendChild(item);
      }
    });

    // inject dark/light styles once - now also styles .suggestion-item for both modes
    if (!document.getElementById('translit-style')) {
      const style = document.createElement('style');
      style.id = 'translit-style';
      style.textContent = `
        .transliteration-suggestions {
          font-family: inherit;
          font-size: inherit;
          border: 1px solid;
        }
        .suggestion-item {
          transition: background 0.15s, color 0.15s;
        }
        @media (prefers-color-scheme: dark) {
          .transliteration-suggestions {
            background: #2e2e2e;
            color: #eee;
            border-color: #555;
          }
          .suggestion-item {
            background: #2e2e2e;
            color: #eee;
          }
        }
        @media (prefers-color-scheme: light) {
          .transliteration-suggestions {
            background: #fff;
            color: #000;
            border-color: #ccc;
          }
          .suggestion-item {
            background: #fff;
            color: #000;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(this.suggestionBox);
    this.applyThemeStyles();
  }

  private applyThemeStyles(): void {
    if (!this.suggestionBox) return;
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.suggestionBox.style.backgroundColor = isDark ? '#2e2e2e' : '#fff';
    this.suggestionBox.style.color = isDark ? '#eee' : '#000';
    this.suggestionBox.style.borderColor = isDark ? '#555' : '#ccc';
    // Also update suggestion items
    Array.from(this.suggestionBox.getElementsByClassName('suggestion-item')).forEach((item) => {
      const el = item as HTMLElement;
      el.style.backgroundColor = isDark ? '#2e2e2e' : '#fff';
      el.style.color = isDark ? '#eee' : '#000';
    });
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
