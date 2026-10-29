## What's new

- Create interactive Streamlit apps from a notebook prompt and open them in the new Apps sidebar. The Python source stays in your project.
- Apps match Dalliance's design and follow light and dark appearance changes.
- Refresh saved notebook data, inspect app logs, restore previous versions, and verify updates before replacing a working app.
- Hidden, idle apps stop after 15 minutes by default. Use Keep running or change the limits in Settings > Apps.
- Apps use separate environments with a compatible installed Python, so notebook Python can stay unchanged. Settings > Python now says Update libraries to clarify what it updates.

For Macs with Apple Silicon or Intel.

**Installing**

1. Open `Dalliance.dmg` and drag Dalliance into Applications.
2. The app isn't notarized yet, so macOS blocks the first launch. Open System Settings > Privacy & Security and click **Open Anyway**, once. Or skip both steps and install from Terminal: `curl -fsSL https://dalliance.io/install.sh | sh`
3. Notebook cells need Python 3.9 or newer. Dalliance can set up a private notebook environment on first launch. Apps need an installed Python 3.11 or newer and prepare separate environments after package approval. Dalliance finds a compatible installed Python without changing the notebook's interpreter; it does not download Python itself.
