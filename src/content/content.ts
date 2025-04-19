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
  suggestion?: string;
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
  private notificationElement: HTMLDivElement | null = null;
  
  constructor() {
    this.initEventListeners();
    this.loadSettings();
    this.initMessageListener(); // Make sure this is called
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
  
  private initMessageListener(): void {
    chrome.runtime.onMessage.addListener((
      message: ChromeMessage, 
      _sender: chrome.runtime.MessageSender, 
      _sendResponse: (response?: any) => void
    ) => {
      if (message.action === 'settingsChanged') {
        if (message.settings) {
          this.settings = message.settings;
          console.log('Content script received settings update:', this.settings);
        }
      } else if (message.action === 'replaceSelection' && message.suggestion) {
        this.replaceSelectedText(message.suggestion);
      } else if (message.action === 'showLanguageSelectionNotification') {
        this.showNotification(
          'Language detection failed',
          'Right-click again and select the source language manually from the menu.'
        );
      }
      return false;
    });
  }

  private replaceSelectedText(text: string): void {
    if (!document.activeElement) return;
    
    const activeElement = document.activeElement as HTMLElement;
    
    // Check if we're in an editable field
    if (this.isEditableElement(activeElement)) {
      const selection = window.getSelection();
      
      if (selection && selection.rangeCount > 0) {
        // Get the selected range
        const range = selection.getRangeAt(0);
        
        // Delete selected text
        range.deleteContents();
        
        // Insert the new text
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        
        // Move the caret to the end of the inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      } else if (activeElement instanceof HTMLInputElement || 
                 activeElement instanceof HTMLTextAreaElement) {
        // For standard input elements
        const start = activeElement.selectionStart || 0;
        const end = activeElement.selectionEnd || 0;
        const beforeText = activeElement.value.substring(0, start);
        const afterText = activeElement.value.substring(end);
        
        activeElement.value = beforeText + text + afterText;
        
        // Set cursor position after the inserted text
        const newPosition = beforeText.length + text.length;
        activeElement.setSelectionRange(newPosition, newPosition);
      }
    }
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

  private showNotification(title: string, message: string, duration: number = 5000): void {
    // Remove existing notification if any
    this.removeNotification();
    
    // Create notification element
    this.notificationElement = document.createElement('div');
    this.notificationElement.className = 'transliteration-notification';
    this.notificationElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: #333;
      color: #fff;
      padding: 15px;
      border-radius: 5px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 10000;
      max-width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    `;
    
    // Create title
    const titleElement = document.createElement('div');
    titleElement.textContent = title;
    titleElement.style.fontWeight = 'bold';
    titleElement.style.marginBottom = '5px';
    this.notificationElement.appendChild(titleElement);
    
    // Create message
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.style.fontSize = '14px';
    this.notificationElement.appendChild(messageElement);
    
    // Create close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      position: absolute;
      top: 5px;
      right: 8px;
      cursor: pointer;
      font-size: 16px;
    `;
    closeBtn.addEventListener('click', () => this.removeNotification());
    this.notificationElement.appendChild(closeBtn);
    
    // Add to document
    document.body.appendChild(this.notificationElement);
    
    // Auto remove after duration
    setTimeout(() => this.removeNotification(), duration);

    // Apply dark/light mode styles
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      this.notificationElement.style.backgroundColor = '#333';
      this.notificationElement.style.color = '#fff';
    } else {
      this.notificationElement.style.backgroundColor = '#fff';
      this.notificationElement.style.color = '#333';
      this.notificationElement.style.border = '1px solid #ddd';
    }
  }
  
  private removeNotification(): void {
    if (this.notificationElement && this.notificationElement.parentNode) {
      this.notificationElement.parentNode.removeChild(this.notificationElement);
      this.notificationElement = null;
    }
  }
}

// Initialize the transliteration handler when the content script loads
new TransliterationHandler();
