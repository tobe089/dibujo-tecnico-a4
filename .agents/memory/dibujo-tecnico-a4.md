---
name: Dibujo Técnico A4
description: Product requirements that should guide future work on the tablet drawing app.
---

La aplicación Dibujo Técnico A4 está pensada para una Samsung Galaxy Tab S10 FE+ con S Pen. Los dibujos deben guardarse localmente; no añadir suscripciones, pagos, servicios externos ni claves API innecesarios.

**Why:** la persona quiere una herramienta funcional y sencilla para dibujo técnico en su tablet, sin servicios adicionales.

**How to apply:** prioriza entrada con S Pen, controles táctiles y persistencia local al añadir herramientas; mantén las medidas documentales en milímetros. Mide las áreas táctiles renderizadas en el viewport de tablet: las columnas de CSS Grid pueden reducirlas aunque el estilo declare una altura mínima adecuada.

**Precisión (requisito explícito de la persona):** no implementar imanes ni ajustes automáticos (cuadrícula, extremos, vértices, intersecciones), no redondear coordenadas ni ángulos para forzar coincidencias y no crear relaciones geométricas automáticas; los puntos solo se conectan por acción explícita del usuario (coordenadas escritas o edición).
