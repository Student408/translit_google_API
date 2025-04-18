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
      // Don't prevent default immediately, let processCurrentWord decide
      this.processCurrentWord(event); 
    }
    // Handle special keys like Enter/Tab to select suggestion
    if (this.suggestionBox && this.suggestions.length > 0) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        // compute before-word context
        const before = this.inputBuffer.substring(0, this.lastWordBoundary);
        this.replaceWithSuggestion(before, this.suggestions[0]);
        this.removeSuggestionBox();
      } else if (event.key === 'Escape') {
        event.preventDefault(); // Prevent closing modals etc.
        this.removeSuggestionBox();
      }
    }
  }
  
  private async processCurrentWord(event?: KeyboardEvent): Promise<void> {
    // lastWordBoundary already set by updateInputBuffer()
    const before = this.inputBuffer.substring(0, this.lastWordBoundary);
    const word = this.inputBuffer.substring(this.lastWordBoundary).trim();
    // If the word is empty after trimming, just let the space happen naturally
    if (!word) {
        // If no word, ensure suggestion box is closed
        this.removeSuggestionBox();
        return; 
    }

    // Prevent default space behavior only if we are going to handle it
    if (event) {
        event.preventDefault();
    }

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
        // no suggestions: insert the original word followed by a space
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
    
    // Remove existing suggestion box if any
    this.removeSuggestionBox();
    
    // Create suggestion box
    this.suggestionBox = document.createElement('div');
    this.suggestionBox.className = 'transliteration-suggestions';
    // Basic styles (moved positioning/layout here)
    this.suggestionBox.style.position = 'absolute';
    this.suggestionBox.style.zIndex = '10000';
    this.suggestionBox.style.padding = '5px 0';
    this.suggestionBox.style.borderRadius = '4px';
    this.suggestionBox.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    
    // Position the box near the current field
    const rect = this.currentField.getBoundingClientRect();
    this.suggestionBox.style.left = `${rect.left + window.scrollX}px`; // Use scrollX for correct positioning
    this.suggestionBox.style.top = `${rect.bottom + window.scrollY}px`; // Use scrollY
    this.suggestionBox.style.minWidth = `${rect.width}px`; // Match width of input field

    // Add suggestions
    this.suggestions.forEach((suggestion) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = suggestion;
      // Basic item styles
      item.style.padding = '5px 10px';
      item.style.cursor = 'pointer';
      item.style.whiteSpace = 'nowrap'; // Prevent wrapping

      item.addEventListener('click', () => {
        // compute before-word context
        this.updateInputBuffer(); 
        const before = this.inputBuffer.substring(0, this.lastWordBoundary);
        this.replaceWithSuggestion(before, suggestion);
        this.removeSuggestionBox();
      });
      
      // Add hover listeners directly (simpler than CSS hover for dynamic elements)
      item.addEventListener('mouseenter', () => {
        // Use computed style for hover background based on theme
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        item.style.backgroundColor = isDark ? '#3e3e3e' : '#f0f0f0';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = ''; // Revert on mouse leave
      });

      if (this.suggestionBox) {
        this.suggestionBox.appendChild(item);
      }
    });
    
    // inject dark/light styles once - Apply to items too
    if (!document.getElementById('translit-style')) {
      const style = document.createElement('style');
      style.id = 'translit-style';
      // Apply base styles and theme-specific overrides
      style.textContent = `
        .transliteration-suggestions {
          font-family: inherit; /* Inherit font from page */
          font-size: inherit;
          border: 1px solid; /* Border color set by theme */
        }
        .suggestion-item {
           /* Base item styles if needed */
        }
        @media (prefers-color-scheme: dark) {
          .transliteration-suggestions {
            background: #2e2e2e;
            color: #eee;
            border-color: #555;
          }
          /* Hover handled by JS, but keep this for potential future use */
          /* .suggestion-item:hover { background: #3e3e3e; } */
        }
        @media (prefers-color-scheme: light) {
          .transliteration-suggestions {
            background: #fff;
            color: #000;
            border-color: #ccc;
          }
          /* Hover handled by JS */
          /* .suggestion-item:hover { background: #f0f0f0; } */
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(this.suggestionBox);
    // Apply initial theme styles after appending
    this.applyThemeStyles(); 
  }

  // Helper function to apply theme styles dynamically
  private applyThemeStyles(): void {
    if (!this.suggestionBox) return;
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
        this.suggestionBox.style.backgroundColor = '#2e2e2e';
        this.suggestionBox.style.color = '#eee';
        this.suggestionBox.style.borderColor = '#555';
    } else {
        this.suggestionBox.style.backgroundColor = '#fff';
        this.suggestionBox.style.color = '#000';
        this.suggestionBox.style.borderColor = '#ccc';
    }
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
