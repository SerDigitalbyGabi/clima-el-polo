/* Del resultado a la accion.
   Reglas explicitas, no un modelo: cada sugerencia dice de que numero salio,
   asi la administracion puede discutirla en vez de tener que creerle. */

const BANCO = {
  recursos: {
    titulo: 'Reponer herramientas y materiales en {area}',
    detalle: 'Junta al equipo 30 minutos y armen entre todos la lista de lo que falta o está malogrado. Cotiza esa lista y compra lo aprobado dentro del mes. Cuando llegue, avisa por el grupo del área que salió de lo que ellos pidieron.',
    responsable: 'Jefe de {area}',
    esfuerzo: '1 reunión + compra',
    indicador: 'La pregunta sobre herramientas, en la próxima medición',
  },
  jefatura: {
    titulo: 'Diez minutos por persona en {area}',
    detalle: 'Que el supervisor converse 10 minutos con cada persona del área durante el mes, sin agenda formal. Una sola pregunta: qué le haría más fácil el trabajo. Anota lo que salga y responde en la siguiente reunión de área, aunque la respuesta sea que no se puede.',
    responsable: 'Supervisor de {area}',
    esfuerzo: '2 horas repartidas en el mes',
    indicador: 'La pregunta sobre el jefe directo, en la próxima medición',
  },
  organizacion: {
    titulo: 'Publicar el rol de turnos con 7 días de anticipación',
    detalle: 'Fija un día de la semana para publicar el rol del turno siguiente en el grupo de cada área. Si hay un cambio de última hora, que se avise en el mismo grupo y no persona por persona.',
    responsable: 'Supervisión de Operaciones',
    esfuerzo: '15 min por semana',
    indicador: 'La pregunta sobre avisos de turno, en la próxima medición',
  },
  aprendizaje: {
    titulo: 'Poner por escrito a dónde puede llegar cada puesto',
    detalle: 'Una hoja por área: qué hay que saber hacer para dar el salto al puesto siguiente y cuánto toma en promedio. No es una promesa de ascenso, es información que hoy nadie tiene. Se entrega el primer día y se repasa a los tres meses.',
    responsable: 'Jefaturas de área',
    esfuerzo: 'Una tarde, una sola vez',
    indicador: 'La pregunta sobre aprendizaje, en la próxima medición',
  },
  reconocimiento: {
    titulo: 'Dar una responsabilidad con nombre en {area}',
    detalle: 'A cada persona de buen desempeño, algo suyo: el control de inventario del área, la inducción de los nuevos, el reporte semanal. Que se anuncie delante del equipo. Un puesto se vuelve retador cuando alguien es responsable de algo, no cuando cambia el nombre del cargo.',
    responsable: 'Jefe de {area}',
    esfuerzo: 'Una conversación por persona',
    indicador: 'La pregunta sobre reconocimiento, en la próxima medición',
  },
  permanencia: {
    titulo: 'Cuidar los primeros 90 días',
    detalle: 'Tres conversaciones cortas con cada ingresante: a la semana, al mes y a los tres meses. Siempre las mismas dos preguntas: qué le está costando y qué no le explicaron bien.',
    responsable: 'Jefe directo del ingresante',
    esfuerzo: '15 min por conversación',
    indicador: 'Permanencia de quienes llevan menos de 6 meses',
  },
  convivencia: {
    titulo: 'Conversar el trato dentro de {area}',
    detalle: 'Una reunión de área de 45 minutos, sin jefaturas de otras áreas presentes. Se acuerdan tres reglas de convivencia concretas y se dejan por escrito donde todos las vean.',
    responsable: 'Jefe de {area}',
    esfuerzo: 'Una reunión',
    indicador: 'La pregunta sobre el trato entre compañeros, en la próxima medición',
  },
  claridad: {
    titulo: 'Una hoja con las tareas de cada puesto de {area}',
    detalle: 'Media carilla por puesto: qué hace todos los días, qué decide solo y qué consulta. Se revisa con la persona y se ajusta con lo que ella diga.',
    responsable: 'Jefe de {area}',
    esfuerzo: 'Media jornada',
    indicador: 'La pregunta sobre claridad del puesto, en la próxima medición',
  },
  seguridad: {
    titulo: 'Revisar las condiciones de seguridad en {area}',
    detalle: 'Recorre el área con dos personas del equipo y anota lo que ellos señalen como riesgoso. Lo que se pueda arreglar en el mes, se arregla; lo que no, se les dice cuándo.',
    responsable: 'Jefe de {area}',
    esfuerzo: 'Un recorrido + seguimiento',
    indicador: 'La pregunta sobre seguridad, en la próxima medición',
  },
  clima: {
    titulo: 'Sentarse con el equipo de {area}',
    detalle: 'Una reunión de una hora con el área, sin jefaturas de otras áreas presentes. Se leen los resultados tal como salieron y se les pregunta qué falta. De ahí salen dos compromisos con fecha, y se publican en el grupo del área.',
    responsable: 'Jefe de {area}',
    esfuerzo: 'Una reunión',
    indicador: 'Puntaje general del área, en la próxima medición',
  },
};

