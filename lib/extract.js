/**
 * extract.js — Content extraction with Readability-style heuristics.
 * Removes boilerplate (ads, nav, footers, sidebars, cookie banners, etc.)
 * and returns clean article text with structured heading outline.
 *
 * Wrapped in an IIFE to prevent duplicate declaration errors
 * when chrome.scripting.executeScript injects this file multiple times.
 */
(function() {
  // Guard: skip if already loaded
  if (typeof window.__ResearchHelper_extract === 'function') return;

  // Selectors for elements that are almost never the main content.
  const REMOVE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    '.sidebar', '.toc', '#toc',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '[aria-label*="breadcrumb"]', '.breadcrumb',
    '.ad', '.ads', '[class*="ad-"]', '[id*="ad-"]',
    '.cookie', '.consent', '.newsletter', '.subscribe', '.promo',
    '.related-posts', '.related', '[class*="related"]',
    '.comments', '#comments', '.comment-section', '[id*="comment"]',
    '.share', '.social', '[class*="share"]', '[class*="social"]',
    '.popup', '.modal', '.overlay',
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
    'form', 'button', 'input', 'select', 'textarea',
    '[hidden]', '[aria-hidden="true"]',
    '.visually-hidden', '.sr-only',
  ];

  /**
   * Score a DOM node for how likely it is to be "main content".
   * Higher = more likely article body.
   */
  function scoreNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;

    let score = 0;
    const tag = node.tagName.toLowerCase();
    const id = (node.id || '').toLowerCase();
    const cls = (node.className && typeof node.className === 'string')
      ? node.className.toLowerCase() : '';

    // Positive signals
    if (tag === 'article') score += 30;
    if (tag === 'main') score += 25;
    if (/content|article|post|entry|story|body/.test(id)) score += 20;
    if (/content|article|post|entry|story|body/.test(cls)) score += 20;
    if (/prose|text|rich-text/.test(cls)) score += 15;
    if (node.getAttribute('role') === 'main') score += 25;
    if (node.getAttribute('itemprop') === 'articleBody') score += 30;

    // Negative signals
    if (/sidebar|widget|nav|menu|footer|header|comment|ad/.test(id)) score -= 20;
    if (/sidebar|widget|nav|menu|footer|header|comment|ad/.test(cls)) score -= 20;
    if (['aside', 'nav', 'footer', 'header'].includes(tag)) score -= 25;

    // Text density heuristic: paragraphs with real text are good
    const paragraphs = node.querySelectorAll('p');
    const textLen = node.textContent.length;
    const linkLen = Array.from(node.querySelectorAll('a'))
      .reduce((sum, a) => sum + (a.textContent || '').length, 0);
    const linkDensity = textLen > 0 ? linkLen / textLen : 1;

    score += Math.min(paragraphs.length * 3, 30);
    // Penalize link-heavy blocks (menus, nav, ToC)
    if (linkDensity > 0.5) score -= 30;
    // Reward text-rich blocks
    if (textLen > 200 && linkDensity < 0.3) score += 15;

    return score;
  }

  /**
   * Detect table-of-contents lists: many anchor links pointing to same-page fragments.
   */
  function isTocList(el) {
    const links = el.querySelectorAll('a[href^="#"]');
    const totalLinks = el.querySelectorAll('a');
    // If >60% of links are same-page anchors and there are at least 4, it's a ToC
    return totalLinks.length >= 4 && links.length / totalLinks.length > 0.6;
  }

  /**
   * Remove boilerplate elements from a cloned document body.
   */
  function removeBoilerplate(root) {
    // Remove by selector
    for (const sel of REMOVE_SELECTORS) {
      try {
        root.querySelectorAll(sel).forEach(el => el.remove());
      } catch (_) { /* skip invalid selectors in edge cases */ }
    }

    // Remove ToC-like lists
    root.querySelectorAll('ul, ol, nav').forEach(el => {
      if (isTocList(el)) el.remove();
    });

    // Remove elements with very high link density (likely nav/menus)
    root.querySelectorAll('div, section, ul, ol').forEach(el => {
      const text = (el.textContent || '').length;
      const linkText = Array.from(el.querySelectorAll('a'))
        .reduce((s, a) => s + (a.textContent || '').length, 0);
      if (text > 0 && text < 500 && linkText / text > 0.7) {
        el.remove();
      }
    });
  }

  /**
   * Find the best content container using scoring heuristic.
   */
  function findContentRoot(root) {
    // Try semantic elements first
    const article = root.querySelector('article');
    if (article && article.textContent.trim().length > 200) return article;

    const main = root.querySelector('main, [role="main"]');
    if (main && main.textContent.trim().length > 200) return main;

    // Score all block-level containers
    const candidates = root.querySelectorAll(
      'div, section, article, main, td, .post, .entry, .content'
    );
    let best = root;
    let bestScore = -Infinity;

    for (const node of candidates) {
      const s = scoreNode(node);
      if (s > bestScore) {
        bestScore = s;
        best = node;
      }
    }

    return best;
  }

  /**
   * Extract text blocks grouped by heading hierarchy.
   * Returns { headings: [{ level, text, content }], plainText }
   */
  function extractStructured(root) {
    const headings = [];
    let currentHeading = { level: 0, text: '(Introduction)', content: [] };
    headings.push(currentHeading);

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        const match = tag.match(/^h([1-6])$/);
        if (match) {
          const level = parseInt(match[1], 10);
          const text = node.textContent.trim();
          if (text) {
            currentHeading = { level, text, content: [] };
            headings.push(currentHeading);
          }
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text && text.length > 1) {
          // Only include text from block-level parents (not inline spans inside removed elements)
          const parent = node.parentElement;
          if (parent) {
            const tag = parent.tagName.toLowerCase();
            const blockTags = ['p', 'div', 'li', 'td', 'th', 'blockquote',
              'pre', 'code', 'figcaption', 'dt', 'dd', 'section', 'article', 'main'];
            const isHeading = /^h[1-6]$/.test(tag);
            // Include text from block elements or if the parent is a direct child of one
            if (blockTags.includes(tag) || isHeading || blockTags.includes(
              (parent.parentElement || {}).tagName?.toLowerCase()
            )) {
              currentHeading.content.push(text);
            }
          }
        }
      }
    }

    // Build plain text and deduplicate
    const seenLines = new Set();
    const dedupedHeadings = headings
      .map(h => ({
        ...h,
        content: h.content.filter(line => {
          const normalized = line.replace(/\s+/g, ' ').trim();
          if (seenLines.has(normalized) || normalized.length < 3) return false;
          seenLines.add(normalized);
          return true;
        })
      }))
      .filter(h => h.content.length > 0 || h.level > 0);

    const plainText = dedupedHeadings
      .map(h => {
        const parts = [];
        if (h.level > 0) parts.push(`${'#'.repeat(h.level)} ${h.text}`);
        parts.push(...h.content);
        return parts.join('\n');
      })
      .join('\n\n');

    return { headings: dedupedHeadings, plainText };
  }

  /**
   * Main extraction entry point. Call from content script context (has DOM access).
   * Returns { title, url, cleanText, outline }
   */
  function extractPageContent() {
    const title = document.title || '';
    const url = window.location.href;

    // Clone the body so we don't mutate the live page
    const clone = document.body.cloneNode(true);

    // Phase 1: Remove obvious boilerplate
    removeBoilerplate(clone);

    // Phase 2: Find best content container
    const contentRoot = findContentRoot(clone);

    // Phase 3: Extract structured text
    const { headings, plainText } = extractStructured(contentRoot);

    // Phase 4: Build outline
    const outline = headings.map(h => ({
      level: h.level,
      heading: h.text,
      paragraphs: h.content,
    }));

    return {
      title,
      url,
      cleanText: plainText,
      outline,
    };
  }

  // Expose for content_script.js
  window.__ResearchHelper_extract = extractPageContent;
})();
