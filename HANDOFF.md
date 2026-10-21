# HANDOFF — Dibujo Técnico A4

Documento para continuar el desarrollo en una sesión nueva sin perder contexto ni repetir trabajo.
Redactado el 2026-10-21 a partir del estado real del repositorio, del historial de Git y de GitHub Actions, y del historial de la conversación de desarrollo.

> **Fuente de verdad.** Los requisitos los fijan el **«Documento maestro de requisitos y prompt de desarrollo» (versión 1.0)** que la persona entregó en la conversación, junto con sus decisiones posteriores. **Ese documento no está en el repositorio.** Este archivo solo lo resume y no sustituye al original. Si hay dudas o contradicciones, pide el documento original a la persona; no lo reconstruyas a partir de este resumen.

---

## 1. Estado actual verificado

### Repositorio y rama

| Dato | Valor (verificado el 2026-10-21) |
|---|---|
| Repositorio | `tobe089/dibujo-tecnico-a4` (GitHub) |
| Rama de trabajo | `claude/dibujo-tecnico-audit-dl746x` (local y `origin`) |
| Commit actual | `192f7e9` — «Etapa B: proyectos en IndexedDB, formato v3, biblioteca, guardado fiable, orientación y PWA» |
| `origin/claude/dibujo-tecnico-audit-dl746x` | `192f7e91d3330e780be484a7f6092fdc7a005c15`, igual que el commit local |
| `main` (local y `origin`) | `bb00f7a` — «Primera versión de Dibujo Técnico A4» (sin cambios) |
| Relación con `main` | La rama va 4 commits por delante de `main` y 0 por detrás; parte de `bb00f7a` |
| Cambios pendientes | Ninguno en archivos versionados (`git status` limpio antes de crear este archivo). `dist/` y `*.tsbuildinfo` los ignora Git. |
| Pull requests | Ninguno abierto |

> **Nombre de la rama.** La persona confirmó el 2026-10-21 que la rama correcta es **`claude/dibujo-tecnico-audit-dl746x`** (sin `-a4`). No crees ni uses otra rama sin su autorización.

### Historial de la rama

```
192f7e9  Etapa B: IndexedDB, formato v3, biblioteca, guardado fiable, orientación y PWA
01f9f9d  Correcciones de entrada e interfaz: temblor, palma, modo automático, márgenes y cancelación
e6cfce1  Etapas 1-3: modelo geométrico editable, motor de entrada, regla y compás exactos
6c75a3a  Etapa 0: corrige errores de tipos y añade comprobación de tipos y pruebas al flujo de CI
bb00f7a  Primera versión de Dibujo Técnico A4   ← main
```

Los commits `6c75a3a`, `e6cfce1` y `01f9f9d` pertenecen a un primer plan de trabajo (etapas 0–3 y correcciones de entrada), anterior al documento maestro. El plan A–H de la sección 4 empezó después, a partir de `01f9f9d`.

### GitHub Actions (verificado por la API)

- Solo hay un flujo: `.github/workflows/deploy-pages.yml` («Publicar en GitHub Pages»). Se ejecuta con `push` a `main`/`master` y con `workflow_dispatch`. Instala, comprueba tipos, ejecuta las pruebas, compila y **publica** en GitHub Pages.
- Ha tenido **una sola ejecución**: en `main`, sobre `bb00f7a`, el 2026-10-20, que **falló**. Según la auditoría de la etapa A, la instalación, las pruebas y la compilación pasaron y el fallo fue en `configure-pages`, probablemente porque Pages no está activado. Hay que tenerlo en cuenta: cualquier fusión en `main` o una ejecución manual intentaría publicar.
- La rama de trabajo no tiene ningún flujo propio ni ejecuciones.

### Pruebas, compilaciones y auditorías

