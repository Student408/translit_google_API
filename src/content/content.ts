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
    
    // Listen for input events
    document.addEventListener('input', this.handleInput.bind(this), true);
    
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
  
  private handleInput(event: Event): void {
    if (!this.settings.enabled || !this.currentField) return;
    
    const target = event.target as HTMLElement;
    if (target !== this.currentField) return;
    
    this.updateInputBuffer();
    this.processCurrentWord();
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
  
  private async processCurrentWord(): Promise<void> {
    if (this.inputBuffer.length <= this.lastWordBoundary) return;
    
    const currentWord = this.inputBuffer.substring(this.lastWordBoundary);
    if (!currentWord.trim()) return;
    
    // Only transliterate if we have a valid word
    if (/\w+/.test(currentWord)) {
      try {
        // Request transliteration from background script
        chrome.runtime.sendMessage({
          action: 'transliterate',
          text: currentWord,
          language: this.settings.language
        }, (response: TransliterationResponse) => {
          if (response && response.success) {
            this.suggestions = response.suggestions;
            if (this.suggestions.length > 0) {
              if (this.settings.autoReplace) {
                this.replaceWithSuggestion(this.suggestions[0]);
              } else {
                this.showSuggestions();
              }
            }
          }
        });
      } catch (error) {
        console.error('Error sending message to background script:', error);
      }
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
        this.replaceWithSuggestion(suggestion);
        this.removeSuggestionBox();
      });
      
      if (this.suggestionBox) {
        this.suggestionBox.appendChild(item);
      }
    });
    
    document.body.appendChild(this.suggestionBox);
  }
  
  private replaceWithSuggestion(suggestion: string): void {
    if (!this.currentField) return;
    
    if (this.currentField.tagName.toLowerCase() === 'input' || 
        this.currentField.tagName.toLowerCase() === 'textarea') {
      const input = this.currentField as HTMLInputElement;
      const beforeWord = this.inputBuffer.substring(0, this.lastWordBoundary);
      const afterWord = this.inputBuffer.substring(input.value.length);
      input.value = beforeWord + suggestion + afterWord;
      
      // Set cursor position after the inserted suggestion
      input.selectionStart = input.selectionEnd = beforeWord.length + suggestion.length;
    } else {
      // For contentEditable elements
      const range = document.createRange();
      const sel = window.getSelection();
      
      // Get current selection/cursor position
      if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        const beforeWord = this.inputBuffer.substring(0, this.lastWordBoundary);
        const afterWord = this.inputBuffer.substring(currentRange.startOffset);
        
        // Fix the null check issue
        if (this.currentField.firstChild) {
          this.currentField.textContent = beforeWord + suggestion + afterWord;
          
          // Reset cursor position
          range.setStart(this.currentField.firstChild, beforeWord.length + suggestion.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // Handle case where firstChild is null
          this.currentField.textContent = beforeWord + suggestion + afterWord;
          
          // Create a text node if needed
          if (!this.currentField.firstChild) {
            this.currentField.appendChild(document.createTextNode(beforeWord + suggestion + afterWord));
          }
          
          // Then set selection
          if (this.currentField.firstChild) {
            range.setStart(this.currentField.firstChild, beforeWord.length + suggestion.length);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }
    }
  }
  
  private handleKeyDown(event: KeyboardEvent): void {
    // Handle special keys like Enter/Tab to select suggestion
    if (!this.suggestionBox || !this.suggestions.length) return;
    
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.replaceWithSuggestion(this.suggestions[0]);
      this.removeSuggestionBox();
    } else if (event.key === 'Escape') {
      this.removeSuggestionBox();
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
}

// Initialize the transliteration handler when the content script loads
new TransliterationHandler();
