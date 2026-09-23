# CARLÉA 3.4.0 — Actualización integral

Base de trabajo: **CARLÉA 3.3.2 Cloudflare Directo**. La actualización es incremental: conserva la arquitectura existente y añade/refactoriza funciones sin reconstruir la plataforma.

## Qué cambia

- Mantiene el logo oficial existente sin modificación.
- Consolida roles visitante, usuario, creadora y administrador; Premium/Diamond siguen siendo membresías globales del cliente.
- Añade registro específico de creadoras con confirmación de correo, documento frontal/reverso, selfie, aceptación legal separada y pago manual pendiente de la membresía de creadora.
- Añade ranking dinámico de creadoras por actividad real con decaimiento temporal y límites anti-gaming.
- Refuerza perfil público de creadora y previews protegidos para contenido Premium/Diamond.
- Amplía chat Realtime: no leídos, `read_at`, `99+`, Presence/escribiendo, sonido configurable, agrupación por fecha y moderación identificada.
- Detecta posibles intercambios de contacto externo y crea alertas administrativas sin bloquear automáticamente el mensaje.
- Separa Mensajes y Notificaciones y añade acciones de lectura/eliminación lógica.
- Rediseña el entorno de creadora: ganancias del mes, visibilidad, pendientes, contenido, experiencias, agenda y movimientos económicos.
- Refactoriza experiencias sobre las estructuras existentes, con disponibilidad por creadora, horario solicitado, respuesta y SLA administrativo.
- Añade videollamadas de 30/60/90 min por $49.900/$79.900/$99.900 COP, pago manual, aceptación de la creadora y temporizador desde el inicio real.
- Registra el reparto de videollamadas 80% creadora / 20% CARLÉA en un ledger financiero.
- Añade centro administrativo de pagos, liquidaciones, métricas, reportes, auditoría y moderación de chats.
- La eliminación sensible de cuentas requiere backend + reautenticación; cuando hay dependencias financieras, de auditoría o relaciones, se prioriza anonimización/suspensión.
- Añade estética negro/azul oscuro/dorado con llamas azules abstractas en CSS, adaptable a móvil y escritorio.

## Decisión económica pendiente

El prompt define explícitamente la comisión de videollamadas (80/20), pero **no define una comisión CARLÉA para experiencias**. Para no inventar una regla económica, CARLÉA 3.4.0 registra las experiencias completadas con comisión de plataforma `0` hasta que se defina el porcentaje o tarifa correspondiente.

## Archivos principales modificados

- `index.html`
- `styles.css`
- `js/app.js`
- `js/chat.js`
- `js/video.js`
- `_worker.js`
- `supabase/migrations/20260922123000_integral_carlea_3_4.sql`
- pruebas de regresión en `tests/`

## Validación realizada

- `tests/static_check.mjs`: PASS.
- `tests/integral_3_4.test.mjs`: 5/5 PASS.
- `tests/membership.test.mjs`: 7/7 PASS.
- `tests/cloudflare.test.mjs`: 5/5 PASS.
- `node --check` sobre todos los JavaScript y `_worker.js`: PASS.

No se ejecutó una integración PostgreSQL/WASM porque PGlite no está instalado en este entorno, ni una prueba Playwright porque Playwright no está instalado. Por eso la migración debe aplicarse primero en un proyecto Supabase de staging y validarse allí antes de producción.