**Comprobado directamente el 2026-10-21 sobre `192f7e9`** (Node 22.22; `pnpm` no estaba disponible en el contenedor, así que los comandos se lanzaron con `node`):

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` en los 6 proyectos con `tsconfig` (`artifacts/dibujo-tecnico-a4`, `artifacts/api-server`, `artifacts/mockup-sandbox`, `lib/api-client-react`, `lib/api-zod`, `lib/db`) | OK |
| `scripts/test-geometry.mjs` | OK, 14 293 comprobaciones |
| `scripts/test-document.mjs` | OK, 1 333 827 comprobaciones |
| `scripts/test-storage.mjs` | OK, 79 comprobaciones (incluye un proyecto de 8,3 MB empaquetado) |
| `scripts/verify-a4-pdf.mjs` | OK (error radial máximo 3,47·10⁻⁷ mm; la opción sin cuadrícula deja solo el dibujo) |
| `vite build` de la app con `BASE_PATH=/dibujo-tecnico-a4/` | OK; PWA `generateSW`, 35 archivos en caché (1251,95 KiB) |
| Historial de GitHub Actions | Revisado (ver arriba) |

**Según informes anteriores de la conversación, no repetido ahora.** Se ejecutó sobre el árbol de trabajo que luego se confirmó como `192f7e9`, en Chromium de escritorio con lápiz y dedo simulados:

| Comprobación | Resultado informado |
|---|---|
| `scripts/e2e-tools.mjs` (herramientas y entrada) | 105 comprobaciones OK |
| `scripts/e2e-storage.mjs` (biblioteca, migración, guardado, espacio lleno, 25 escrituras seguidas, dos pestañas, cierre y reapertura, importación de 9,1 MB, PDF y PNG en horizontal, sin conexión) | 55 comprobaciones OK. Una ejecución intermedia falló porque el escenario de cierre inmediato no llegó a ejercitarse; se corrigió la prueba (espera al estado «dirty» antes de cerrar y lo reintenta) y la ejecución final pasó. |
| `scripts/perf-eraser.mjs` (borrador, carga reproducible) | Carga pequeña (720 elementos): código del borrador 0,8 ms, hasta actualizar la pantalla 1,3 ms, del evento a la pantalla 17,1 ms de mediana, fotogramas p95 16,8 ms. Carga grande (1000 elementos, 168 000 puntos): 0,9 / 1,3 ms, del evento a la pantalla 16,9 ms de mediana y 32,5 ms de p95, 3 pausas largas de hasta 123 ms al soltar el lápiz. Referencia en `01f9f9d` con la carga pequeña: mediana de 57,4 ms. Esa referencia no se pudo repetir al final porque se perdió su compilación temporal. Todo medido en Chromium sin GPU, **no en la tablet**. |
| Auditoría de la etapa A (solo lectura) | Entregada en la conversación; no está en el repositorio. Hallazgos principales en la sección 5. |

**Nunca comprobado:** nada en la Galaxy Tab real (S Pen, presión, sobrevuelo, palma, teclado, modo avión, instalación de la PWA), ninguna impresión física, ninguna APK.

### Funciones

**Implementadas en el código (con pruebas automáticas):**
- Hoja A4 en mm (origen arriba a la izquierda, Y hacia abajo; ángulos: 0° a la derecha, 90° arriba, sentido antihorario), en vertical u horizontal como propiedad del documento.
- Entidades editables con identificador: punto, segmento, circunferencia, arco y trazo libre con presión. Se representan exactamente en pantalla, PNG y PDF.
- Herramientas (`src/drawing/DrawingApp.tsx`):
  - Trazo libre (`pen`), Punto, Seleccionar (editar medidas exactas), Mover vista (`pan`).
  - Regla y Compás **por toques o por valores**.
  - Transportador (vértice, rayo base, ángulo exacto).
  - Paralela y Perpendicular como construcciones puntuales.
  - Borrador parcial exacto, en modo «Solo lo que toca» o «Elemento completo».
- Sin imanes ni redondeos.
- Política de entrada:
  - Un desplazamiento pequeño cuenta como toque: hasta 10 px con lápiz, 12 px con dedo y 4 px con ratón.
  - Se rechaza la palma.
  - El dedo tiene tres modos: Automático, Dedo navega y Dedo dibuja.
  - Si Android interrumpe un gesto (`pointercancel`), se gestiona sin dejar nada a medias.
- Deshacer y rehacer.
- Etapa B:
  - Formato de proyecto v3.
  - IndexedDB con control de revisión.
  - Migración no destructiva desde `localStorage`.
  - Biblioteca de proyectos.
  - Guardado automático con sus estados.
  - Detección de conflictos entre pestañas.
  - Copia de emergencia al cerrar.
  - Exportación e importación JSON.
  - Uso sin conexión (PWA) con fuentes locales.
- Exportación PDF vectorial A4, PNG a 300 ppp e impresión, respetando la orientación.

**Incompletas o solo preparadas:**
- **Rotación de la vista:** el formato v3 tiene el campo `view.rotation`, pero siempre vale `0`. `view.js` no admite giros.
- **Configuración de los instrumentos:** el formato v3 guarda `instruments.{ruler,compass,protractor}`, pero solo con la visibilidad. Todavía no existen como instrumentos físicos que se puedan mover o girar.
- **Selección:** solo se puede seleccionar un elemento a la vez y solo ese se restaura al abrir.
- **Cálculos de impresión:** en el código está la escala física de pantalla, pero oculta (`SHOW_PHYSICAL_SCALE = false`). «Ajustar a página» y el aviso sobre los márgenes de la impresora corresponden a la etapa F.

**Todavía no implementadas** (etapas C–G):
- Rotación de la vista.
- Regla, compás y transportador como instrumentos físicos, y dibujo siguiendo el borde de la regla.
- Acción «Usar punto existente».
- Selección por lazo; mover y girar selecciones.
- Medición.
- Cotas asociadas.
- Agujero con ejes de centro.
- Texto y símbolos; fuente incrustada en el PDF.
- «Ajustar a página».
- APK con Capacitor y su flujo de compilación.

No hay ninguna búsqueda de `capacitor`, `fontkit`, `hole`, `dimension` ni «lazo» que encuentre código implementado.

---

## 2. Objetivo y requisitos del producto (resumen)

**Visión** (documento maestro, apartado 1): una mesa de dibujo técnico digital que combine el uso de instrumentos físicos (regla, compás, transportador) con la precisión de un programa CAD. Está orientada al uso universitario personal en una **Samsung Galaxy Tab S10 FE+ con S Pen**, con la interfaz en español. Las figuras tienen propiedades reales (coordenadas, longitud, radio, ángulo) que se pueden medir, editar y exportar. Primero se hace la versión web (PWA) y después una **APK de Android**.

**Requisitos técnicos esenciales:**
- **Geometría en milímetros**, independiente de la pantalla y del zoom. Una línea de 100 mm sigue midiendo 100 mm en cualquier vista. Se admiten decimales sin saltos.
- **Instrumentos funcionales:** regla, compás y transportador, que se pueden mover y girar, con valores exactos. Mostrarlos u ocultarlos no altera el dibujo.
- **Sin ajustes automáticos** (requisito explícito y prioritario):
  - nada de imanes hacia la cuadrícula, extremos, vértices o intersecciones;
  - no se redondean coordenadas ni ángulos;
  - no se crean relaciones geométricas automáticas;
  - los puntos solo se conectan por una acción explícita del usuario.
- **Borrado parcial:** el borrador recorta líneas, circunferencias y arcos y conserva las partes no tocadas. Elimina enteros los textos, las cotas y las anotaciones.
- **Cotas asociadas no paramétricas:** se actualizan cuando cambia la figura medida mientras siguen asociadas. Editar su texto nunca cambia la geometría. Ninguna cota redimensiona una figura.
- **Biblioteca local:** cada proyecto es un registro de IndexedDB y se puede importar o exportar como JSON versionado. En la APK habrá una biblioteca local con exportación y uso compartido en Android.
- **Guardado seguro:** se guarda tras cada operación (≈1–2 s) y cada 30 s. «Guardado» solo aparece tras confirmar la escritura. Los errores se notifican y no se sobrescribe ningún proyecto sin querer.
- **Uso sin conexión:** todas las funciones principales funcionan sin internet.
- **Exportación e impresión:** PDF A4 vertical u horizontal, con o sin cuadrícula; imagen; impresión a escala 1:1 comprobable con una regla física.
- **Futura APK de Android**, compilada con GitHub Actions si el entorno no tiene el SDK.
- **Requisitos no funcionales:**
  - fluidez en la tablet y memoria razonable;
  - geometría, representación, herramientas y persistencia separadas;
  - errores comprensibles;
  - pruebas automáticas de la geometría y la persistencia;
  - ninguna función falsa ni botón que no haga nada.

**Fuera de la primera versión** (documento maestro, apartado 16):
- relaciones geométricas automáticas (paralelismo o perpendicularidad persistentes);
- calibración física de pantalla y modo 1:1 en pantalla;
- tolerancias dimensionales;
- colaboración y sincronización en la nube.

---

## 3. Decisiones que deben conservarse

Son decisiones definitivas de la persona. No se pueden cambiar sin su autorización.

1. **Paralela y Perpendicular** se conservan solo como **construcciones puntuales independientes**: la línea nueva no guarda ninguna referencia a la original. En `01f9f9d` ya se comprobó que es así, y la etapa C debe añadir una prueba que lo demuestre. Si dejaran de cumplirlo, hay que ocultarlas.
2. **Calibración física y botón 1:1 en pantalla:** ocultos, conservando el código (`SHOW_PHYSICAL_SCALE = false`). La **impresión a escala 1:1 sí es un requisito**.
3. **Orientación:** es una propiedad del documento; se elige al crear el proyecto y se puede cambiar después. Cambiarla no deforma ni redimensiona la geometría. Si algo queda fuera, se avisa. PDF, PNG e impresión la respetan.
4. **Rotación de la vista** (etapa C):
  - es independiente de la geometría y nunca cambia coordenadas ni dimensiones;
  - debe tener un botón para restablecerla;
  - el gesto no debe interferir con el dibujo (umbral de unos 8°);
  - no hay ajuste a ángulos redondos.
5. **«Usar punto existente»:**
  - solo actúa después de activarla expresamente;
  - el usuario elige el punto; nunca se elige uno por proximidad;
  - usa exactamente las coordenadas del punto elegido.
6. **Dibujar siguiendo el borde de la regla:** está permitido solo con la regla activa y usada a propósito. No autoriza ningún ajuste a la cuadrícula ni a otras figuras.
7. **Cotas:** no paramétricas pero asociadas. Se actualizan cuando cambia la geometría que miden mientras siguen asociadas; si lo medido desaparece o se recorta, se desasocian, conservan su última medida y lo indican. Editar su texto no toca la geometría. **Nunca modifican las dimensiones de las figuras**; no hay restricciones dimensionales.
8. **Texto:** se escribe con el teclado de Android, incluida su escritura a mano si está disponible. No se desarrolla reconocimiento propio. Las notas manuscritas se hacen con el trazo libre.
9. **Agujero:** una circunferencia con sus ejes de centro técnicos.
10. **Almacenamiento (etapa B, ya implementada):**
  - **Migración no destructiva:** desde `localStorage` (formatos v1 y v2) se puede repetir sin crear duplicados (marca `migracion-localstorage` e identificador fijo `migrado-localstorage`). El original no se borra ni se modifica. Si los datos están dañados, se avisa y se ofrece exportarlos, sin marcar la migración como hecha.
  - **IndexedDB:** base `dibujo-tecnico-a4` con tres almacenes: `projects`, `index` y `settings`. Proyecto e índice se escriben en la misma transacción. La escritura es condicional (revisión esperada); si no coincide, se lanza `ConflictError` y no se sobrescribe nada.
  - **Conflictos entre pestañas:** las pestañas se avisan por `BroadcastChannel('dibujo-tecnico-a4')`. Una pestaña sin cambios se recarga; una con cambios muestra el conflicto y ofrece reintentar, guardar como copia, cargar la versión guardada o exportar JSON. **Nunca se sobrescribe en silencio.**
  - **Estados de guardado:**
    - «Cambios sin guardar», «Guardando…», «Guardado» (solo tras confirmar), «Error al guardar» (con el motivo) y conflicto;
    - se guarda 1,5 s después de cada operación y cada 30 s, con una sola escritura en curso;
    - copia de emergencia síncrona en `localStorage` al ocultar o cerrar la página (clave `dibujo-tecnico-a4-pendiente`).
11. **Web y APK:** en la web, IndexedDB más JSON. En la APK, biblioteca local con exportación y uso compartido en Android. La APK se puede compilar con GitHub Actions.
12. **Dependencias:** no se elimina ningún paquete sin demostrar que no se usa, justificarlo y tener autorización (etapa H).
13. **Desarrollo por etapas:** al terminar cada etapa se informa de los cambios, las pruebas, los resultados, las limitaciones y lo pendiente, y **se espera autorización expresa** antes de empezar la siguiente.

---

## 4. Etapas y próximos pasos

El plan completo, con sus criterios de aceptación, se entregó en la conversación (marcas: **[Auto]** pruebas automáticas, **[Tab]** en la tablet, **[Imp]** con impresora, **[APK]** con la APK instalada). Resumen:

| Etapa | Contenido | Estado |
|---|---|---|
| A | Auditoría breve sin cambios de código: estado de las pruebas, dependencias usadas y sin usar, diseño del formato v3 | **Completada** (informe en la conversación, sin commit) |
| B | IndexedDB, formato v3, migración, biblioteca, guardado fiable, orientación y uso sin conexión (PWA); calibración y 1:1 ocultos | **Informada como terminada** en `192f7e9`. Pruebas automáticas OK (sección 1). **Pendiente de verificar en la tablet [Tab].** |
| C | Rotación de la vista; regla, compás y transportador como instrumentos físicos; «Usar punto existente»; prueba de Paralela y Perpendicular | **No autorizada** |
| D | Selección por lazo; mover y girar con valores exactos; deshacer como un solo paso | No autorizada |
| E | Medición; cotas asociadas no paramétricas; agujero; texto y símbolos; borrador sobre textos y cotas | No autorizada |
| F | PDF (incluidos cotas y texto con fuente incrustada), impresión 1:1 o ajustada con aviso de márgenes, PNG a 300 ppp, notificación de errores | No autorizada |
| G | APK con Capacitor (archivos y compartir); flujo de GitHub Actions que compila una APK de prueba solo en la rama de trabajo, sin firma de producción | No autorizada |
| H | Limpieza de dependencias y archivos sin uso (opcional, con autorización aparte) | No autorizada |

En la etapa C, el plan es cambiar primero `view.js` para admitir una transformación completa con rotación, y después los instrumentos, porque dependen de ella.

### Siguiente paso inmediato (todavía no autorizado)

1. **Preparar una manera segura de probar exactamente `192f7e9` en la Galaxy Tab S10 FE+**, sin publicar la aplicación ni modificar `main`. **No hagas cambios de código ni configures nada para ello sin autorización.** Qué conviene saber:
  - **No vale publicar en GitHub Pages:** el único flujo publica y solo se ejecuta en `main` o a mano.
  - **Ya se usó** una vista previa privada en claude.ai para `01f9f9d`: https://claude.ai/artifact/2AxyRuKSmUgzJFtqWUinXJ. Si se repite con `192f7e9`, hay que comprobar si esa vista previa admite IndexedDB, el *service worker* y la instalación como PWA. Si no los admite, las pruebas de guardado y sin conexión no serían válidas allí.
  - **Antes de proponer un método** (por ejemplo, la vista previa privada o servir la compilación en la red local), consulta con la persona.
2. **En la tablet**, verificar con la persona:
  - **Migración:** un dibujo antiguo de `localStorage` aparece como «Dibujo anterior» y coincide con el original.
  - **Guardado:** se espera a «Guardado», se cierra Chrome y al reabrir no falta nada. Además, cerrar inmediatamente después de dibujar y comprobar si aparece la recuperación.
  - **Modo avión:** con la PWA instalada, abrir, dibujar, guardar, cerrar y reabrir.
  - **Orientación:** cambiar de horizontal a vertical y volver; exportar PDF y PNG; imprimir.
  - **Borrado parcial:** fluidez con el S Pen y la pausa al soltar en un dibujo grande.
  - **Conflictos:** el mismo proyecto en dos pestañas.
  - **Biblioteca:** crear, renombrar, duplicar, eliminar, exportar e importar JSON, las tres vistas y las miniaturas.

---

## 5. Riesgos y limitaciones conocidos

- **Copia de emergencia limitada a unos 5 MB:** si el proyecto no cabe en `localStorage`, solo queda el guardado asíncrono en IndexedDB, que el navegador no garantiza al cerrar.
- **Cierre forzado de Android y guardado inmediato:** no están garantizados. `pagehide` no asegura que termine una escritura asíncrona. En Chromium de escritorio la escritura terminó; la recuperación desde la copia de emergencia solo está probada en Node y no se ha ejercitado en el navegador.
- **Persistencia del navegador:** si no concede el almacenamiento persistente (`navigator.storage.persist()`), el navegador puede borrar los datos cuando le falta espacio. La biblioteca lo avisa y recomienda exportar JSON.
- **Sin validar en la tablet:** la fluidez del borrador, el S Pen (presión, sobrevuelo, palma), el teclado decimal de Samsung y las descargas en Chrome para Android. Las cifras de rendimiento son de Chromium de escritorio sin GPU.
- **Pausa al soltar el borrador** en dibujos grandes (hasta unos 123 ms en la prueba de 168 000 puntos), cuando se aplica el borrado exacto.
- **Estela del borrador:** durante el arrastre tapa también la guía del margen. En el modo «Elemento completo» solo se ve la banda hasta soltar.
- **APK:** no está construida ni probada. No hay ningún proyecto Android ni Capacitor en el repositorio.
- **Compilación de Android:** depende de crear un flujo adecuado de GitHub Actions, porque el entorno anterior no tenía el SDK de Android y `dl.google.com` estaba bloqueado. Java 21 y Gradle 8.14 sí estaban; esta sesión vuelve a encontrar `java` y `gradle`, sin `ANDROID_HOME`, `sdkmanager` ni `adb`.
- **Impresión:** ni el navegador ni Android informan de los márgenes reales de la impresora. En la APK, la vista web no imprime con el método del navegador y hará falta un complemento (etapa G).
- **Texto en la exportación** (etapas E y F): las fuentes estándar del PDF no tienen «⌀» (U+2300), así que hará falta `@pdf-lib/fontkit` con una fuente incrustada. Para el PNG, las fuentes tienen que ir dentro del propio SVG.
- **Cotas y borrador** (etapa E): al cortar una figura, el primer trozo conserva el identificador. Hay que aplicar la regla de desasociación propuesta para que una cota no siga en silencio a un extremo que ya no es el mismo.
- **Flujo de Pages:** una fusión en `main` o una ejecución manual intentaría publicar. Su único resultado hasta ahora es un fallo en `configure-pages`.
- **Repositorio:**
  - `pnpm run build` del repositorio completo falla sin `PORT`, por `mockup-sandbox`;
  - `replit.md` sigue siendo la plantilla original;
  - la auditoría A encontró unos 41 paquetes y 52 componentes sin usar, más `api-server`, `lib/*` y `mockup-sandbox`, que la app no utiliza. Todo esto es para la etapa H y no se toca sin autorización.
- **Entorno:** en esta sesión `pnpm` no estaba disponible (corepack fallaba al buscar `pnpm.cjs`). Las pruebas se pueden lanzar con `node scripts/<prueba>.mjs` y la compilación con `node node_modules/vite/bin/vite.js build`. Las pruebas E2E necesitan Playwright y la app servida (`INSTRUCCIONES.md`, apartado 2).
- **Configuración:** `vite.config.ts` conserva una opción de mapas de código (`SOURCEMAP=1`) añadida al medir el rendimiento. Está desactivada por defecto.

---

## 6. Reglas de trabajo para futuras sesiones

- Trabaja exclusivamente en la rama **`claude/dibujo-tecnico-audit-dl746x`**, salvo autorización expresa. Nombre confirmado por la persona (sin `-a4`).
- **No modifiques `main`, no publiques** (ni en GitHub Pages ni en producción), **no abras pull requests y no limpies dependencias** sin autorización.
- Instala solo las dependencias necesarias y justificadas para la etapa autorizada.
- No des por implementada una función solo porque aparezca en la interfaz: compruébalo en el código y con pruebas.
- No digas que una prueba pasó sin evidencia (salida del comando). Separa lo verificado automáticamente de lo que requiere la tablet, la impresora o la APK. Si un escenario no se llegó a ejercitar, dilo.
- **No implementes imanes ni ajustes automáticos.** No redondees coordenadas ni ángulos y no añadas relaciones geométricas automáticas.
- Al terminar cada etapa, informa de los cambios, los archivos, las pruebas y sus resultados, las limitaciones y los pasos manuales para la tablet. Después **espera autorización** para la siguiente.
- Commits: mensajes descriptivos en español y `git push -u origin claude/dibujo-tecnico-audit-dl746x`.
- Comunicación con la persona: en español.

---

## 7. Mapa rápido del código

- App: `artifacts/dibujo-tecnico-a4` (React 19, Vite 7, Tailwind 4, wouter, pdf-lib, vite-plugin-pwa).
- `src/lib/` (lógica pura, probada en Node):
  - `geometry`, `document` (modelo y migración), `project` (formato v3), `storage` (IndexedDB), `save-manager`, `journal` (copia de emergencia);
  - `erase`, `view`, `pointer-policy`, `render`, `pdf-export`.
- `src/drawing/` (interfaz):
  - `AppRoot.tsx` (arranque, migración, recuperación, PWA) y `Library.tsx` (biblioteca);
  - `DrawingApp.tsx` (editor), `EntityEditor.tsx`, `fields.tsx` y `project-io.ts`.
- `scripts/` de la app: `test-geometry`, `test-document`, `test-storage`, `verify-a4-pdf` (Node); `e2e-tools`, `e2e-storage`, `perf-eraser` (Chromium con Playwright).
- Guía de uso y ejecución: `INSTRUCCIONES.md`. Memoria del proyecto: `.agents/memory/dibujo-tecnico-a4.md`.
