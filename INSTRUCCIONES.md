# Dibujo Técnico A4 — guía de uso y ejecución

## 1. Tecnologías del proyecto
- Monorepo **pnpm** (workspaces), Node 24 (configurado para Replit), TypeScript 5.9.
- App de dibujo: `artifacts/dibujo-tecnico-a4` → **React 19 + Vite 7 + Tailwind 4**, enrutado con wouter. El dibujo es un **SVG con coordenadas en milímetros** (hoja 210 × 297), guardado en `localStorage`. PDF vectorial con **pdf-lib**.
- Existe además `artifacts/api-server` (Express 5 + Drizzle/Postgres) y `lib/*` (cliente/zod generados). **La app de dibujo no los usa**: no hace falta servidor ni base de datos.

## 2. Ejecutar
- **Replit**: pulsa *Run* y abre la vista previa (funciona igual que antes; Replit sigue inyectando `PORT` y `BASE_PATH`).
- **Ordenador**: `corepack enable` · `pnpm install` · `pnpm --filter @workspace/dibujo-tecnico-a4 run dev` → http://localhost:5173 (ahora `PORT` y `BASE_PATH` tienen valor por defecto).
- **Pruebas**: `pnpm --filter @workspace/dibujo-tecnico-a4 run test:geometry` y `... run verify:pdf`.

## 3. Gratis desde la tablet
**Opción A — seguir en Replit (sin instalar nada):** abre tu proyecto en Chrome, sustituye/crea los archivos listados en la sección 7 y pulsa *Run*. Los límites del plan gratuito de Replit (hibernación, horas) dependen de tu plan actual: compruébalos.

**Opción B — alojamiento fijo y gratuito en GitHub Pages (recomendada para usarla a diario):**
1. Cuenta gratuita en github.com y un repositorio **público** (Pages gratis requiere repositorio público).
2. Lleva el proyecto al repositorio. Lo más cómodo desde Android: en Replit, panel *Git* → conectar con GitHub → *Push*. (Subir carpetas completas desde el navegador del móvil/tablet es incómodo.)
3. En el repositorio: *Settings → Pages → Source: GitHub Actions*.
4. Cada *push* a `main` ejecuta `.github/workflows/deploy-pages.yml`: instala, pasa las pruebas de geometría y PDF, compila y publica en `https://TU_USUARIO.github.io/NOMBRE_REPO/`.
5. En Chrome: menú ⋮ → *Añadir a pantalla de inicio / Instalar*. (No hay modo sin conexión implementado.)
Los nombres exactos de menús de Replit/GitHub pueden cambiar.

## 4. Convenciones y herramientas
- Milímetros de documento, origen arriba-izquierda. **Ángulos: 0° = derecha, 90° = arriba, sentido antihorario.** Los arcos avanzan en sentido antihorario del ángulo inicial al final.
- **Regla**: toca inicio → toca dirección (o escribe el ángulo) → longitud exacta → *Crear*.
- **Compás**: toca centro → radio (escrito o tomado de un toque) → circunferencia completa o arco (inicio/fin).
- **Transportador**: toca vértice → orienta el rayo base → ángulo exacto (↺/↻) → crea rayos y arco marcador (un solo *Deshacer* los quita todos).
- **Paralela / Perpendicular**: toca una línea recta como referencia → punto (o distancia entre paralelas; en perpendicular también «hasta la recta»).
- **Imanes** a la cuadrícula de 1 mm y a extremos, medios, centros y cuadrantes de lo ya dibujado. «Ratón como lápiz» solo sirve para probar en PC.
- Las curvas se guardan como polilíneas con desviación máxima de 0,002 mm respecto al arco teórico.

## 5. Escala física
Un navegador no conoce el tamaño real de la pantalla. Por eso:
1. Pulsa **Calibrar**, apoya una regla física sobre la barra y escribe su medida real.
2. Pulsa **1:1**. La hoja (297 mm) no cabrá entera en la altura de la tablet: desplázala.
3. **Compruébalo tú**: crea con la regla una línea de 100 mm y mídela con una regla física; si difiere más de ~0,5 mm, recalibra.
4. PDF: la página es A4 exacta (595,276 × 841,890 pt). Al imprimir elige *tamaño real / 100 %* y mide un trazo en el papel.

## 6. Qué se comprobó y qué no
**Comprobado (en el entorno donde se preparó, sin red):**
- Matemática de `geometry.js`: 13 895 comprobaciones numéricas (ángulos, longitudes, arcos, paralelas, perpendiculares, imanes).
- PDF: página A4, segmento de 50 mm y circunferencia de radio 30 mm, sin imágenes raster.
- Interfaz: 386 comprobaciones con Chromium sobre este `App.tsx`, sustituyendo por «stubs» iconos, router y react-query (no estaban disponibles). Incluye creación con cada herramienta, deshacer/rehacer, selección, exportación PNG/PDF, calibración y carga de documentos de la versión anterior.
- Dos errores previos corregidos: el **PNG salía con el interior negro** (el rectángulo de márgenes dependía de una clase CSS que no viaja en el SVG exportado) y `<o>` en lugar de `<output>` en el rótulo del grosor.

**NO comprobado:** compilación con Vite/Tailwind y dependencias reales, comprobación de tipos TypeScript completa, comportamiento del S Pen real (presión, sobrevuelo, rechazo de palma), escala física en la pantalla y en papel impreso, y el flujo de GitHub Actions (nunca se ejecutó).

## 7. Archivos modificados o nuevos
- `artifacts/dibujo-tecnico-a4/src/App.tsx` (modificado)
- `artifacts/dibujo-tecnico-a4/src/index.css` (modificado: estilos nuevos y altura fija de la app)
- `artifacts/dibujo-tecnico-a4/src/lib/geometry.js` y `geometry.d.ts` (nuevos)
- `artifacts/dibujo-tecnico-a4/scripts/test-geometry.mjs` (nuevo) y `verify-a4-pdf.mjs` (ampliado)
- `artifacts/dibujo-tecnico-a4/vite.config.ts`, `package.json`, `index.html` (cambios mínimos)
- `.github/workflows/deploy-pages.yml` e `INSTRUCCIONES.md` (nuevos)
- Sin cambios: `src/lib/pdf-export.js` (el PDF ya era vectorial y sirve para arcos y círculos).
