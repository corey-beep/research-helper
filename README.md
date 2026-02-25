# Research Helper — Chrome Extension

A Chrome extension (Manifest V3) that summarizes webpages and lets you ask questions about their content. Everything runs locally by default — no data leaves your browser unless you explicitly enable the optional external LLM mode.

## Features

- **One-click page analysis** — extracts and cleans main article content, removing ads, nav, sidebars, cookie banners, and other boilerplate
- **Heuristic summarization** — generates an overview paragraph, key points, notable quotes, and "remember 3 things" bullets with no external API
- **Local Q&A** — ask questions about the page using BM25 retrieval + extractive answer generation, entirely in-browser
- **Optional external LLM** — provide your own API key to get AI-powered answers (OpenAI-compatible endpoint)
- **Privacy-first** — no data sent anywhere by default; clear warnings when external mode is enabled
- **Copy summary** — one-click copy of the full summary in Markdown format

## Installation

### Prerequisites

None. This extension uses plain JavaScript with no build step.

### Load as Unpacked Extension

1. **Clone or download** this repository:
   ```
   git clone <repo-url> research-helper
   # or just use the folder as-is
   ```

2. Open **Chrome** and navigate to:
   ```
   chrome://extensions/
   ```

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **Load unpacked** and select the `research-helper` folder.

5. The extension icon should appear in your toolbar. Pin it for easy access.

## Usage

### Analyze a Page

1. Navigate to any article, blog post, or documentation page.
2. Click the Research Helper icon in the toolbar.
3. Click **Analyze Page**.
4. Wait for extraction and summarization (usually < 2 seconds).
5. Browse the results: summary, key points, notable quotes, and "remember 3 things".

### Ask Questions

1. After analyzing a page, scroll to the **Ask a Question** section.
2. Type your question and click **Ask** (or press Enter).
3. The extension retrieves the most relevant text chunks and stitches together an extractive answer.
4. Sources (chunk numbers + excerpts) are shown below the answer.

### Copy Summary

Click the **Copy** button next to the Summary heading to copy the full analysis in Markdown format to your clipboard.

### Enable External LLM (Optional)

1. Click the gear icon in the popup (or go to `chrome://extensions` → Research Helper → Options).
2. Toggle **Enable external LLM for Q&A**.
3. Enter your API endpoint (e.g., `https://api.openai.com/v1/chat/completions`).
4. Enter your API key.
5. Enter the model name (e.g., `gpt-4o-mini`).
6. Click **Save Settings**.

When enabled, a warning banner appears in the popup reminding you that page content will be sent to the provider.

## Testing

Try the extension on these types of pages:

| Page Type | Example |
|-----------|---------|
| News article | Any article on reuters.com, bbc.com, nytimes.com |
| Blog post | Any post on medium.com, dev.to, or personal blogs |
| Documentation | docs.python.org, developer.mozilla.org |
| Wikipedia | Any Wikipedia article |

### What to Verify

- [ ] "Analyze Page" extracts clean article text (no nav, ads, or sidebar content)
- [ ] Summary, key points, and quotes are populated
- [ ] Q&A returns relevant answers with source citations
- [ ] "Copy" button copies Markdown to clipboard
- [ ] Re-clicking "Analyze Page" refreshes the analysis
- [ ] Cached results appear when reopening the popup on the same tab
- [ ] Options page saves and loads settings correctly

## Architecture

```
research-helper/
├── manifest.json          # Manifest V3 configuration
├── background.js          # Service worker: coordinates extraction, summarization, QA
├── content_script.js      # Injected into pages to run extraction
├── popup.html/css/js      # Extension popup UI
├── options.html/js        # Settings page for external LLM config
├── icons/                 # Extension icons (16/48/128px)
└── lib/
    ├── extract.js         # DOM heuristics for content extraction
    ├── summarize.js       # Deterministic heuristic summarizer
    ├── retrieve.js        # Text chunking + BM25 retrieval index
    └── qa.js              # Local extractive QA + optional external LLM
```

### Data Flow

```
[User clicks Analyze Page]
        │
        ▼
   popup.js  ──message──▶  background.js
                                │
                    ┌───────────┴───────────┐
                    ▼                       │
            chrome.scripting               │
            .executeScript()               │
                    │                       │
                    ▼                       │
            content_script.js              │
            + lib/extract.js               │
                    │                       │
                    ▼                       │
            Extracted page data ───────────▶│
                                           │
                    ┌──────────────────────┘
                    ▼
            lib/summarize.js  →  Summary
            lib/retrieve.js   →  Chunk index (cached)
                    │
                    ▼
            Results sent back to popup.js
```

### Q&A Flow

```
[User asks a question]
        │
        ▼
   popup.js  ──message──▶  background.js
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            lib/retrieve.js         lib/qa.js
            (BM25 search)     (extractive or external)
                    │                       │
                    └───────┬───────────────┘
                            ▼
                    Answer + Sources
                            │
                            ▼
                    Rendered in popup
```

### Key Design Decisions

- **No build step**: Plain JS modules loaded via `importScripts` (service worker) and `chrome.scripting.executeScript` (content script). No bundler, no transpiler.
- **activeTab permission**: Content extraction only happens when the user clicks "Analyze Page", requiring no broad host permissions.
- **BM25 retrieval**: Lightweight, dependency-free implementation for matching question terms to text chunks. Good enough for focused retrieval without heavy NLP libraries.
- **Extractive QA**: Local answers are built by finding and stitching the most relevant sentences. Not as fluent as generative AI but works offline with zero latency.
- **Prompt injection resistance**: When external LLM is used, the system prompt explicitly instructs the model to treat webpage content as untrusted data and ignore any embedded instructions.

## Privacy

- **Default mode**: All processing happens locally in the browser. No network requests are made.
- **External LLM mode** (opt-in): Only the retrieved text chunks relevant to your question are sent to the configured API endpoint, along with your question.
- **API keys**: Stored in `chrome.storage.local`. Never logged, never included in analytics, never sent to any service other than the configured endpoint.

## License

MIT
