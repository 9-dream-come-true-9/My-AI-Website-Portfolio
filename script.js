(function () {
  'use strict';

  function initVideoBackgroundPlayback() {
    const video = document.querySelector('.site-video-bg-media');
    if (!video) return;

    video.loop = true;
    video.muted = true;
    video.playsInline = true;

    function playVideo() {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(function () {});
      }
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && video.paused) playVideo();
    });

    if (video.readyState >= 1) playVideo();
    else video.addEventListener('loadedmetadata', playVideo, { once: true });
  }

  initVideoBackgroundPlayback();

  function initPortfolioImageLinks() {
    document.querySelectorAll('[data-portfolio-image-link]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        const href = link.getAttribute('href');
        if (!href) return;
        event.preventDefault();
        const opened = window.open(href, '_blank', 'noopener,noreferrer');
        if (!opened) window.location.href = href;
      });
    });
  }

  initPortfolioImageLinks();

  function initHeroCopySequence() {
    const heroCopySteps = document.querySelectorAll('.hero-copy-step');
    if (!heroCopySteps.length) return;

    const showHeroCopy = function () {
      heroCopySteps.forEach(function (el) {
        el.classList.add('is-visible');
      });
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(showHeroCopy);
      });
    } else {
      window.setTimeout(showHeroCopy, 16);
    }

    window.setTimeout(function () {
      document.documentElement.classList.add('hero-motion-done');
    }, 3300);
  }

  if ('IntersectionObserver' in window) {
    document.documentElement.classList.add('js-anim');
  }

  const revealTargets = document.querySelectorAll(
    '.reveal, .text-reveal, .capability-card, .project-card, .timeline-item, .hero-text, .hero-image, .hero-visual, .contact-card, .section-title, .section-subtitle'
  );

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealTargets.forEach(function (el) {
      el.classList.add('reveal');
      observer.observe(el);
    });
  } else {
    revealTargets.forEach(function (el) {
      el.classList.add('reveal', 'is-visible');
    });
  }

  initHeroCopySequence();

  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  const sections = navLinks
    .map(function (link) {
      const href = link.getAttribute('href');
      if (!href || href === '#hero') return document.getElementById('hero');
      return document.querySelector(href);
    })
    .filter(Boolean);

  function setActiveNav(id) {
    navLinks.forEach(function (link) {
      const href = link.getAttribute('href');
      if (href === '#' + id) {
        link.style.color = 'var(--color-accent)';
      } else {
        link.style.color = '';
      }
    });
  }

  function updateActiveNav() {
    let current = sections[0];
    sections.forEach(function (section) {
      if (!section) return;
      const rect = section.getBoundingClientRect();
      if (rect.top <= 150) {
        current = section;
      }
    });
    if (current) setActiveNav(current.id);
  }

  updateActiveNav();

  window.addEventListener('scroll', updateActiveNav, { passive: true });
  window.addEventListener('resize', updateActiveNav);

  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const id = href.slice(1);
        setActiveNav(id);
      }
    });
  });
})();

