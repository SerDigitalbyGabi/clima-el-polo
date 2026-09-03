const form = document.getElementById('form');
const err = document.getElementById('err');
const btn = document.getElementById('btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.remove('on');
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  try {
    const r = await fetch('/api/entrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correo: document.getElementById('correo').value,
        clave: document.getElementById('clave').value,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo entrar.');
    location.href = '/';
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.add('on');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});
