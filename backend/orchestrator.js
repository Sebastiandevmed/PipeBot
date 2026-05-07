import { supabase } from './services/supabase.js';
import { chat } from './services/llm.js';
import { sendText, markAsRead } from './services/whatsapp.js';
import { uploadInboundMedia } from './services/storage.js';
import { getHistory, appendHistory, isDuplicate } from './services/redis.js';
import { TOOL_DEFINITIONS, runTool } from './tools/index.js';
import { setDraftField } from './tools/order.js';

const MAX_TOOL_TURNS = 6;

export async function processMessage({ phone, messageId, content, mediaId, messageType, timestamp }) {
  if (await isDuplicate(messageId)) return;
  await markAsRead(messageId).catch(() => {});

  // Upsert customer keyed on phone (the WhatsApp ID is the source of truth).
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .upsert({ phone_number: phone }, { onConflict: 'phone_number', ignoreDuplicates: false })
    .select()
    .single();
  if (custErr) throw custErr;

  // Active conversation, or open a new one.
  let conversation = await activeConversation(customer.id);
  if (!conversation) conversation = await openConversation(customer.id);

  // Persist any inbound media to Supabase Storage so the dashboard can read it
  // without holding a Graph API token.
  let mediaUrl = null;
  if (mediaId && messageType !== 'text') {
    mediaUrl = await uploadInboundMedia(mediaId, conversation.id, messageType).catch((e) => {
      console.error('media upload failed:', e?.message ?? e);
      return null;
    });
  }

  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    sender_type: 'customer',
    content,
    message_type: messageType,
    media_url: mediaUrl,
    whatsapp_message_id: messageId
  });

  // Bot is silent while a human owns the conversation.
  if (conversation.status === 'human_active') return;

  // If the customer just sent an image, attach it to the order draft as a
  // candidate payment proof. The LLM still has the final say on whether to
  // accept it (it can validate context and call set_order_details if needed).
  if (messageType === 'image' && mediaUrl) {
    await setDraftField(phone, { payment_proof_url: mediaUrl }).catch(() => {});
  }

  // Compose the user-facing turn. Annotate non-text messages so the LLM has
  // something to react to even when content is null.
  const userTurn = composeUserTurn({ content, messageType, mediaUrl });

  const history = await getHistory(phone);
  const messages = [...history, { role: 'user', content: userTurn }];

  const ctx = { phone, customer, conversation };

  const { finalText, handoffRequested } = await runToolLoop(messages, ctx);

  // Persist outbound message + send.
  if (finalText) {
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      sender_type: 'bot',
      content: finalText,
      message_type: 'text',
      llm_provider: 'groq'
    });
    await sendText(phone, finalText).catch((err) =>
      console.error('sendText failed:', err?.response?.data ?? err.message)
    );
  }

  // Only the user turn + final assistant text go into long-term history. Tool
  // turns stay scoped to this request to keep the prompt small.
  await appendHistory(phone, 'user', userTurn);
  if (finalText) await appendHistory(phone, 'assistant', finalText);

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  if (handoffRequested) {
    // The handoff tool already flipped status to human_active; nothing else
    // to do — bot will stay silent on the next inbound.
  }
}

async function runToolLoop(initialMessages, ctx) {
  const messages = [...initialMessages];
  let handoffRequested = false;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const reply = await chat({ messages, tools: TOOL_DEFINITIONS });

    // If the model called tools, execute them and loop. Otherwise we have the
    // final user-facing message.
    if (reply.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: reply.content ?? '',
        tool_calls: reply.tool_calls
      });

      for (const call of reply.tool_calls) {
        const args = safeJson(call.function.arguments);
        const result = await runTool(call.function.name, args, ctx);
        if (call.function.name === 'request_handoff' && result?.ok) handoffRequested = true;

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
      continue;
    }

    return { finalText: (reply.content ?? '').trim(), handoffRequested };
  }

  // Tool loop exhausted — bail out with a generic apology so the user isn't
  // left in silence, and trigger handoff so a human can step in.
  console.error('tool loop exhausted for phone', ctx.phone);
  await runTool('request_handoff', { reason: 'bot_confused' }, ctx).catch(() => {});
  return {
    finalText: 'Disculpa, tuve un inconveniente procesando tu mensaje. Te conecto con un asesor. 🙌',
    handoffRequested: true
  };
}

function composeUserTurn({ content, messageType, mediaUrl }) {
  if (messageType === 'text') return content ?? '';
  if (messageType === 'image') {
    return content
      ? `[El cliente envió una imagen — url: ${mediaUrl ?? 'no_disponible'}] ${content}`
      : `[El cliente envió una imagen — url: ${mediaUrl ?? 'no_disponible'}]`;
  }
  return `[El cliente envió un mensaje de tipo ${messageType}]${content ? ' ' + content : ''}`;
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

async function activeConversation(customerId) {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', ['bot_active', 'human_active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function openConversation(customerId) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ customer_id: customerId, status: 'bot_active' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
