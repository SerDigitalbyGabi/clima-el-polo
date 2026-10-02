# Plataforma de clima y desempeño

Medición de clima laboral por WhatsApp, con panel de resultados y plan de acción.
Construida por MAG Consulting. Corre sobre Cloudflare Workers + D1.

**Producción:** https://clima-el-polo.pages.dev
(y `clima.ccelpolo.com` cuando el cliente agregue el CNAME — ver *Dominio del cliente*)

---

## Lo que el cliente no tiene que hacer

Nada. No abre cuenta en ningún lado, no configura ninguna API, no maneja ninguna
credencial. Entra con un correo y una contraseña, y eso es todo.

Todo lo que necesita credenciales vive en la cuenta de Cloudflare de MAG.

---

## Cómo funciona

```
Colaborador                    Panel (Claudia)                 MAG
    │                                │                          │
    │  abre su link personal         │                          │
    │  ──────────────────────────>   │                          │
    │  responde 7 preguntas          │                          │
    │                                │  ve puntajes por área    │
    │                                │  lee comentarios         │
    │                                │  guarda acciones         │
    │                                │  ─────────────────────>  │
    │                                │      correo al jefe      │
```

### El corte de anonimato

Es la decisión de diseño más importante del sistema y está en el esquema, no en
una promesa:

- `invitaciones` sabe **quién** respondió (para poder recordarle a quien falta).
- `respuestas` sabe **qué** se respondió (área y rango de antigüedad, nada más).
- **No existe ninguna columna que una las dos tablas.**

Ni con acceso total a la base de datos se puede reconstruir quién dijo qué.

Además:

- Las respuestas guardan la **fecha** sin hora. La hora exacta permitiría cruzar
  contra el momento en que se abrió cada link.
- La antigüedad se guarda en **rangos**, nunca como fecha de ingreso: una fecha
  de ingreso identifica a una persona casi tan bien como su nombre.
- Un área con menos de N respuestas (por defecto 4) **no muestra puntaje**. En un
  área de tres personas, el promedio del área es casi el puntaje de cada una.
  Se configura en Ajustes.
- Los comentarios muestran el área solo si esa área supera ese mínimo.

---

## Puesta en marcha

### 1. Primer arranque

Entra a la URL de producción. La primera visita muestra la pantalla de creación
de la cuenta de administración. Después de eso, esa pantalla queda cerrada para
siempre.

### 2. Cargar los colaboradores

Colaboradores → **Pegar una lista**. Una fila por persona:

```
Rosa Quispe Mamani, Limpieza, 999888412, 2023-03-15
Julio Ramírez Soto, Mantenimiento, 999888087, 2026-02-01
```

Si el área no existe, se crea sola. Los teléfonos se normalizan a formato
internacional automáticamente.

### 3. Crear y enviar la medición

Nueva medición → elige preguntas → Crear. Queda en borrador.
Enviar la encuesta → **Abrir la medición** → se genera un link único por persona.

---

## Canales de envío

Se cambian en **Ajustes → Canal de envío**. El código está en `src/envio.js`,
con un driver por canal detrás de la misma interfaz.

### `manual` — funciona hoy, cero trámite

La plataforma arma el mensaje con el link personal de cada persona y abre
WhatsApp Web con el texto ya escrito. Solo queda darle enviar.

Es el canal por defecto y **alcanza para operar**. Úsalo mientras el trámite con
Meta avanza en paralelo.

### `meta` — WhatsApp Cloud API

Lo que hace falta:

1. **Un número dedicado.** Un chip prepago nuevo sirve; un fijo también (recibe
   el código por llamada de voz). **No puede estar registrado en WhatsApp ni en
   WhatsApp Business** — si lo está, primero elimina esa cuenta desde la app.
   El chip se usa solo para el código de verificación, pero guárdalo: si hay que
   reverificar el número, lo vas a necesitar.

2. **Tres capas de cuenta en Meta:**
   - Una cuenta personal de Facebook de una persona real (Meta no permite
     empezar sin esto).
   - Un Meta Business Portfolio en `business.facebook.com`.
   - Una app en `developers.facebook.com` con el producto WhatsApp agregado.

