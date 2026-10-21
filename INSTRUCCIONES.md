# Dibujo Técnico A4 — guía de uso y ejecución

## 1. Tecnologías del proyecto
- Monorepo **pnpm** (workspaces), Node 24 (configurado para Replit), TypeScript 5.9.
- App de dibujo: `artifacts/dibujo-tecnico-a4` → **React 19 + Vite 7 + Tailwind 4**, enrutado con wouter. El dibujo es un **SVG con coordenadas en milímetros** (hoja 210 × 297), guardado en **IndexedDB** (biblioteca de proyectos, un registro por proyecto). PDF vectorial con **pdf-lib**. Funciona **sin conexión** como PWA (service worker de `vite-plugin-pwa`, fuentes incluidas con `@fontsource`).
- Código de la app: `src/drawing/` (interfaz: `DrawingApp.tsx`, `EntityEditor.tsx`, `fields.tsx`) y `src/lib/` (lógica pura, probada en Node: `geometry.js`, `document.js`, `project.js` (formato v3), `storage.js` (IndexedDB), `save-manager.js` (guardado), `journal.js` (copia de cierre), `erase.js`, `view.js`, `pointer-policy.js`, `render.js`, `pdf-export.js`). La biblioteca y el arranque están en `src/drawing/Library.tsx` y `src/drawing/AppRoot.tsx`.
- Existe además `artifacts/api-server` (Express 5 + Drizzle/Postgres) y `lib/*` (cliente/zod generados). **La app de dibujo no los usa**: no hace falta servidor ni base de datos.

## 2. Ejecutar
- **Replit**: pulsa *Run* y abre la vista previa (funciona igual que antes; Replit sigue inyectando `PORT` y `BASE_PATH`).
- **Ordenador**: `corepack enable` · `pnpm install` · `pnpm --filter @workspace/dibujo-tecnico-a4 run dev` → http://localhost:5173 (ahora `PORT` y `BASE_PATH` tienen valor por defecto).
- **Pruebas** (sin navegador): `pnpm --filter @workspace/dibujo-tecnico-a4 run test` → geometría, modelo de documento/migración/historial/borrador/vista/punteros, almacenamiento (IndexedDB simulado con `fake-indexeddb`) y PDF.
- **Tipos**: `pnpm run typecheck:libs && pnpm --filter @workspace/dibujo-tecnico-a4 run typecheck`.
- **Extremo a extremo** (opcional, necesita Playwright y la app servida): `pnpm --filter @workspace/dibujo-tecnico-a4 run build`, `... run serve` y en otra terminal `E2E_URL=http://localhost:PUERTO/ pnpm --filter @workspace/dibujo-tecnico-a4 run test:e2e` (herramientas y entrada) y `... run test:e2e-storage` (biblioteca, guardado, conflictos, cierre, > 8 MB, orientación, sin conexión). Rendimiento del borrador: `... run perf:eraser -- grande` (carga reproducible).

## 3. Gratis desde la tablet
**Opción A — seguir en Replit (sin instalar nada):** abre tu proyecto en Chrome, sustituye/crea los archivos listados en la sección 7 y pulsa *Run*. Los límites del plan gratuito de Replit (hibernación, horas) dependen de tu plan actual: compruébalos.

**Opción B — alojamiento fijo y gratuito en GitHub Pages (recomendada para usarla a diario):**
1. Cuenta gratuita en github.com y un repositorio **público** (Pages gratis requiere repositorio público).
2. Lleva el proyecto al repositorio. Lo más cómodo desde Android: en Replit, panel *Git* → conectar con GitHub → *Push*. (Subir carpetas completas desde el navegador del móvil/tablet es incómodo.)
3. En el repositorio: *Settings → Pages → Source: GitHub Actions*.
4. Cada *push* a `main` ejecuta `.github/workflows/deploy-pages.yml`: instala, comprueba tipos, pasa las pruebas, compila y publica en `https://TU_USUARIO.github.io/NOMBRE_REPO/`.
5. En Chrome: menú ⋮ → *Instalar aplicación*. Tras la primera carga funciona sin conexión; cuando haya una versión nueva aparecerá «Actualizar ahora» (no se recarga sola a mitad de un dibujo).
Los nombres exactos de menús de Replit/GitHub pueden cambiar.

