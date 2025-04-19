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
  suggestion?: string; // Added for context menu replacement
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
  private currentWord = ''; // Track the word being typed
  private suggestions: string[] = [];
  private suggestionBox: HTMLDivElement | null = null;
  private notificationElement: HTMLDivElement | null = null; // Added from previous step
  private selectedSuggestionIndex = -1; // For suggestion navigation
  private typingTimer: number | null = null; // Timer for pause detection
  private readonly typingDelay = 500; // Delay in ms for suggestions popup
  
  constructor() {
    this.initEventListeners();
    this.loadSettings();
    this.initMessageListener(); // Added from previous step
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
          // If disabled while suggestions are open, close them
          if (!this.settings.enabled) {
            this.removeSuggestionBox();
          }
        }
      } else if (message.action === 'replaceSelection' && message.suggestion) {
        this.replaceSelectedText(message.suggestion);
      } else if (message.action === 'showLanguageSelectionNotification') {
        this.showNotification(
          'Language detection failed',
          'Right-click again and select the source language manually from the menu.'
        );
      }
      return false; // No async response needed here
    });
  }
  
  private handleFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (this.isEditableElement(target)) {
      this.currentField = target;
    } else {
      // Lost focus from an editable field
      this.currentField = null;
      this.removeSuggestionBox();
      this.clearTypingTimer();
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
    if (!this.settings.enabled || !this.currentField) {
      this.removeSuggestionBox(); // Ensure box is closed if disabled or no field
      return;
    }

    // --- Suggestion Box Navigation ---
    if (this.suggestionBox && this.suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedSuggestionIndex = (this.selectedSuggestionIndex + 1) % this.suggestions.length;
        this.highlightSuggestion(this.selectedSuggestionIndex);
        return;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedSuggestionIndex = (this.selectedSuggestionIndex - 1 + this.suggestions.length) % this.suggestions.length;
        this.highlightSuggestion(this.selectedSuggestionIndex);
        return;
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.selectSuggestion(this.selectedSuggestionIndex);
        return;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.removeSuggestionBox();
        return;
      }
    }

    // --- Input Handling ---
    this.clearTypingTimer(); // Clear timer on any key press

    // Handle Space - finalize previous word
    if (event.key === ' ') {
      if (this.currentWord) {
        // If there was a word being typed, process it before inserting space
        // This handles cases where user types fast and hits space before timer pops up suggestions
        this.processWord(this.currentWord, true); // true = replace immediately if autoReplace is on
        this.currentWord = ''; // Reset current word
        // Allow space to be inserted naturally by not preventing default
      }
      this.removeSuggestionBox(); // Remove suggestions after space
      return; // Let the space be typed
    }

    // Handle Backspace
    if (event.key === 'Backspace') {
       this.removeSuggestionBox(); // Hide suggestions on backspace
       // We need to update the buffer *after* the backspace happens
       // Use a minimal timeout to allow the input field to update
       setTimeout(() => this.updateInputBuffer(), 0);
       // Set timer to potentially show suggestions for the modified word
       this.typingTimer = window.setTimeout(() => this.fetchSuggestionsForCurrentWord(), this.typingDelay);
       return; // Let backspace do its job
    }

    // Ignore control keys, navigation keys (except handled above), function keys etc.
    // Allow punctuation and symbols
    if (event.ctrlKey || event.altKey || event.metaKey || event.key.length > 1) {
       // Allow navigation keys like Home, End, Delete, PageUp/Down etc.
       if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape', 'Backspace', ' '].includes(event.key)) {
           this.removeSuggestionBox(); // Hide suggestions for other control/nav keys
       }
       return; // Let the browser handle these keys
    }

    // --- Character Input ---
    // For any other character (letters, numbers, potentially some symbols if needed)
    // Update buffer immediately after the character is typed
    setTimeout(() => {
        this.updateInputBuffer();
        // Only set timer if the current word is not empty
        if (this.currentWord) {
            this.typingTimer = window.setTimeout(() => this.fetchSuggestionsForCurrentWord(), this.typingDelay);
        } else {
            this.removeSuggestionBox(); // No word, no suggestions
        }
    }, 0);

    // Don't prevent default - let the character be typed into the field
  }

  private clearTypingTimer(): void {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private fetchSuggestionsForCurrentWord(): void {
     if (this.currentWord) {
         this.processWord(this.currentWord, false); // false = don't replace immediately, show suggestions
     } else {
         this.removeSuggestionBox(); // No word, ensure no suggestions
     }
  }

  private async processWord(word: string, replaceImmediately: boolean): Promise<void> {
    if (!word) {
      this.removeSuggestionBox();
      return;
    }
    chrome.runtime.sendMessage({
      action: 'transliterate',
      text: word,
      language: this.settings.language
    }, (response: TransliterationResponse) => {
      if (chrome.runtime.lastError) {
          console.error("Error sending message:", chrome.runtime.lastError.message);
          this.removeSuggestionBox();
          return;
      }
      if (response?.success && response.suggestions.length) {
        this.suggestions = response.suggestions;
        if (this.settings.autoReplace && replaceImmediately) {
          // Only auto-replace immediately if triggered by space and setting is on
          this.replaceCurrentWordWithSuggestion(this.suggestions[0]);
        } else if (!this.suggestionBox) { // Only show if not already visible
          this.showSuggestions();
        } else {
          // If box is already visible, update content (less disruptive)
          this.updateSuggestionBoxContent();
        }
      } else {
        // No suggestions found, or error
        this.removeSuggestionBox();
        // If triggered by space, we might still need to insert the original word + space
        if (replaceImmediately) {
            this.replaceCurrentWordWithSuggestion(word); // Put back the original word + space
        }
      }
    });
  }

  // Modified to replace the *current word* being typed
  private replaceCurrentWordWithSuggestion(suggestion: string): void {
    if (!this.currentField) return;

    this.updateInputBuffer(); // Ensure buffer is current
    const beforeWord = this.inputBuffer.substring(0, this.lastWordBoundary);
    const suffix = ' '; // Add space after replacing word
    const newText = beforeWord + suggestion + suffix;

    this.replaceContent(newText, newText.length); // Use helper
    this.currentWord = ''; // Word has been replaced
    this.updateInputBuffer(); // Update buffer state after replacement
  }

  // Refactored replacement logic into a helper
  private replaceContent(newText: string, caretPosition: number): void {
      if (!this.currentField) return;

      if (this.currentField.tagName.toLowerCase() === 'input' ||
          this.currentField.tagName.toLowerCase() === 'textarea') {
          const input = this.currentField as HTMLInputElement | HTMLTextAreaElement;
          const currentScroll = input.scrollTop;
          input.value = newText;
          input.setSelectionRange(caretPosition, caretPosition);
          input.scrollTop = currentScroll;
      } else { // contentEditable
          const sel = window.getSelection();
          if (!sel) return;

          // More robust contentEditable update
          const range = document.createRange();
          // Find the actual text node to modify, or work relative to the element
          let textNode: Node | null = null;
          let offset = 0;

          // Try to find the text node where the caret currently is
          if (sel.rangeCount > 0) {
              const currentRange = sel.getRangeAt(0);
              // If caret is within the currentField, work relative to it
              if (this.currentField.contains(currentRange.commonAncestorContainer)) {
                  // Simple case: replace all content
                  this.currentField.textContent = newText;
                  textNode = this.currentField.firstChild;
                  offset = newText.length;
              }
          }

          // Fallback if range wasn't helpful or not inside
          if (!textNode) {
              this.currentField.textContent = newText;
              textNode = this.currentField.firstChild;
              offset = newText.length;
          }


          if (textNode) {
              range.setStart(textNode, Math.min(offset, textNode.textContent?.length ?? 0));
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
          }
          this.currentField.focus(); // Ensure focus remains
      }
  }


  private showSuggestions(): void {
    if (!this.currentField || this.suggestions.length === 0) {
        this.removeSuggestionBox();
        return;
    }
    this.removeSuggestionBox(); // Remove previous box if any

    this.suggestionBox = document.createElement('div');
    // ... (styling code remains the same as before) ...
    this.suggestionBox.className = 'transliteration-suggestions';
    this.suggestionBox.style.position = 'absolute';
    this.suggestionBox.style.zIndex = '10000';
    // ... rest of styling ...
    const rect = this.currentField.getBoundingClientRect();
    this.suggestionBox.style.left = `${rect.left + window.scrollX}px`;
    this.suggestionBox.style.top = `${rect.bottom + window.scrollY}px`;
    this.suggestionBox.style.minWidth = `${Math.max(rect.width, 100)}px`; // Ensure min width

    this.updateSuggestionBoxContent(); // Populate content

    // ... (inject dark/light styles code remains the same) ...
    if (!document.getElementById('translit-style')) {
      // ... style injection ...
    }

    document.body.appendChild(this.suggestionBox);
    this.applyThemeStyles(); // Apply theme

    this.selectedSuggestionIndex = 0; // Select first suggestion by default
    this.highlightSuggestion(this.selectedSuggestionIndex);
  }

  // Helper to update content without recreating the box
  private updateSuggestionBoxContent(): void {
      if (!this.suggestionBox) return;
      this.suggestionBox.innerHTML = ''; // Clear existing items

      this.suggestions.forEach((suggestion, index) => {
          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.textContent = suggestion;
          // ... (styling and event listeners for item remain the same) ...
          item.style.padding = '5px 10px';
          item.style.cursor = 'pointer';
          item.style.whiteSpace = 'nowrap';
          item.addEventListener('click', () => {
              this.selectSuggestion(index);
          });
          item.addEventListener('mouseenter', () => {
              this.selectedSuggestionIndex = index;
              this.highlightSuggestion(index);
          });
          // No mouseleave needed as highlight is controlled by index

          this.suggestionBox?.appendChild(item);
      });
      this.applyThemeStyles(); // Re-apply theme in case items changed
  }

  private highlightSuggestion(index: number): void {
    if (!this.suggestionBox) return;
    const items = this.suggestionBox.querySelectorAll('.suggestion-item');
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const highlightBg = isDark ? '#3e3e3e' : '#f0f0f0';
    const normalBg = isDark ? '#2e2e2e' : '#fff';
    const highlightColor = isDark ? '#eee' : '#000';
    const normalColor = isDark ? '#eee' : '#000';

    items.forEach((item, i) => {
      const element = item as HTMLElement;
      if (i === index) {
        element.style.backgroundColor = highlightBg;
        element.style.color = highlightColor;
        // Ensure highlighted item is visible
        element.scrollIntoView({ block: 'nearest' });
      } else {
        element.style.backgroundColor = normalBg;
        element.style.color = normalColor;
      }
    });
  }

  private selectSuggestion(index: number): void {
    if (index >= 0 && index < this.suggestions.length) {
      this.replaceCurrentWordWithSuggestion(this.suggestions[index]);
      this.removeSuggestionBox();
    }
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
    let caretPos = 0;

    if (this.currentField.tagName.toLowerCase() === 'input' ||
        this.currentField.tagName.toLowerCase() === 'textarea') {
      const input = this.currentField as HTMLInputElement | HTMLTextAreaElement;
      text = input.value;
      caretPos = input.selectionStart || 0;
    } else { // contentEditable
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && this.currentField.contains(sel.anchorNode)) {
          text = this.currentField.textContent || '';
          caretPos = sel.anchorOffset;
          // Adjust caretPos relative to the start of the element's text content
          let node: Node | null = sel.anchorNode;
          let currentOffset = sel.anchorOffset;
          while (node && node !== this.currentField) {
              let sibling = node.previousSibling;
              while (sibling) {
                  currentOffset += sibling.textContent?.length ?? 0;
                  sibling = sibling.previousSibling;
              }
              node = node.parentNode;
          }
          caretPos = currentOffset;

      } else {
          // Fallback if selection is not useful
          text = this.currentField.textContent || '';
          caretPos = text.length; // Assume caret is at the end
      }
    }

    this.inputBuffer = text;

    // Find the start of the current word based on caret position
    let wordStart = text.lastIndexOf(' ', caretPos - 1) + 1;
    // Also consider start of the text as boundary
    if (wordStart < 0) wordStart = 0;

    // Ensure wordStart is not after caretPos (e.g., if caret is right after a space)
    wordStart = Math.min(wordStart, caretPos);

    this.lastWordBoundary = wordStart;
    // Extract the word the caret is currently in or right after
    // Find the end of the word (next space or end of string from wordStart)
    let wordEnd = text.indexOf(' ', wordStart);
    if (wordEnd === -1) {
        wordEnd = text.length;
    }

    // Only consider the part up to the caret as the "current word" for suggestions
    this.currentWord = text.substring(wordStart, caretPos).trim();

    // Debugging logs
    // console.log(`Buffer: "${text}", Caret: ${caretPos}, WordStart: ${wordStart}, CurrentWord: "${this.currentWord}"`);
  }

  private showNotification(title: string, message: string): void {
    if (this.notificationElement) {
      this.removeNotification();
    }
    this.notificationElement = document.createElement('div');
    this.notificationElement.className = 'transliteration-notification';
    this.notificationElement.style.position = 'fixed';
    this.notificationElement.style.bottom = '20px';
    this.notificationElement.style.right = '20px';
    this.notificationElement.style.backgroundColor = '#333';
    this.notificationElement.style.color = '#fff';
    this.notificationElement.style.padding = '10px 20px';
    this.notificationElement.style.borderRadius = '5px';
    this.notificationElement.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    this.notificationElement.style.zIndex = '10000';
    this.notificationElement.innerHTML = `<strong>${title}</strong><br>${message}`;
    document.body.appendChild(this.notificationElement);
    setTimeout(() => this.removeNotification(), 5000);
  }

  private removeNotification(): void {
    if (this.notificationElement && this.notificationElement.parentNode) {
      this.notificationElement.parentNode.removeChild(this.notificationElement);
      this.notificationElement = null;
    }
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
        // For standard input elements where selection might not be active
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
}

// Initialize the transliteration handler when the content script loads
new TransliterationHandler();
