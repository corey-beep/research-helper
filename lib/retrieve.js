/**
 * retrieve.js — Chunking + BM25-style scoring for local retrieval.
 * Splits extracted text into overlapping chunks and scores them
 * against a user query for relevance.
 */

/**
 * Chunk text into segments of ~800-1200 characters with overlap.
 * Tries to break at sentence boundaries for cleaner chunks.
 */
function chunkText(text, targetSize = 1000, overlap = 200) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  let chunkStart = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if (current.length + sentence.length > targetSize && current.length >= targetSize * 0.6) {
      // Current chunk is big enough; save it
      chunks.push({
        text: current.trim(),
        index: chunks.length,
        charStart: chunkStart,
      });

      // Overlap: backtrack to include last ~overlap characters
      const overlapText = current.slice(-overlap);
      const overlapStart = chunkStart + current.length - overlapText.length;
      current = overlapText + ' ' + sentence;
      chunkStart = overlapStart;
    } else {
      if (!current) chunkStart = text.indexOf(sentence, chunkStart);
      current += (current ? ' ' : '') + sentence;
    }
  }

  // Final chunk
  if (current.trim()) {
    chunks.push({
      text: current.trim(),
      index: chunks.length,
      charStart: chunkStart,
    });
  }

  return chunks;
}

/**
 * Tokenize text: lowercase, split on non-word, remove stopwords.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
  'how', 'when', 'where', 'why', 'not', 'no', 'nor', 'so', 'if',
  'then', 'than', 'too', 'very', 'just', 'about', 'above', 'after',
  'again', 'all', 'also', 'am', 'any', 'as', 'because', 'before',
  'between', 'both', 'each', 'few', 'get', 'got', 'he', 'her', 'here',
  'him', 'his', 'i', 'into', 'me', 'more', 'most', 'my', 'myself',
  'now', 'only', 'other', 'our', 'out', 'own', 'same', 'she', 'some',
  'still', 'such', 'take', 'their', 'them', 'there', 'they', 'through',
  'up', 'us', 'we', 'well', 'while', 'you', 'your',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^\w]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Simple stemmer: chop common English suffixes.
 * Not as good as Porter but fast and dependency-free.
 */
function stem(word) {
  return word
    .replace(/(ing|tion|sion|ment|ness|ity|ies|ous|ive|able|ible|ed|ly|er|est|ful|less|al|ence|ance)$/, '')
    .replace(/s$/, '');
}

/**
 * Build term frequency map for a token list.
 */
function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) {
    const s = stem(t);
    tf[s] = (tf[s] || 0) + 1;
  }
  return tf;
}

/**
 * BM25 scoring parameters.
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * Build a retrieval index from chunks.
 * Returns an object with a `search(query, topK)` method.
 */
function buildIndex(chunks) {
  const N = chunks.length;
  if (N === 0) return { search: () => [] };

  // Precompute per-chunk token data
  const chunkData = chunks.map(chunk => {
    const tokens = tokenize(chunk.text);
    const tf = termFrequency(tokens);
    return { tokens, tf, length: tokens.length };
  });

  // Average document length
  const avgDL = chunkData.reduce((s, d) => s + d.length, 0) / N;

  // Document frequency for each stemmed term
  const df = {};
  for (const d of chunkData) {
    const seen = new Set(Object.keys(d.tf));
    for (const term of seen) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
  const idf = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
  }

  return {
    search(query, topK = 5) {
      const queryTokens = tokenize(query).map(stem);
      if (queryTokens.length === 0) return [];

      const scores = chunkData.map((doc, i) => {
        let score = 0;
        for (const qt of queryTokens) {
          const tf_val = doc.tf[qt] || 0;
          const idf_val = idf[qt] || 0;
          // BM25 formula
          const numerator = tf_val * (BM25_K1 + 1);
          const denominator = tf_val + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / avgDL));
          score += idf_val * (numerator / denominator);
        }
        return { chunkIndex: i, score, chunk: chunks[i] };
      });

      return scores
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }
  };
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.__ResearchHelper_retrieve = { chunkText, buildIndex, tokenize, stem };
}