const UMBRAL_DIMENSION = 7.0; // debajo de esto la dimension entra al plan
const UMBRAL_AREA = 6.8;      // debajo de esto el area entra al plan
const CAIDA = 0.8;            // caida vs. medicion anterior que enciende alerta
const CONCENTRADO = 0.8;      // diferencia que vuelve el problema de un area puntual

const llenar = (t, area) => String(t).replace(/\{area\}/g, area || 'el área');

export function sugerir({ dimensiones, areas, participacion, comentarios, temas, anterior }) {
  const out = [];

  if (participacion != null && participacion < 0.7) {
    out.push({
      prioridad: 'alta',
      titulo: 'Empujar las respuestas que faltan',
      evidencia: `La participación va en ${Math.round(participacion * 100)}%. Debajo de 70% los promedios por área se vuelven poco confiables.`,
      detalle: 'Manda el recordatorio desde la plataforma. Si un área sigue baja, pídele al supervisor que lo mencione en la charla de inicio de turno: el recordatorio del jefe directo funciona mejor que el automático.',
      responsable: 'Supervisión de turno',
      esfuerzo: '1 mensaje',
      indicador: 'Participación de esta medición',
    });
  }

  // dimensiones flojas, de la peor hacia arriba
  const flojas = (dimensiones || [])
    .filter((d) => d.puntaje != null && d.puntaje < UMBRAL_DIMENSION && BANCO[d.dimension])
    .sort((a, b) => a.puntaje - b.puntaje)
    .slice(0, 4);

  for (const d of flojas) {
    const plantilla = BANCO[d.dimension];

    // si el problema se concentra en un area, la accion apunta ahi
    const foco = (d.porArea || [])
      .filter((a) => a.puntaje != null)
      .sort((x, y) => x.puntaje - y.puntaje)[0];
    const concentrado = foco && d.puntaje - foco.puntaje >= CONCENTRADO;
    const area = concentrado ? foco.area : null;

    const previo = anterior?.dimensiones?.find((x) => x.dimension === d.dimension)?.puntaje;
    const bajo = previo != null && previo - d.puntaje >= CAIDA;

    let evidencia = `${d.etiqueta} marcó ${d.puntaje.toFixed(1)} sobre 10`;
    if (concentrado) evidencia += `, y en ${foco.area} baja a ${foco.puntaje.toFixed(1)}`;
    if (bajo) evidencia += `. Bajó ${(previo - d.puntaje).toFixed(1)} puntos respecto de la medición anterior`;
    evidencia += `. Son ${d.n} respuestas.`;

    out.push({
      prioridad: d.puntaje < 5.5 || bajo ? 'alta' : 'media',
      titulo: llenar(plantilla.titulo, area),
      evidencia,
      detalle: llenar(plantilla.detalle, area),
      responsable: llenar(plantilla.responsable, area),
      esfuerzo: plantilla.esfuerzo,
      indicador: plantilla.indicador,
    });
  }

  // un area entera por debajo, aunque ninguna dimension suelta lo este
  const areaFloja = (areas || [])
    .filter((a) => a.puntaje != null && a.puntaje < UMBRAL_AREA)
    .sort((x, y) => x.puntaje - y.puntaje)[0];

  if (areaFloja && !out.some((o) => o.titulo.includes(areaFloja.area))) {
    out.push({
      prioridad: 'alta',
      titulo: llenar(BANCO.clima.titulo, areaFloja.area),
      evidencia: `${areaFloja.area} promedia ${areaFloja.puntaje.toFixed(1)}, el puntaje más bajo del centro comercial, sobre ${areaFloja.n} respuestas.`,
      detalle: llenar(BANCO.clima.detalle, areaFloja.area),
      responsable: llenar(BANCO.clima.responsable, areaFloja.area),
      esfuerzo: BANCO.clima.esfuerzo,
      indicador: `Puntaje general de ${areaFloja.area}, en la próxima medición`,
    });
  }

  // devolver los resultados cierra el ciclo: si no ven respuesta, la
  // participacion de la proxima medicion cae
  if (comentarios > 0) {
    const tema = temas && temas.length ? `, y "${temas[0].frase}" aparece en ${temas[0].veces} de ellos` : '';
    out.push({
      prioridad: 'baja',
      titulo: 'Contarles los resultados por el mismo canal',
      evidencia: `Llegaron ${comentarios} comentarios escritos${tema}. Si la gente no ve respuesta, la participación cae en la siguiente medición.`,
      detalle: 'Manda un mensaje corto por el mismo canal: el puntaje general, las dos cosas que más se repitieron y las dos que se van a hacer con fecha. Cinco líneas alcanzan.',
      responsable: 'Administración',
      esfuerzo: '20 minutos',
      indicador: 'Participación de la próxima medición',
    });
  }

  const peso = { alta: 0, media: 1, baja: 2 };
  return out.sort((a, b) => peso[a.prioridad] - peso[b.prioridad]);
}
