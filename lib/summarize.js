/**
 * summarize.js — Deterministic heuristic summarizer.
 * No external API calls. Produces summary, key points, notable quotes,
 * "what this page is about", and "if you only remember 3 things".
 */

/**
 * Split text into sentences. Handles common abbreviations to avoid false splits.
 */
function splitSentences(text) {
  // Protect common abbreviations
  const protected_ = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Inc|Ltd|Corp|etc|vs|approx|dept|est|govt)\./gi,
      (m) => m.replace('.', '<<DOT>>'));

  const raw = protected_.split(/(?<=[.!?])\s+/);
  return raw
    .map(s => s.replace(/<<DOT>>/g, '.').trim())
    .filter(s => s.length > 10);
}

/**
 * Score a sentence for "importance" using simple heuristics.
 */
function scoreSentence(sentence, index, totalSentences, titleWords) {
  let score = 0;

  // Position bias: first and last sentences of document tend to be important
  if (index < 3) score += 3 - index;
  if (index >= totalSentences - 2) score += 1;

  // Length preference: not too short, not too long
  const words = sentence.split(/\s+/).length;
  if (words >= 8 && words <= 40) score += 2;
  if (words < 5 || words > 60) score -= 2;

  // Contains numbers/stats — often key information
  if (/\d+%|\$\d|\d{4}|\d+\s*(million|billion|thousand|percent)/i.test(sentence)) {
    score += 3;
  }

  // Importance signal words
  if (/\b(important|significant|key|crucial|essential|major|notable|first|new|found|discovered|announced|revealed|according|study|research|report|data|result|conclusion)\b/i.test(sentence)) {
    score += 2;
  }

  // Title word overlap (normalized)
  const sentWords = new Set(sentence.toLowerCase().split(/\s+/).map(w => w.replace(/[^\w]/g, '')));
  let titleOverlap = 0;
  for (const tw of titleWords) {
    if (sentWords.has(tw)) titleOverlap++;
  }
  score += Math.min(titleOverlap * 1.5, 6);

  // Penalize questions (often rhetorical or engagement bait)
  if (sentence.endsWith('?')) score -= 2;

  // Penalize self-referential / meta content
  if (/\b(click|subscribe|sign up|follow us|read more|share this|tweet|comment below)\b/i.test(sentence)) {
    score -= 5;
  }

  return score;
}

/**
 * Extract notable quotes: short verbatim excerpts that stand out.
 * Looks for quoted text, strong statements, or vivid phrasing.
 */
function extractQuotes(sentences) {
  const quotes = [];

  for (const s of sentences) {
    // Actual quoted text in the article
    const quoteMatch = s.match(/"([^"]{20,200})"/);
    if (quoteMatch) {
      quotes.push({ text: `"${quoteMatch[1]}"`, type: 'quoted' });
      continue;
    }
    // Also try curly quotes
    const curlyMatch = s.match(/\u201c([^\u201d]{20,200})\u201d/);
    if (curlyMatch) {
      quotes.push({ text: `"${curlyMatch[1]}"`, type: 'quoted' });
    }
  }

  // If not enough actual quotes, pick strong declarative sentences
  if (quotes.length < 3) {
    const declarative = sentences.filter(s =>
      s.length >= 40 && s.length <= 200 &&
      !s.endsWith('?') &&
      /\b(is|are|was|were|will|has|have|must|should|can)\b/i.test(s) &&
      !/\b(click|subscribe|sign up)\b/i.test(s)
    );
    // Pick the first few that aren't already captured
    const existing = new Set(quotes.map(q => q.text));
    for (const d of declarative) {
      if (quotes.length >= 8) break;
      const trimmed = d.length > 180 ? d.slice(0, 177) + '...' : d;
      if (!existing.has(trimmed)) {
        quotes.push({ text: trimmed, type: 'excerpt' });
        existing.add(trimmed);
      }
    }
  }

  return quotes.slice(0, 8);
}

/**
 * Main summarize function.
 * Input: { title, url, cleanText, outline }
 * Output: { overview, keyPoints, quotes, whatAbout, remember3 }
 */
function summarize(pageData) {
  const { title, cleanText, outline } = pageData;

  if (!cleanText || cleanText.trim().length < 50) {
    return {
      overview: 'Not enough content was extracted to generate a summary.',
      keyPoints: [],
      quotes: [],
      whatAbout: 'Unable to determine — insufficient content extracted.',
      remember3: [],
    };
  }

  const titleWords = (title || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length > 3);

  const sentences = splitSentences(cleanText);

  // Score all sentences
  const scored = sentences.map((s, i) => ({
    text: s,
    score: scoreSentence(s, i, sentences.length, titleWords),
    index: i,
  }));

  // Sort by score descending, pick top for different sections
  const ranked = [...scored].sort((a, b) => b.score - a.score);

  // --- Overview: top 3-5 sentences reassembled in original order ---
  const overviewCount = Math.min(5, Math.max(3, Math.ceil(sentences.length * 0.03)));
  const overviewIndices = ranked.slice(0, overviewCount)
    .sort((a, b) => a.index - b.index);
  const overview = overviewIndices.map(s => s.text).join(' ');

  // --- Key Points: top 5-10 distinct insights ---
  const keyPointCount = Math.min(10, Math.max(5, Math.ceil(sentences.length * 0.05)));
  const keyPoints = ranked
    .slice(0, keyPointCount + 5)  // over-select, then filter
    .sort((a, b) => a.index - b.index)
    .slice(0, keyPointCount)
    .map(s => {
      let text = s.text;
      if (text.length > 200) text = text.slice(0, 197) + '...';
      return text;
    });

  // --- Notable Quotes ---
  const quotes = extractQuotes(sentences);

  // --- What this page is about (one sentence) ---
  // Use the title + first high-scoring sentence
  const topSentence = ranked[0]?.text || sentences[0] || '';
  const whatAbout = title
    ? `This page is about: ${title.trim()}.`
    : topSentence.length > 120 ? topSentence.slice(0, 117) + '...' : topSentence;

  // --- If you only remember 3 things ---
  // Pick top 3 from key points, preferring diversity
  const remember3 = ranked.slice(0, 3).map(s => {
    let text = s.text;
    if (text.length > 180) text = text.slice(0, 177) + '...';
    return text;
  });

  return {
    overview,
    keyPoints,
    quotes: quotes.map(q => q.text),
    whatAbout,
    remember3,
  };
}

// Export for use in background.js (service worker)
if (typeof globalThis !== 'undefined') {
  globalThis.__ResearchHelper_summarize = summarize;
}
