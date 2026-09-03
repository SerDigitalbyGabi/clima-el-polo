-- Areas de El Polo
INSERT INTO areas (nombre) VALUES
  ('Operaciones'), ('Mantenimiento'), ('Seguridad'),
  ('Limpieza'), ('Administración'), ('Marketing');

-- Banco de preguntas. opciones va de la MEJOR respuesta a la PEOR:
-- el puntaje sale del orden, no de un numero guardado aparte.
INSERT INTO preguntas (texto, dimension, tipo, opciones, orden) VALUES
  ('¿Qué tan a gusto te sentiste trabajando este trimestre?',
   'clima', 'escala',
   '["😄 Muy bien","🙂 Bien","😐 Normal","🙁 Regular","😟 Mal"]', 1),

  ('¿Tu jefe directo te escucha cuando planteas algo?',
   'jefatura', 'escala',
   '["Siempre","Casi siempre","A veces","Nunca"]', 2),

  ('¿Tienes las herramientas y los materiales que necesitas para hacer bien tu trabajo?',
   'recursos', 'escala',
   '["Sí","Más o menos","No"]', 3),

  ('¿Estás aprendiendo algo nuevo en tu puesto?',
   'aprendizaje', 'escala',
   '["Sí, bastante","Algo","Casi nada","Nada, hago siempre lo mismo"]', 4),

  ('¿Te ves trabajando acá dentro de un año?',
   'permanencia', 'escala',
   '["Sí","No sé todavía","No"]', 5),

  ('¿En qué podemos mejorar? Escríbenos una cosa que cambiarías de tu día a día, por más chica que parezca.',
   'propuesta', 'texto', NULL, 6),

  ('¿Hay algo más que quieras decirnos?',
   'abierta', 'texto', NULL, 7),

  ('¿El trato entre compañeros de tu área es bueno?',
   'convivencia', 'escala',
   '["Sí, muy bueno","Bueno","Regular","Malo"]', 8),

  ('¿Sabes con claridad qué se espera de ti en tu puesto?',
   'claridad', 'escala',
   '["Sí, totalmente","En general sí","Más o menos","No"]', 9),

  ('¿Sientes que se reconoce cuando haces bien tu trabajo?',
   'reconocimiento', 'escala',
   '["Siempre","A veces","Casi nunca","Nunca"]', 10),

  ('¿Te avisan a tiempo los cambios de turno o de horario?',
   'organizacion', 'escala',
   '["Siempre","Casi siempre","A veces","Nunca"]', 11),

  ('¿Te sientes seguro en tu puesto de trabajo?',
   'seguridad', 'escala',
   '["Sí, siempre","Casi siempre","A veces no","No"]', 12);

INSERT INTO ajustes (clave, valor) VALUES
  ('organizacion',    'Centro Comercial El Polo'),
  ('remitente',       'Junta de Propietarios · C. C. El Polo'),
  ('canal_envio',     'manual'),
  ('minimo_anonimato','4'),
  ('correo_desde',    'plataforma@magconsulting.pe'),
  ('correo_nombre',   'MAG Consulting');
