export class TransliterationService {
    /**
     * Gets transliteration suggestions from Google Input Tools API
     * Based on the Python implementation in translit_api_demo.py
     */
    static async getTransliteration(options) {
        if (!options.text) {
            return { success: true, suggestions: [] };
        }
        const apiUrl = "https://inputtools.google.com/request";
        const params = new URLSearchParams({
            text: options.text,
            itc: `${options.language}-t-i0-und`, // Language code with transliteration format
            num: String(options.numSuggestions || 5),
            cp: "0",
            cs: "1",
            ie: "utf-8",
            oe: "utf-8",
            app: "demopage"
        });
        try {
            const response = await fetch(`${apiUrl}?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const data = await response.json();
            if (data[0] === "SUCCESS" && data[1] && data[1].length > 0) {
                return {
                    success: true,
                    suggestions: data[1][0][1] || []
                };
            }
            else {
                return {
                    success: true,
                    suggestions: []
                };
            }
        }
        catch (error) {
            console.error("Transliteration API error:", error);
            return {
                success: false,
                suggestions: [],
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    }
}
// Map of supported languages with their codes
export const SUPPORTED_LANGUAGES = {
    "Kannada": "kn",
    "Hindi": "hi",
    "Bengali": "bn",
    "Tamil": "ta",
    "Telugu": "te",
    "Malayalam": "ml",
    "Marathi": "mr",
    "Gujarati": "gu",
    "Nepali": "ne",
    "Urdu": "ur",
    "Sanskrit": "sa",
    "Arabic": "ar",
    "Persian": "fa",
    "Russian": "ru",
    "Japanese": "ja",
    "Korean": "ko",
    "Chinese": "zh"
};