(function () {
  'use strict';

  function getSafeStorage(name) {
    try {
      return window[name] || null;
    } catch (error) {
      return null;
    }
  }

  const root = document.querySelector('[data-assistant]');
  if (!root) return;

  const panel = document.getElementById('assistant-panel');
  const toggleBtn = root.querySelector('[data-assistant-toggle]');
  const calloutBtn = root.querySelector('[data-assistant-callout]');
  const hideBtn = root.querySelector('[data-assistant-hide]');
  const recallBtn = root.querySelector('[data-assistant-recall]');
  const closeBtn = root.querySelector('[data-assistant-close]');
  const clearBtn = root.querySelector('[data-assistant-clear]');
  const messagesEl = root.querySelector('[data-assistant-messages]');
  const form = root.querySelector('[data-assistant-form]');
  const input = root.querySelector('[data-assistant-input]');
  const sendBtn = root.querySelector('[data-assistant-send]');
  const promptBtns = Array.from(root.querySelectorAll('[data-assistant-prompt]'));
  const endpoint = '/api/chat';
  const storageKey = 'portfolio-text-agent-history-v6';
  const hiddenStorageKey = 'portfolio-text-agent-hidden-v1';
  const temporaryAssistantErrors = [
    'AI 服务暂时没有返回有效回答，请稍后再试。',
    'AI 服务暂时没有返回有效回答，请稍后再试',
    'AI 服务暂时不可用，请稍后再试。',
    'AI 服务暂时不可用，请稍后再试'
  ];
  const localStore = getSafeStorage('localStorage');
  const sessionStore = getSafeStorage('sessionStorage');

  let history = loadHistory();

  function loadHistory() {
    try {
      const parsed = JSON.parse((sessionStore && sessionStore.getItem(storageKey)) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-18).map(function (item) {
        const role = item && item.role === 'user' ? 'user' : 'bot';
        const text = role === 'bot' ? stripModelThinking(item && item.text) : String((item && item.text) || '');
        return { role: role, text: text };
      }).filter(function (item) {
        return item.text && !(item.role === 'bot' && isTemporaryAssistantError(item.text));
      });
    } catch (error) {
      return [];
    }
  }

  function saveHistory() {
    const compact = history.filter(function (item) {
      return item && item.role && item.text;
    }).slice(-18);
    if (sessionStore) sessionStore.setItem(storageKey, JSON.stringify(compact));
  }

  function appendMessage(role, text, options) {
    const opts = options || {};
    const messageText = role === 'bot' && !opts.thinking ? stripModelThinking(text) : text;
    const wrap = document.createElement('div');
    wrap.className = 'assistant-message ' + (role === 'user' ? 'is-user' : 'is-bot');
    if (opts.thinking) wrap.dataset.thinking = 'true';

    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble';
    if (role === 'bot' && !opts.thinking) {
      bubble.classList.add('is-markdown');
      bubble.innerHTML = renderMarkdown(messageText);
    } else {
      bubble.textContent = messageText;
    }

    const meta = document.createElement('div');
    meta.className = 'assistant-meta';
    meta.textContent = role === 'user' ? '你' : 'AI求职小杰君';

    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (!opts.skipHistory && !opts.thinking) {
      history.push({ role: role, text: messageText });
      saveHistory();
    }

    return wrap;
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
        continue;
      }

      if (isTableStart(lines, index)) {
        html.push(renderTable(lines, index));
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          index += 1;
        }
        continue;
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 2, 5);
        html.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
        index += 1;
        continue;
      }

      const listType = getListType(line);
      if (listType) {
        const tag = listType === 'ordered' ? 'ol' : 'ul';
        const items = [];
        while (index < lines.length && getListType(lines[index]) === listType) {
          items.push(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
          index += 1;
        }
        html.push('<' + tag + '>' + items.map(function (item) {
          return '<li>' + renderInlineMarkdown(item.trim()) + '</li>';
        }).join('') + '</' + tag + '>');
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quotes = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quotes.push(lines[index].replace(/^>\s?/, ''));
          index += 1;
        }
        html.push('<blockquote>' + quotes.map(renderInlineMarkdown).join('<br>') + '</blockquote>');
        continue;
      }

      const paragraph = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^```/.test(lines[index].trim()) &&
        !/^(#{1,4})\s+/.test(lines[index].trim()) &&
        !getListType(lines[index]) &&
        !/^>\s?/.test(lines[index]) &&
        !isTableStart(lines, index)
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      html.push('<p>' + paragraph.map(function (item) {
        return renderInlineMarkdown(item.trim());
      }).join('<br>') + '</p>');
    }

    return html.join('');
  }

  function isTableStart(lines, index) {
    if (!lines[index] || !lines[index].includes('|') || !lines[index + 1]) return false;
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
  }

  function renderTable(lines, startIndex) {
    const headers = parseTableRow(lines[startIndex]);
    const rows = [];
    let index = startIndex + 2;
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
      rows.push(parseTableRow(lines[index]));
      index += 1;
    }

    return [
      '<div class="assistant-table-wrap"><table>',
      '<thead><tr>',
      headers.map(function (cell) { return '<th>' + renderInlineMarkdown(cell) + '</th>'; }).join(''),
      '</tr></thead><tbody>',
      rows.map(function (row) {
        return '<tr>' + headers.map(function (_, cellIndex) {
          return '<td>' + renderInlineMarkdown(row[cellIndex] || '') + '</td>';
        }).join('') + '</tr>';
      }).join(''),
      '</tbody></table></div>'
    ].join('');
  }

  function parseTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (cell) {
      return cell.trim();
    });
  }

  function getListType(line) {
    if (/^\s*\d+[.)]\s+/.test(line)) return 'ordered';
    if (/^\s*[-*+]\s+/.test(line)) return 'unordered';
    return '';
  }

  function renderInlineMarkdown(text) {
    const links = [];
    const withTokens = String(text || '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, function (_, label, url) {
      const safeUrl = sanitizeUrl(url);
      if (!safeUrl) return label;
      const token = '\u0000LINK' + links.length + '\u0000';
      links.push('<a href="' + escapeAttribute(safeUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(label) + '</a>');
      return token;
    });

    let html = escapeHtml(withTokens);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/https?:\/\/[^\s<]+/g, function (url) {
      let clean = url;
      let suffix = '';
      while (/[),.，。！？；：]$/.test(clean)) {
        suffix = clean.slice(-1) + suffix;
        clean = clean.slice(0, -1);
      }
      const safeUrl = sanitizeUrl(clean.replace(/&amp;/g, '&'));
      if (!safeUrl) return url;
      return '<a href="' + escapeAttribute(safeUrl) + '" target="_blank" rel="noreferrer">' + clean + '</a>' + suffix;
    });

    links.forEach(function (link, linkIndex) {
      html = html.replace('\u0000LINK' + linkIndex + '\u0000', link);
    });
    return html;
  }

  function sanitizeUrl(url) {
    const value = String(url || '').trim();
    if (!/^https?:\/\//i.test(value)) return '';
    return value.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function parseModelResponse(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (typeof data.answer === 'string') return data.answer;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.content === 'string') return data.content;
    if (data.data) return parseModelResponse(data.data);
    if (Array.isArray(data.choices) && data.choices[0]) {
      const choice = data.choices[0];
      return parseModelResponse(choice.message || choice);
    }
    return '';
  }

  function isTemporaryAssistantError(text) {
    return temporaryAssistantErrors.includes(String(text || '').trim());
  }

  function stripModelThinking(value) {
    let text = String(value || '').replace(/\r\n/g, '\n');

    text = text
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
      .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '');

    const finalAnswerMatch = text.match(/(?:^|\n)\s*(?:最终答案|正式回答|答案|回答|Final Answer)\s*[:：]\s*/i);
    if (finalAnswerMatch) {
      text = text.slice(finalAnswerMatch.index + finalAnswerMatch[0].length);
    }

    text = text
      .replace(/^\s*(?:思考过程|推理过程|分析过程|Thought process|Reasoning)\s*[:：][\s\S]*?(?:\n\s*\n)+/i, '')
      .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
      .replace(/<reasoning\b[^>]*>[\s\S]*$/gi, '')
      .replace(/<\/(?:think|reasoning)>/gi, '');

    return text.trim();
  }

  function renderHistory() {
    messagesEl.textContent = '';
    if (!history.length) {
      appendMessage(
        'bot',
        '你好，我是 AI 求职小杰君。你可以问我赵亚杰的 AI 项目、产品能力、实习经历、岗位匹配或联系方式。',
        { skipHistory: false }
      );
      return;
    }
    history.forEach(function (item) {
      appendMessage(item.role, item.text, { skipHistory: true });
    });
  }

  function setOpen(isOpen) {
    root.classList.toggle('is-open', isOpen);
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      window.setTimeout(function () {
        input.focus();
      }, 120);
    }
  }

  function setHidden(isHidden, options) {
    const opts = options || {};
    if (isHidden) setOpen(false);
    root.classList.toggle('is-hidden', isHidden);
    if (recallBtn) recallBtn.setAttribute('aria-hidden', isHidden ? 'false' : 'true');
    if (opts.persist !== false && localStore) {
      localStore.setItem(hiddenStorageKey, isHidden ? 'true' : 'false');
    }
  }

  async function callModel(question) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          history: history.slice(-8),
          mode: 'text'
        })
      });

      if (!response.ok) throw new Error('Bad response');
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : await response.text();
      const answer = stripModelThinking(parseModelResponse(payload)).trim();
      return answer || 'AI 服务暂时没有返回有效回答，请稍后再试。';
    } catch (error) {
      return 'AI 服务暂时不可用，请稍后再试。';
    }
  }

  function autoResizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  async function ask(question) {
    const text = question.trim();
    if (!text) return;

    appendMessage('user', text);
    input.value = '';
    autoResizeInput();
    sendBtn.disabled = true;

    const thinking = appendMessage('bot', '正在整理回答…', {
      thinking: true,
      skipHistory: true
    });

    const answer = await callModel(text);
    thinking.remove();
    appendMessage('bot', answer, {
      skipHistory: isTemporaryAssistantError(answer)
    });
    sendBtn.disabled = false;
    input.focus();
  }

  toggleBtn.addEventListener('click', function () {
    setOpen(!root.classList.contains('is-open'));
  });

  if (calloutBtn) {
    calloutBtn.addEventListener('click', function () {
      setOpen(true);
    });
  }

  if (hideBtn) {
    hideBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      setHidden(true);
    });
  }

  if (recallBtn) {
    recallBtn.addEventListener('click', function () {
      setHidden(false);
    });
  }

  closeBtn.addEventListener('click', function () {
    setOpen(false);
  });

  clearBtn.addEventListener('click', function () {
    history = [];
    if (sessionStore) sessionStore.removeItem(storageKey);
    renderHistory();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    ask(input.value);
  });

  input.addEventListener('input', autoResizeInput);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else sendBtn.click();
    }
  });

  promptBtns.forEach(function (button) {
    button.addEventListener('click', function () {
      const prompt = button.getAttribute('data-assistant-prompt') || '';
      ask(prompt);
    });
  });

  setHidden(localStore ? localStore.getItem(hiddenStorageKey) === 'true' : false, { persist: false });
  renderHistory();
})();
