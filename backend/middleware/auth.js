import { supabase } from '../services/supabase.js';

// Verify the Supabase access token in the Authorization header and resolve
// the agent record. Attaches `req.agent` for downstream handlers.
export async function requireAgent(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing_token' });
  const token = auth.slice('Bearer '.length);

  const { data: userResult, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userResult?.user) return res.status(401).json({ error: 'invalid_token' });

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (agentError) return res.status(500).json({ error: 'agent_lookup_failed' });
  if (!agent) return res.status(403).json({ error: 'not_an_agent' });

  req.agent = agent;
  req.user = userResult.user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.agent?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
