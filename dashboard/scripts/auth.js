import { supabase } from './supabase-client.js';

export async function getSessionOrRedirect() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

export async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function getCurrentAgent(userId) {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) console.error('agent lookup:', error);
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
}
