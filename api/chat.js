const rateBuckets = new Map();
const PORTFOLIO_LINK = 'https://ocnlnp1ta2t2.feishu.cn/drive/folder/Wpm9fd5g4liX9Edxp3pctObYnng';
const FEISHU_LOGIN_NOTE = '💡 温馨提示：作品集托管在飞书，打开链接后请先在浏览器登录飞书账号，再查看内容。';

const PORTFOLIO_CONTEXT = `
赵亚杰，AI 产品经理候选人，上海立信会计金融学院智能科学与技术本科在读。
核心方向：AI 应用落地、RAG 智能客服、AI 营销工具、AI 陪伴 App、Vibe Coding 原型、数据驱动决策。
项目包括：
1. SoulTalk AI 陪伴 App：参与 AI 生图、生视频、聊天模型运营与个性化 Push，Push 点击率由 2.3% 提升至 7.8%。
2. SoulTalk UGC 机制：设计用户自创角色激励机制，降低角色创作门槛，增强创作者反馈闭环。
3. RAG 智能客服：基于 RAG 架构搭建智能客服问答链路，覆盖售前、售后、商品咨询等场景，客服响应准确率提升至 91%。
4. AI 营销工具：内容生成与 KOL 推荐，分析爆文内容、达人画像和投放效果，提升内容 ROI。
联系方式：电话/微信 17855772097，邮箱 m19323067704@163.com。
飞书作品集链接：${PORTFOLIO_LINK}

${FEISHU_LOGIN_NOTE}
`;

module.exports = async function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.CHAT_CLIENT_TOKEN || '';
  if (token && req.headers['x-chat-token'] !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const rateLimit = checkRateLimit(getClientIp(req));
  if (rateLimit.limited) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const userMessage = String((req.body && req.body.message) || '').trim();
  if (!userMessage) {
    res.status(400).json({ error: 'Missing message' });
    return;
  }

  if (isPortfolioLinkQuestion(userMessage)) {
    res.status(200).json({
      answer: `飞书作品集链接：${PORTFOLIO_LINK}\n\n${FEISHU_LOGIN_NOTE}`
    });
    return;
  }

  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.MINIMAX_API_KEY || '';
  if (!apiKey) {
    res.status(503).json({ error: 'AI service is not configured' });
    return;
  }

  const apiBase = String(process.env.AI_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'deepseek-chat';
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];
  const messages = [
    {
      role: 'system',
      content: [
        '你是赵亚杰个人主页里的 AI 求职助手。',
        '只回答与赵亚杰的项目、经历、能力、岗位匹配和联系方式有关的问题。',
        '回答要简洁、准确、偏招聘视角，优先中文。',
        '不要输出思考过程、推理过程、分析草稿或 <think> 标签，只输出可以直接展示给用户的最终答案。',
        `每次提供飞书作品集链接时，必须严格分成下面两段，链接行只能包含链接，不能把提示放进 Markdown 链接文字或 URL：\n飞书作品集：${PORTFOLIO_LINK}\n\n${FEISHU_LOGIN_NOTE}`,
        '如果用户问到页面没有的信息，说明作品集里暂未提供。',
        `作品集资料：\n${PORTFOLIO_CONTEXT}`
      ].join('\n')
    },
    ...history
      .filter((item) => item && item.text)
      .map((item) => ({
        role: item.role === 'user' ? 'user' : 'assistant',
        content: (item.role === 'user'
          ? String(item.text)
          : stripModelThinking(item.text)
        ).slice(0, 1200)
      })),
    { role: 'user', content: userMessage.slice(0, 2000) }
  ];

  try {
    const upstream = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.5,
        enable_thinking: true,
        max_completion_tokens: 1000,
        stream: true
      })
    });

    if (!upstream.ok) {
      await upstream.text().catch(() => '');
      res.status(upstream.status).json({ error: 'AI request failed' });
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let answer = await streamModelAnswer(upstream, res);
    if (!answer) {
      answer = '暂时没有拿到有效回答，可以换个方式问我项目、经历或联系方式。';
      writeStreamEvent(res, 'delta', { delta: answer });
    }
    writeStreamEvent(res, 'done', { answer: answer });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      writeStreamEvent(res, 'error', { error: 'AI service unavailable' });
      res.end();
    } else {
      res.status(502).json({ error: 'AI service unavailable' });
    }
  }
};

async function streamModelAnswer(upstream, res) {
  if (!upstream.body || typeof upstream.body.getReader !== 'function') return '';

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  function consumeLine(line) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;

    try {
      const payload = JSON.parse(data);
      const delta = payload && payload.choices && payload.choices[0]
        ? payload.choices[0].delta
        : null;
      const content = delta && typeof delta.content === 'string' ? delta.content : '';
      if (!content) return;
      answer += content;
      writeStreamEvent(res, 'delta', { delta: content });
    } catch (error) {
      // Ignore malformed or non-JSON SSE metadata lines from the upstream service.
    }
  }

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
  }

  buffer += decoder.decode();
  if (buffer) buffer.split(/\r?\n/).forEach(consumeLine);
  return stripModelThinking(answer);
}

function writeStreamEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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

  return normalizePortfolioOutput(text).trim();
}

function normalizePortfolioOutput(value) {
  const formatted = `飞书作品集：${PORTFOLIO_LINK}\n\n${FEISHU_LOGIN_NOTE}`;
  const inlineNote = new RegExp(
    `${escapeRegExp(PORTFOLIO_LINK)}\\s*[（(][^\\n]*温馨提示[^\\n]*[）)]`,
    'gi'
  );

  return String(value || '')
    .replace(
      /\[[^\]]*Wpm9fd5g4liX9Edxp3pctObYnng[^\]]*\]\(https?:\/\/[^)\s]*Wpm9fd5g4liX9Edxp3pctObYnng[^)]*\)/gi,
      formatted
    )
    .replace(inlineNote, `${PORTFOLIO_LINK}\n\n${FEISHU_LOGIN_NOTE}`)
    .replace(
      /(^|\n)\s*(?:💡\s*)?温馨提示：作品集托管在飞书，打开链接后请先在浏览器登录飞书账号，再查看内容。/g,
      `$1${FEISHU_LOGIN_NOTE}`
    );
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPortfolioLinkQuestion(message) {
  const text = String(message || '').toLowerCase();
  return /作品集|飞书|feishu/.test(text) && /链接|地址|观看|查看|打开|入口|提示|登录|登陆|看/.test(text);
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const windowMs = Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS || 60000);
  const max = Number(process.env.CHAT_RATE_LIMIT_MAX || 12);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
  }

  bucket.count += 1;
  rateBuckets.set(ip, bucket);

  if (bucket.count > max) {
    return {
      limited: true,
      retryAfter: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000))
    };
  }

  if (rateBuckets.size > 500) {
    rateBuckets.forEach((item, key) => {
      if (now - item.windowStart >= windowMs) rateBuckets.delete(key);
    });
  }

  return { limited: false, retryAfter: 0 };
}
