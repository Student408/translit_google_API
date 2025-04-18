import requests
import json

def get_kannada_transliteration(input_text):
    """
    Uses the Google Input Tools internal API to get Kannada transliterations.

    Args:
        input_text (str): The text in Roman script to transliterate.

    Returns:
        list: A list of Kannada transliteration suggestions, or None if an error occurs.
              Returns an empty list if no suggestions are found.
    """
    if not input_text:
        return []

    api_url = "https://inputtools.google.com/request"

    params = {
        "text": input_text,
        "itc": "kn-t-i0-und",  # Kannada Transliteration
        "num": 5,             # Number of suggestions (can adjust)
        "cp": 0,
        "cs": 1,
        "ie": "utf-8",
        "oe": "utf-8",
        "app": "demopage"     # Mimic the demo page request
    }

    try:
        response = requests.get(api_url, params=params)
        response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)

        # The response is JSON, but wrapped in a slightly unusual list structure
        # Example successful response structure for "Kannada":
        # [
        #   "SUCCESS",
        #   [
        #     [
        #       "Kannada",         <-- Original input
        #       [
        #         "ಕನ್ನಡ",        <-- Suggestions start here
        #         "ಕಾನ್ನಡ",
        #         "ಕನ್ನಾಡ",
        #         "ಕಣ್ನದ",
        #         "ಖನ್ನದ"
        #       ],
        #       [], {}
        #     ]
        #   ]
        # ]
        # Example response for no suggestions (e.g., "xyz"):
        # [
        #  "SUCCESS",
        #  []
        # ]

        data = response.json()

        if data[0] == "SUCCESS" and data[1]:
            suggestions = data[1][0][1]
            return suggestions
        else:
            # Success but no suggestions found or unexpected structure
            return []

    except requests.exceptions.RequestException as e:
        print(f"Error during request: {e}")
        return None
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON response. Response text: {response.text}")
        return None
    except (IndexError, TypeError) as e:
        print(f"Error parsing JSON structure: {e}. Response data: {data}")
        return None

# --- Example Usage ---
if __name__ == "__main__":
    while True:
        text_to_convert = input("Enter English text to transliterate to Kannada (or 'quit'): ")
        if text_to_convert.lower() == 'quit':
            break
        if not text_to_convert.strip():
            continue

        kannada_suggestions = get_kannada_transliteration(text_to_convert)

        if kannada_suggestions is None:
            print("An error occurred. Could not fetch suggestions.")
        elif not kannada_suggestions:
            print("No suggestions found.")
        else:
            print("\nSuggestions:")
            for i, suggestion in enumerate(kannada_suggestions):
                print(f"{i+1}. {suggestion}")
            print("-" * 20)