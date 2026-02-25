/**
 * summarize.js — Heuristic summarizer with actual condensation.
 * Instead of returning verbatim sentences, this compresses, deduplicates,
 * and synthesizes text into genuine summaries.
 */

// ── Sentence splitting ──────────────────────────────────────────────

function splitSentences(text) {
  const protected_ = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Inc|Ltd|Corp|etc|vs|approx|dept|est|govt|e\.g|i\.e)\./gi,
      (m) => m.replace('.', '<<DOT>>'));
  const raw = protected_.split(/(?<=[.!?])\s+/);
  return raw
    .map(s => s.replace(/<<DOT>>/g, '.').trim())
    .filter(s => s.length > 10);
}

// ── Sentence compression ────────────────────────────────────────────
// Strips filler, attribution, parentheticals, and hedging to get at the core claim.

function compressSentence(sentence) {
  let s = sentence;

  // Remove attribution phrases
  s = s.replace(/\b(according to [^,]+,?\s*)/gi, '');
  s = s.replace(/\b(the (report|study|research|survey|data|analysis|findings|experts?|authors?|researchers?)\s+(says?|shows?|suggests?|indicates?|reveals?|found|noted|stated|concluded|reported)\s+(that\s+)?)/gi, '');
  s = s.replace(/\b(as (reported|noted|stated|mentioned) (by|in) [^,]+,?\s*)/gi, '');
  s = s.replace(/\b(experts?\s+(say|believe|think|argue|suggest|warn|note)\s+(that\s+)?)/gi, '');

  // Remove parenthetical asides
  s = s.replace(/\s*\([^)]{0,80}\)\s*/g, ' ');

  // Remove hedging / filler phrases
  s = s.replace(/\b(it is (worth noting|important to note|interesting to note) that\s+)/gi, '');
  s = s.replace(/\b(in (fact|reality|practice|general|particular|addition|other words),?\s*)/gi, '');
  s = s.replace(/\b(as a matter of fact,?\s*)/gi, '');
  s = s.replace(/\b(it (should|must) be (noted|mentioned|emphasized) that\s+)/gi, '');
  s = s.replace(/\b(needless to say,?\s*)/gi, '');
  s = s.replace(/\b(essentially|basically|actually|literally|obviously|clearly|apparently|seemingly|arguably|undoubtedly|certainly|indeed|perhaps|possibly|probably|generally|typically|usually|often|sometimes)\s+/gi, '');

  // Remove leading conjunctions/transitions
  s = s.replace(/^(however|moreover|furthermore|additionally|consequently|nevertheless|meanwhile|therefore|thus|hence|accordingly|similarly|likewise|nonetheless|subsequently|alternatively),?\s*/i, '');
  s = s.replace(/^(in conclusion|to summarize|to sum up|in summary|overall|ultimately|all in all|at the end of the day),?\s*/i, '');
  s = s.replace(/^(and|but|or|so|yet|still|also|then)\s+/i, '');

  // Collapse whitespace
  s = s.replace(/\s{2,}/g, ' ').trim();

  // Capitalize first letter
  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  return s;
}

// ── Word-set similarity for deduplication ───────────────────────────

function wordSet(text) {
  return new Set(
    text.toLowerCase()
      .split(/[^\w]+/)
      .filter(w => w.length > 2)
  );
}

function jaccardSimilarity(setA, setB) {
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function deduplicateByContent(items, threshold = 0.55) {
  const result = [];
  const sets = [];
  for (const item of items) {
    const ws = wordSet(item);
    let isDuplicate = false;
    for (const existing of sets) {
      if (jaccardSimilarity(ws, existing) > threshold) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      result.push(item);
      sets.push(ws);
    }
  }
  return result;
}

// ── Score sentences ─────────────────────────────────────────────────

function scoreSentence(sentence, index, totalSentences, titleWords) {
  let score = 0;

  // Position: early sentences carry topic-setting weight
  if (index < 3) score += 3 - index;
  if (index >= totalSentences - 2) score += 1;

  // Length sweet spot
  const words = sentence.split(/\s+/).length;
  if (words >= 8 && words <= 40) score += 2;
  if (words < 5 || words > 60) score -= 2;

  // Numbers/stats
  if (/\d+%|\$\d|\d{4}|\d+\s*(million|billion|thousand|percent)/i.test(sentence)) {
    score += 3;
  }

  // Importance signals
  if (/\b(important|significant|key|crucial|essential|major|notable|first|new|found|discovered|announced|revealed|result|conclusion)\b/i.test(sentence)) {
    score += 2;
  }

  // Title word overlap
  const sentWords = new Set(sentence.toLowerCase().split(/\s+/).map(w => w.replace(/[^\w]/g, '')));
  let titleOverlap = 0;
  for (const tw of titleWords) {
    if (sentWords.has(tw)) titleOverlap++;
  }
  score += Math.min(titleOverlap * 1.5, 6);

  // Penalize questions & meta content
  if (sentence.endsWith('?')) score -= 2;
  if (/\b(click|subscribe|sign up|follow us|read more|share this|tweet|comment below)\b/i.test(sentence)) {
    score -= 5;
  }

  return score;
}

// ── Topic grouping using outline headings ───────────────────────────

function groupBySection(outline) {
  // Each outline entry has { level, heading, paragraphs }
  // Return sections with their text joined
  return (outline || []).map(section => ({
    heading: section.heading || '(Untitled)',
    text: (section.paragraphs || []).join(' '),
  })).filter(s => s.text.length > 20);
}

/**
 * Summarize a section's text into a single condensed statement.
 * Picks the most important sentence, compresses it, and optionally
 * merges a second sentence if it adds distinct info.
 */
function summarizeSection(heading, text, titleWords) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;

  const scored = sentences.map((s, i) => ({
    text: s,
    score: scoreSentence(s, i, sentences.length, titleWords),
    index: i,
  }));
  scored.sort((a, b) => b.score - a.score);

  // Compress the top sentence
  let condensed = compressSentence(scored[0].text);

  // If there's a strong second sentence that adds new info, append its core claim
  if (scored.length > 1 && scored[1].score > 0) {
    const second = compressSentence(scored[1].text);
    const sim = jaccardSimilarity(wordSet(condensed), wordSet(second));
    if (sim < 0.4 && second.length > 15) {
      condensed += ' ' + second;
    }
  }

  return condensed;
}

