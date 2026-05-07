import { supabase } from './supabase-client.js';

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.href = '/';
})();

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const fd = new FormData(form);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(fd.get('email')),
    password: String(fd.get('password'))
  });
  if (error) {
    errorEl.textContent = 'Correo o contraseña incorrectos.';
    return;
  }
  window.location.href = '/';
});