3. **Verificación de negocio: no hace falta para este cliente.** Una cuenta sin
   verificar puede enviar a **250 destinatarios únicos cada 24 horas**. El Polo
   tiene 48. Se salta el paso.

   Hará falta cuando se superen esos 250 en un día, o si algún día se quiere el
   nombre verificado en lugar del número. MAG es persona natural con RUC, no
   empresa constituida: el documento para ese trámite es el **Comprobante de
   Información Registrada de SUNAT** (ficha RUC), no una ficha de SUNARP. Meta
   acepta documentos tributarios y hay caminos para personas naturales con
   negocio, aunque es más quisquilloso que con una empresa constituida.

4. **Una plantilla aprobada.** Todo mensaje que inicia el negocio tiene que ser
   una plantilla revisada por Meta. Categoría Utility (más barata). Debe llevar
   un botón de URL dinámica: ahí va el token del link personal. El nombre de la
   plantilla se configura con `WA_PLANTILLA`.

5. **Un System User para el token.** No uses un token de usuario personal: caduca
   a los 60 días y queda atado a una persona. Un System User da un token
   permanente y desacopla la operación de cualquier cuenta individual.

Credenciales:

```bash
npx wrangler secret put WA_TOKEN
npx wrangler secret put WA_PHONE_ID
npx wrangler secret put WA_PLANTILLA
```

#### Quién es dueño de la cuenta y quién paga

Conviene que el número y la WABA vivan en el **portafolio de MAG**, no en el del
cliente, y que la tarjeta sea de MAG con el costo incluido en el fee. Razones:

- El cliente no entra a Meta nunca: no abre portafolio, no hace verificación de
  negocio con sus documentos, no carga tarjeta.
- Los mensajes llegan de un tercero y no del empleador, lo que refuerza la
  percepción de anonimato del colaborador.
- **El número y la WABA quedan como activo reutilizable.** El siguiente cliente
  entra al mismo número sin repetir ningún trámite. El costo de setup se paga
  una sola vez, no una por cliente.
- A este volumen el gasto es de unos 15 a 20 dólares al año. Hacer que el cliente
  cargue una tarjeta en Meta cuesta más en fricción que el gasto que evita.

Si el cliente exige ser dueño de su WABA y pagarla él, pide acceso de **Partner**
(business-to-business), nunca acceso individual: del lado del cliente figura
"MAG Consulting" y no nombres propios.

**A nombre de quién va el portafolio.** MAG es persona natural con RUC, así que
el titular del portafolio es una persona, no una razón social. Conviene que sea
quien firma con los clientes, con "MAG Consulting" como nombre comercial. La otra
socia entra como usuaria del portafolio: es un asunto interno y el cliente nunca
lo ve, porque no entra a Meta en ningún momento.

### `twilio` — respaldo

Onboarding más guiado que Meta, a cambio de un markup por mensaje. Útil si el
trámite con Meta se traba.

```bash
npx wrangler secret put TWILIO_SID
npx wrangler secret put TWILIO_TOKEN
npx wrangler secret put TWILIO_FROM
npx wrangler secret put TWILIO_PLANTILLA   # opcional, ContentSid
```

### Costo

A este volumen (48 personas × 4 mediciones + recordatorios ≈ 300 mensajes al año)
el costo es de unos pocos dólares anuales en cualquiera de los dos. Meta actualiza
tarifas por trimestre y varían por país: el precio vigente está en la
documentación de precios de la plataforma de WhatsApp Business.

---

## Correo (Resend)

Se usa para mandarle a cada jefe de área la acción que quedó a su cargo.

1. Crea la API key en Resend.
2. Verifica el dominio con los registros SPF y DKIM. Como el DNS ya está en
   Cloudflare, se ponen ahí mismo.