// ── Extract notable quotes (verbatim — this is correct for quotes) ──

function extractQuotes(sentences) {
  const quotes = [];

  for (const s of sentences) {
    const quoteMatch = s.match(/"([^"]{20,200})"/);
    if (quoteMatch) {
      quotes.push(`"${quoteMatch[1]}"`);
      continue;
    }
    const curlyMatch = s.match(/\u201c([^\u201d]{20,200})\u201d/);
    if (curlyMatch) {
      quotes.push(`"${curlyMatch[1]}"`);
    }
  }

  // Fill with strong declarative excerpts if needed
  if (quotes.length < 3) {
    const declarative = sentences.filter(s =>
      s.length >= 40 && s.length <= 200 &&
      !s.endsWith('?') &&
      /\b(is|are|was|were|will|has|have|must|should|can)\b/i.test(s) &&
      !/\b(click|subscribe|sign up)\b/i.test(s)
    );
    const existing = new Set(quotes);
    for (const d of declarative) {
      if (quotes.length >= 8) break;
      const trimmed = d.length > 180 ? d.slice(0, 177) + '...' : d;
      if (!existing.has(trimmed)) {
        quotes.push(trimmed);
        existing.add(trimmed);
      }
    }
  }

  return quotes.slice(0, 8);
}

// ── Main summarize function ─────────────────────────────────────────

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
  const sections = groupBySection(outline);

  // ── "What this page is about" ──
  // Synthesize from title + heading names + first paragraph
  const headingNames = sections
    .map(s => s.heading)
    .filter(h => h !== '(Untitled)' && h !== '(Introduction)')
    .slice(0, 4);
  const topicHints = headingNames.length > 0
    ? `, covering ${headingNames.join(', ')}`
    : '';
  const whatAbout = title
    ? `${title.trim()}${topicHints}.`
    : (sentences[0] ? compressSentence(sentences[0]) : 'Could not determine the topic.');

  // ── Overview: condensed section-by-section summary ──
  let overviewParts = [];
  if (sections.length >= 2) {
    // Summarize each section, take the best ones
    for (const section of sections) {
      const condensed = summarizeSection(section.heading, section.text, titleWords);
      if (condensed && condensed.length > 15) {
        overviewParts.push(condensed);
      }
    }
    overviewParts = deduplicateByContent(overviewParts).slice(0, 5);
  }

  // Fallback: if outline didn't produce enough, use scored sentences with compression
  if (overviewParts.length < 2) {
    const scored = sentences.map((s, i) => ({
      text: s,
      score: scoreSentence(s, i, sentences.length, titleWords),
      index: i,
    }));
    scored.sort((a, b) => b.score - a.score);

    overviewParts = scored
      .slice(0, 6)
      .sort((a, b) => a.index - b.index)
      .map(s => compressSentence(s.text));
    overviewParts = deduplicateByContent(overviewParts).slice(0, 5);
  }

  const overview = overviewParts.join(' ');

  // ── Key Points: compressed + deduplicated ──
  const scored = sentences.map((s, i) => ({
    text: s,
    score: scoreSentence(s, i, sentences.length, titleWords),
    index: i,
    sectionIndex: findSectionIndex(sections, s),
  }));
  scored.sort((a, b) => b.score - a.score);

  const rawPoints = scored
    .slice(0, 15)
    .map(s => compressSentence(s.text))
    .filter(s => s.length > 15);

  const keyPoints = deduplicateByContent(rawPoints, 0.45)
    .slice(0, 10)
    .map(point => {
      if (point.length > 200) return point.slice(0, 197) + '...';
      return point;
    });

  // ── Remember 3: pick most diverse key points ──
  const remember3 = pickDiverse(keyPoints, 3);

  // ── Notable Quotes (verbatim is correct here) ──
  const quotes = extractQuotes(sentences);

  return { overview, keyPoints, quotes, whatAbout, remember3 };
}

/**
 * Find which section a sentence belongs to (for diversity scoring).
 */
function findSectionIndex(sections, sentence) {
  const words = wordSet(sentence);
  let bestIdx = 0;
  let bestOverlap = 0;
  for (let i = 0; i < sections.length; i++) {
    const sectionWords = wordSet(sections[i].text);
    let overlap = 0;
    for (const w of words) {
      if (sectionWords.has(w)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Pick N items from a list maximizing content diversity.
 */
function pickDiverse(items, n) {
  if (items.length <= n) return items.slice();
  const result = [items[0]];
  const resultSets = [wordSet(items[0])];

  while (result.length < n) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < items.length; i++) {
      if (result.includes(items[i])) continue;
      const ws = wordSet(items[i]);
      // Score = inverse of max similarity to any already-selected item
      let maxSim = 0;
      for (const rs of resultSets) {
        maxSim = Math.max(maxSim, jaccardSimilarity(ws, rs));
      }
      const diversityScore = 1 - maxSim;
      if (diversityScore > bestScore) {
        bestScore = diversityScore;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    result.push(items[bestIdx]);
    resultSets.push(wordSet(items[bestIdx]));
  }

  return result;
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.__ResearchHelper_summarize = summarize;
}
