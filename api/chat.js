const rateBuckets = new Map();

const PORTFOLIO_CONTEXT = `
赵亚杰，AI 产品经理候选人，上海立信会计金融学院智能科学与技术本科在读。
核心方向：AI 应用落地、RAG 智能客服、AI 营销工具、AI 陪伴 App、Vibe Coding 原型、数据驱动决策。
项目包括：
1. SoulTalk AI 陪伴 App：参与 AI 生图、生视频、聊天模型运营与个性化 Push，Push 点击率由 2.3% 提升至 7.8%。
2. SoulTalk UGC 机制：设计用户自创角色激励机制，降低角色创作门槛，增强创作者反馈闭环。
3. RAG 智能客服：基于 RAG 架构搭建智能客服问答链路，覆盖售前、售后、商品咨询等场景，客服响应准确率提升至 91%。
4. AI 营销工具：内容生成与 KOL 推荐，分析爆文内容、达人画像和投放效果，提升内容 ROI。
联系方式：电话/微信 17855772097，邮箱 m19323067704@163.com。
飞书作品集链接：https://ocnlnp1ta2t2.feishu.cn/drive/folder/Wpm9fd5g4liX9Edxp3pctObYnng（温馨提示：点击作品集链接需要在浏览器登录飞书才能观看。）
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

  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.MINIMAX_API_KEY || '';
  if (!apiKey) {
    res.status(503).json({ error: 'AI service is not configured' });
    return;
  }

  const userMessage = String((req.body && req.body.message) || '').trim();
  if (!userMessage) {
    res.status(400).json({ error: 'Missing message' });
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
        '每次提供飞书作品集链接时，必须同时附带温馨提示：点击作品集链接需要在浏览器登录飞书才能观看。',
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
        max_completion_tokens: 1000
      })
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'AI request failed' });
      return;
    }

    const answer = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? stripModelThinking(payload.choices[0].message.content)
      : '';

    res.status(200).json({ answer: answer || '暂时没有拿到有效回答，可以换个方式问我项目、经历或联系方式。' });
  } catch (error) {
    res.status(502).json({ error: 'AI service unavailable' });
  }
};

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

  return text.trim();
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
