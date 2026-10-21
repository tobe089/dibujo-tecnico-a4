# Dibujo Técnico A4 — guía de uso y ejecución

## 1. Tecnologías del proyecto
- Monorepo **pnpm** (workspaces), Node 24 (configurado para Replit), TypeScript 5.9.
- App de dibujo: `artifacts/dibujo-tecnico-a4` → **React 19 + Vite 7 + Tailwind 4**, enrutado con wouter. El dibujo es un **SVG con coordenadas en milímetros** (hoja 210 × 297), guardado en `localStorage`. PDF vectorial con **pdf-lib**.
- Código de la app: `src/drawing/` (interfaz: `DrawingApp.tsx`, `EntityEditor.tsx`, `fields.tsx`) y `src/lib/` (lógica pura, probada en Node: `geometry.js`, `document.js`, `erase.js`, `view.js`, `pointer-policy.js`, `render.js`, `pdf-export.js`).
- Existe además `artifacts/api-server` (Express 5 + Drizzle/Postgres) y `lib/*` (cliente/zod generados). **La app de dibujo no los usa**: no hace falta servidor ni base de datos.

## 2. Ejecutar
- **Replit**: pulsa *Run* y abre la vista previa (funciona igual que antes; Replit sigue inyectando `PORT` y `BASE_PATH`).
- **Ordenador**: `corepack enable` · `pnpm install` · `pnpm --filter @workspace/dibujo-tecnico-a4 run dev` → http://localhost:5173 (ahora `PORT` y `BASE_PATH` tienen valor por defecto).
- **Pruebas** (sin navegador): `pnpm --filter @workspace/dibujo-tecnico-a4 run test` → geometría, modelo de documento/migración/historial/borrador/vista/punteros y PDF.
- **Tipos**: `pnpm run typecheck:libs && pnpm --filter @workspace/dibujo-tecnico-a4 run typecheck`.
- **Extremo a extremo** (opcional, necesita Playwright y la app servida): `pnpm --filter @workspace/dibujo-tecnico-a4 run build`, `... run serve` y en otra terminal `E2E_URL=http://localhost:PUERTO/ pnpm --filter @workspace/dibujo-tecnico-a4 run test:e2e`.

## 3. Gratis desde la tablet
**Opción A — seguir en Replit (sin instalar nada):** abre tu proyecto en Chrome, sustituye/crea los archivos listados en la sección 7 y pulsa *Run*. Los límites del plan gratuito de Replit (hibernación, horas) dependen de tu plan actual: compruébalos.

**Opción B — alojamiento fijo y gratuito en GitHub Pages (recomendada para usarla a diario):**
1. Cuenta gratuita en github.com y un repositorio **público** (Pages gratis requiere repositorio público).
2. Lleva el proyecto al repositorio. Lo más cómodo desde Android: en Replit, panel *Git* → conectar con GitHub → *Push*. (Subir carpetas completas desde el navegador del móvil/tablet es incómodo.)
3. En el repositorio: *Settings → Pages → Source: GitHub Actions*.
4. Cada *push* a `main` ejecuta `.github/workflows/deploy-pages.yml`: instala, comprueba tipos, pasa las pruebas, compila y publica en `https://TU_USUARIO.github.io/NOMBRE_REPO/`.
5. En Chrome: menú ⋮ → *Añadir a pantalla de inicio / Instalar*. (No hay modo sin conexión implementado.)
Los nombres exactos de menús de Replit/GitHub pueden cambiar.

## 4. Convenciones, modelo y herramientas
- Milímetros de documento, origen arriba-izquierda. **Ángulos: 0° = derecha, 90° = arriba, sentido antihorario.**
- **Modelo editable (formato v2)**: cada elemento es una entidad con identificador: punto, segmento (dos extremos), circunferencia (centro y radio), arco (centro, radio, ángulo inicial y barrido) o trazo libre (puntos con presión). Pantalla, PNG y PDF dibujan la geometría exacta (arcos SVG y curvas de Bézier en el PDF, error radial < 0,000001 mm).
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
- **Datos anteriores**: un dibujo del formato v1 se convierte automáticamente al abrir la app (líneas, círculos y arcos con sus valores exactos; trazos libres como trazos libres). El original v1 no se borra.

## 5. Escala física
Un navegador no conoce el tamaño real de la pantalla. Por eso:
1. Pulsa **Calibrar**, apoya una regla física sobre la barra y escribe su medida real.
2. Pulsa **1:1**. La hoja (297 mm) no cabrá entera en la altura de la tablet: desplázala.
3. **Compruébalo tú**: crea con la regla una línea de 100 mm y mídela con una regla física; si difiere más de ~0,5 mm, recalibra.
4. PDF: la página es A4 exacta (595,276 × 841,890 pt). Al imprimir elige *tamaño real / 100 %* y mide un trazo en el papel.

## 6. Qué se comprobó y qué no
Ver el informe de cada etapa en la conversación de desarrollo. Resumen del estado actual:
- **Comprobado en Node**: `test-geometry.mjs`, `test-document.mjs` (migración, edición, historial, borrador exacto frente a fuerza bruta, vista, política de punteros) y `verify-a4-pdf.mjs` (A4 exacto, posiciones y curvas medidas dentro del PDF).
- **Comprobado en Chromium (escritorio, eventos simulados)**: `e2e-tools.mjs` con eventos de lápiz (`pointerType: 'pen'`) y táctiles enviados por el protocolo de depuración de Chrome.
- **NO comprobado**: S Pen y pantalla reales de la Galaxy Tab (presión, sobrevuelo, rechazo de palma del sistema, teclado decimal de Samsung), descargas en Chrome para Android, escala física e impresión en papel, y el flujo de GitHub Actions.
