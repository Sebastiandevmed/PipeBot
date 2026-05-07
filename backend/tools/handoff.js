import { supabase } from '../services/supabase.js';

const VALID_REASONS = new Set([
  'customer_request',
  'bot_confused',
  'customer_frustrated',
  'complaint',
  'tracking_request',
  'modification_request',
  'out_of_scope',
  'pricing_question'
]);

export async function requestHandoff(conversationId, reason) {
  const handoff_reason = VALID_REASONS.has(reason) ? reason : 'out_of_scope';
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'human_active', handoff_reason })
    .eq('id', conversationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