## 4. Convenciones, modelo y herramientas
- Milímetros de documento, origen arriba-izquierda. **Ángulos: 0° = derecha, 90° = arriba, sentido antihorario.**
- **Biblioteca de proyectos**: la app arranca en la biblioteca. Crear (nombre y orientación), abrir, duplicar, renombrar, eliminar (con confirmación), recientes, miniaturas, fecha de modificación y vistas de cuadrícula, lista y sin miniaturas. Cada proyecto se puede **exportar e importar** como archivo `.dta4.json` (formato v3 versionado); importar siempre crea un proyecto nuevo.
- **Guardado**: 1,5 s después de cada operación terminada, copia de respaldo cada 30 s, botón **Guardar** y al salir a la biblioteca. «Guardado» solo aparece cuando IndexedDB confirma la escritura. Si falla (p. ej., sin espacio) aparece «Error al guardar» con el motivo y los cambios siguen en pantalla. Si el mismo proyecto se guarda en otra pestaña, no se sobrescribe nada: se avisa del conflicto y se ofrece guardar los cambios como copia o cargar la versión guardada.
- **Cierre de la página**: al ocultarse o cerrarse con cambios sin confirmar, se escribe una copia síncrona en `localStorage` y se intenta guardar en IndexedDB. Al reabrir, la copia se aplica si nadie guardó después, se descarta si ya estaba guardada o se ofrece como copia si hay conflicto. Límite: si el proyecto no cabe en `localStorage` (~5 MB), solo queda el intento asíncrono, que el navegador no garantiza.
- **Orientación**: vertical (210 × 297) u horizontal (297 × 210), al crear el proyecto o después. Cambiarla no mueve ni deforma la geometría; se avisa de lo que quede fuera. PDF, PNG e impresión usan la orientación del proyecto.
- **Modelo editable**: cada elemento es una entidad con identificador: punto, segmento (dos extremos), circunferencia (centro y radio), arco (centro, radio, ángulo inicial y barrido) o trazo libre (puntos con presión). Pantalla, PNG y PDF dibujan la geometría exacta (arcos SVG y curvas de Bézier en el PDF, error radial < 0,000001 mm).
- **Sin imanes ni redondeos**: un toque se guarda exactamente donde se hizo; nada se ajusta a la cuadrícula ni a otros elementos y no hay relaciones automáticas. Las coincidencias exactas se consiguen escribiendo coordenadas o editando la entidad. Los campos muestran 3 decimales, pero solo sustituyen el valor guardado cuando escribes en ellos.
- **Regla**: toca el inicio y el final (o arrastra de uno a otro): la línea une exactamente esos dos puntos. Tras el primer toque también puedes escribir longitud y ángulo. La línea creada queda editable en el panel.
- **Compás**: toca el centro y luego un punto de la circunferencia (o arrastra): el radio es la distancia exacta. Modo arco: el segundo toque fija radio y ángulo inicial; el tercero, la dirección final (↺/↻). También por valores.
- **Punto**: marca un punto en la posición tocada.
- **Transportador**: vértice → rayo base (toque o valor) → ángulo exacto (↺/↻) → *Crear* (un solo *Deshacer*).
- **Paralela / Perpendicular**: toca un segmento como referencia → punto (o distancia) → *Crear*. La nueva línea no queda ligada a la referencia.
- **Borrador**: «Solo lo que toca» quita únicamente la parte atravesada (un segmento queda en dos, una circunferencia pasa a arco, un trazo libre se corta); «Elemento completo» quita todo lo que toques. Cada pasada se deshace con un *Deshacer*.
- **Seleccionar**: toca un elemento para ver y editar sus medidas exactas, aplicarle el color/grosor actual o eliminarlo.
- **Entrada**: el S Pen siempre dibuja. Modos del dedo (se guardan entre recargas): **Automático** (recomendado; el dedo mueve y amplía la hoja y nunca dibuja por accidente; si aún no se ha detectado un S Pen, al tocar con una herramienta de dibujo se ofrece «Dibujar con el dedo»), **Dedo navega** y **Dedo dibuja**. La detección del S Pen se activa con el primer apoyo o sobrevuelo del lápiz, se recuerda en este navegador y se puede «Olvidar» (vuelve al estado inicial, en el que el dedo no dibuja).
- **Toque o arrastre** se decide en píxeles de pantalla: hasta 10 px (lápiz), 12 px (dedo) o 4 px (ratón) es un toque y usa el punto exacto de apoyo; más allá es un arrastre. Así una vibración al tocar no crea geometría.
- **Palma**: se ignoran los toques con el lápiz apoyado o cerca (sobrevuelo o hasta 0,6 s tras levantarlo) y los contactos de más de 60 px. Sin sobrevuelo: un dedo no desplaza la hoja hasta moverse 12 px, y si el lápiz se apoya antes de 0,6 s desde que empezó ese desplazamiento, se deshace. Dos dedos siempre amplían (anclado bajo los dedos) y cancelan lo que el primero estuviera dibujando. Nada se confirma hasta levantar.
- **Interrupciones de Android** (pointercancel): un trazo libre o una pasada de borrador del lápiz se conservan hasta el punto de interrupción (un paso de deshacer, con aviso); una construcción a medias o un trazo del dedo se descartan sin cambiar nada.
- **Ratón**: botón principal dibuja; rueda desplaza; Ctrl + rueda amplía en el cursor.
- **Datos anteriores**: el dibujo guardado por versiones anteriores en `localStorage` (formato v2 o v1) se importa una sola vez como proyecto «Dibujo anterior», con sus valores exactos. El original no se borra. Si estuviera dañado, no se crea nada, se avisa y se puede exportar tal cual.

## 5. Escala física en pantalla
La calibración física y el botón 1:1 en pantalla están **ocultos** en esta versión (fuera del alcance de la primera versión; el código se conserva). La exportación PDF sí es A4 exacta (595,276 × 841,890 pt en vertical): al imprimir elige *tamaño real / 100 %* y mide un trazo en el papel.

## 6. Qué se comprobó y qué no
Ver el informe de cada etapa en la conversación de desarrollo. Resumen del estado actual:
- **Comprobado en Node**: `test-geometry.mjs`, `test-document.mjs` (migración, edición, historial, borrador exacto frente a fuerza bruta, vista, política de punteros) y `verify-a4-pdf.mjs` (A4 exacto, posiciones y curvas medidas dentro del PDF).
- **Comprobado en Chromium (escritorio, eventos simulados)**: `e2e-tools.mjs` con eventos de lápiz (`pointerType: 'pen'`) y táctiles enviados por el protocolo de depuración de Chrome.
- **NO comprobado**: S Pen y pantalla reales de la Galaxy Tab (presión, sobrevuelo, rechazo de palma del sistema, teclado decimal de Samsung), descargas en Chrome para Android, escala física e impresión en papel, y el flujo de GitHub Actions.
