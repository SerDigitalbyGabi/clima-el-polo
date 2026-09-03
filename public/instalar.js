const form = document.getElementById('form');
const err = document.getElementById('err');
const btn = document.getElementById('btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.remove('on');
  btn.disabled = true;
  btn.textContent = 'Creando…';

  try {
    const r = await fetch('/api/instalar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: document.getElementById('nombre').value,
        correo: document.getElementById('correo').value,
        clave: document.getElementById('clave').value,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo crear la cuenta.');
    location.href = '/';
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.add('on');
    btn.disabled = false;
    btn.textContent = 'Crear la cuenta';
  }
});