3. Carga las credenciales:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CORREO_DESDE     # ej. plataforma@magconsulting.pe
npx wrangler secret put CORREO_NOMBRE    # ej. MAG Consulting
```

El plan gratuito da 3.000 correos al mes y 100 por día: sobra de lejos.

**Desde qué dominio enviar.** Enviar desde el dominio de MAG es más fácil porque
lo controlas tú. Enviar desde el dominio del cliente llega mejor a la bandeja de
entrada de sus propios jefes, pero les tienes que pedir los registros DNS. El
botón de enviar usa el correo de quien administra como `reply-to`, así que la
respuesta del jefe vuelve a la persona correcta en cualquiera de los dos casos.

---

## Desarrollo

```bash
npm install
npx wrangler d1 migrations apply clima-el-polo --local
npm run dev
```

Despliegue:

```bash
npx wrangler d1 migrations apply clima-el-polo --remote
npm run deploy
```

### Datos de ejemplo

Para ver la plataforma con datos sin tocar los reales: **https://demo.clima-el-polo.pages.dev**

- Es el entorno de *preview* de Pages, con **su propia base** (`clima-demo`). La base
  de producción no se entera de que existe.
- Trae 48 colaboradores en 5 áreas, T2 y T3 2026 cerradas, T4 en curso, 12
  comentarios escritos y 5 acciones. Administración queda bajo el umbral de
  anonimato a propósito, para que se vea el área oculta.
- Mientras hay datos de ejemplo, la barra superior lo dice y ofrece "Borrar y
  empezar con mis datos". En ese modo no se puede cargar gente real ni se envía
  nada por WhatsApp o correo.
- Solo se cargan si el entorno tiene `PERMITIR_DATOS_EJEMPLO=1` (preview sí,
  producción no) **y** la base está vacía.

Volver a cargarlos desde cero (borra los de ejemplo y los vuelve a generar):

```bash
npm run deploy:demo
curl -X POST https://demo.clima-el-polo.pages.dev/api/ejemplo/cargar -b <cookie de sesión>
```

En local: `npm run dev:ejemplo` levanta el panel en el puerto 8795 con una base
aparte (`.wrangler/demo`).

### Estructura

```
src/
  index.js        router; sirve los estáticos a mano para poder pedir sesión
                  antes de entregar el panel
  api.js          endpoints y cálculo de resultados
  auth.js         sesiones y hash de contraseñas (PBKDF2 sobre WebCrypto)
  puntajes.js     de respuesta a número; regla de mínimo por área; temas
  sugerencias.js  reglas que convierten resultados en acciones concretas
  envio.js        drivers de WhatsApp (manual / meta / twilio)
  correo.js       Resend
  ejemplo.js      datos de ejemplo: generarlos y borrarlos
public/
  panel.js        helpers, navegación y las pantallas sin archivo propio
  inicio.js       Inicio: los cinco pasos y la tarjeta de cada momento
  resultados.js   Resultados, con el gráfico de evolución
  animacion.js    Movimiento: los resortes y cómo se transforma un elemento
  archivo.js      leer la lista del equipo desde Excel o CSV
  encuesta.*      la encuesta que responde cada colaborador
migrations/       esquema y banco de preguntas
build.js          arma dist/ para Pages
```

### Movimiento

Las reglas de diseño viven en `public/animacion.js` y se aplican en todo el panel:
solo se anima en respuesta a una acción o a un dato que cambió, nunca al cargar;
un elemento se transforma en vez de aparecer y desaparecer; resortes con rebote
mínimo y nada dura más de 400 ms. Con `prefers-reduced-motion`, o con la pestaña
oculta, los cambios son instantáneos.

### Cómo se calcula el puntaje

Las opciones de cada pregunta van ordenadas de la mejor a la peor, y el puntaje
sale de la posición elegida: la primera vale 10, la última 0. Agregar o quitar
opciones a una pregunta no rompe la escala ni invalida el histórico.

El índice de clima es el promedio de todas las respuestas de escala.

---

## Pendientes conocidos

- **No hay límite de intentos de login.** Conviene resolverlo en la capa correcta:
  una regla de rate limiting del WAF de Cloudflare sobre `/api/entrar`. Es gratis
  y no requiere tocar el código.
- **No hay recuperación de contraseña.** Con una o dos personas administrando, se
  resuelve regenerando el hash a mano. Si crece el número de clientes, hay que
  construirlo.
- **El recuento de temas es un conteo de palabras**, no análisis de sentimiento.
  Sirve para ordenar la lectura, no para reemplazarla.
- **Una sola organización por despliegue.** El esquema ya separa por área y
  campaña, pero para servir a varios clientes desde una instancia hay que agregar
  `organizacion_id` a las tablas y filtrar por sesión.
