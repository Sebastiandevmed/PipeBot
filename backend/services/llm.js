import Groq from 'groq-sdk';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../../system-prompt.md'),
  'utf8'
);

export const MODEL = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-1.5-flash'
};

// Single chat call. Returns the assistant message in OpenAI shape:
// { role: 'assistant', content, tool_calls? }
// Tries Groq first; on failure (network, rate limit, model error), falls back
// to Gemini. Caller is responsible for tool execution and looping.
export async function chat({ messages, tools }) {
  try {
    const res = await groqChat({ messages, tools });
    return { ...res, provider: 'groq' };
  } catch (err) {
    console.warn('Groq failed, falling back to Gemini:', err?.message ?? err);
    if (!process.env.GEMINI_API_KEY) throw err;
    const res = await geminiChat({ messages, tools });
    return { ...res, provider: 'gemini' };
  }
}

async function groqChat({ messages, tools }) {
  const response = await groq.chat.completions.create({
    model: MODEL.groq,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    tools,
    tool_choice: tools?.length ? 'auto' : undefined,
    temperature: 0.3,
    max_tokens: 600
  });
  const msg = response.choices[0].message;
  return { role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls };
}

// Gemini doesn't natively speak the OpenAI tool-call shape, so on fallback we
// send a text-only request (no tools) — fallback is best-effort, the bot
// degrades to plain conversation rather than dying outright.
async function geminiChat({ messages }) {
  const contents = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL.gemini}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const { data } = await axios.post(url, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 600 }
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  return { role: 'assistant', content: text };
}
