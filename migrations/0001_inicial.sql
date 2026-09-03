-- ============================================================
--  Plataforma de clima y desempeño · Centro Comercial El Polo
--  MAG Consulting
-- ============================================================

CREATE TABLE areas (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE colaboradores (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL,
  area_id   INTEGER NOT NULL REFERENCES areas(id),
  telefono  TEXT,
  ingreso   TEXT,
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_colab_area ON colaboradores(area_id, activo);

-- opciones: JSON, de la mejor respuesta a la peor. El puntaje se deriva del orden.
CREATE TABLE preguntas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  texto     TEXT NOT NULL,
  dimension TEXT NOT NULL,
  tipo      TEXT NOT NULL CHECK (tipo IN ('escala','texto')),
  opciones  TEXT,
  activa    INTEGER NOT NULL DEFAULT 1,
  orden     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE campanas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL,
  periodo   TEXT,
  estado    TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','abierta','cerrada')),
  abre_en   TEXT,
  cierra_en TEXT,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE campana_preguntas (
  campana_id  INTEGER NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
  pregunta_id INTEGER NOT NULL REFERENCES preguntas(id),
  orden       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campana_id, pregunta_id)
);

-- ------------------------------------------------------------
--  EL CORTE DE ANONIMATO
--  invitaciones sabe QUIEN respondio. respuestas sabe QUE se respondio.
--  No hay ninguna columna que una las dos tablas. Es a proposito:
--  ni con acceso total a la base se puede reconstruir quien dijo que.
-- ------------------------------------------------------------
CREATE TABLE invitaciones (
  token          TEXT PRIMARY KEY,
  campana_id     INTEGER NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  respondida_en  TEXT,
  recordada_en   TEXT,
  enviada_en     TEXT,
  canal          TEXT,
  UNIQUE (campana_id, colaborador_id)
);
CREATE INDEX idx_inv_campana ON invitaciones(campana_id);

CREATE TABLE respuestas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  campana_id INTEGER NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
  area_id    INTEGER NOT NULL REFERENCES areas(id),
  antiguedad TEXT,
  -- fecha sin hora: la hora exacta permitiria cruzar contra el momento del envio
  fecha      TEXT NOT NULL DEFAULT (date('now'))
);
CREATE INDEX idx_resp_campana ON respuestas(campana_id, area_id);

CREATE TABLE detalle (
  respuesta_id INTEGER NOT NULL REFERENCES respuestas(id) ON DELETE CASCADE,
  pregunta_id  INTEGER NOT NULL REFERENCES preguntas(id),
  valor        REAL,
  opcion       TEXT,
  texto        TEXT,
  PRIMARY KEY (respuesta_id, pregunta_id)
);

CREATE TABLE acciones (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campana_id     INTEGER REFERENCES campanas(id) ON DELETE SET NULL,
  titulo         TEXT NOT NULL,
  prioridad      TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('alta','media','baja')),
  evidencia      TEXT,
  detalle        TEXT,
  responsable    TEXT,
  correo         TEXT,
  esfuerzo       TEXT,
  indicador      TEXT,
  estado         TEXT NOT NULL DEFAULT 'sugerida' CHECK (estado IN ('sugerida','curso','cerrada','descartada')),
  vence_en       TEXT,
  actualizada_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_acc_campana ON acciones(campana_id, estado);

CREATE TABLE admins (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  correo    TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL,
  hash      TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sesiones (
  id        TEXT PRIMARY KEY,
  admin_id  INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expira_en TEXT NOT NULL
);

CREATE TABLE ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
