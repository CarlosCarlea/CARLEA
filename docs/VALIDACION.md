# Validación de la revisión 3.2.2

Fecha: 21 de septiembre de 2026. Solo pruebas locales; sin escrituras remotas.

## Resultado real

| Comprobación | Resultado | Alcance |
|---|---|---|
| Sintaxis de JavaScript | Aprobada | Archivos propios y pruebas; no demuestra integración |
| Compatibilidad estática | Aprobada | Consultas obsoletas retiradas, funciones y elementos legales conservados |
| Destino por rol después del ingreso | Aprobada | Admin → administración; creadora → estudio; cliente → inicio; cuenta no activa → perfil |
| Imágenes del catálogo | Aprobada | Portadas empaquetadas, URL estable, fallback y foto pública aprobada más reciente |
| Perfil y portada de creadora | Aprobada | Privilegios mínimos + RLS; recarga local y Realtime |
| Subida de publicaciones | Aprobada | Storage privado, INSERT de metadatos, limpieza al fallar y vista previa en estudio |
| Creación de cuenta | Aprobada | Trigger probado en transacción reversible; crea `profiles` y conserva aprobación pendiente |
| Adaptador de permisos | 7 pruebas aprobadas | Gratis/Premium/Diamante, precios, respuestas inválidas, vencimiento |
| Migración SQL local | 36 comprobaciones aprobadas | PostgreSQL/WASM PGlite; fixture reducido y sintético |
| Escritorio y móvil | Pendiente | Chromium no disponible; descarga agotó el tiempo de espera |
| Supabase real después de la migración | No ejecutada | Migración no aplicada, por autorización explícita |
| Realtime entre cuentas, Storage, cámara y micrófono | Pendiente | No se simula su aprobación |

Las 36 comprobaciones ejecutan la migración en una base efímera. Incluyen
permisos de ejecución, RLS de lectura de membresías, prohibición de escritura
directa, autorización administrativa, idempotencia, cancelación al vencimiento,
expiración, suspensión, aislamiento de conversación mediante helpers, propiedad
de creadora, rechazo de solicitudes posteriores al corte sin verificación y
continuidad temporal de membresías activas anteriores al corte. No prueban todas
las políticas reales, triggers de Auth, PostgREST, Storage ni Realtime.

El fixture de `tests/sql-fixture.sql` NO es una copia completa de la base y NO
debe ejecutarse en Supabase. Las pruebas previas de la versión 3.1 se conservan
como históricas y no se atribuyen a esta revisión.

## Reproducir localmente

Desde la raíz de esta copia:

```sh
node tests/static_check.mjs
node --test tests/membership.test.mjs
npm install --no-save --ignore-scripts @electric-sql/pglite@0.3.14
node tests/migration.test.mjs
```

Para la prueba visual pendiente, usar Playwright con Chromium instalado:

```sh
node tests/browser.test.mjs
```

La prueba visual acepta `PLAYWRIGHT_MODULE` con la ruta al módulo y
`CHROMIUM_PATH` con la ruta a un Chromium compatible. Usa exclusivamente un
servidor local y respuestas simuladas de Supabase. Está preparada para siete
escenarios a 390 y 1440 px: visitante, Gratis, Premium, Diamante, error de permisos,
administrador y creadora. No equivale a una prueba de integración real.

## Matriz obligatoria en un entorno aislado

| Caso | Resultado esperado |
|---|---|
| Visitante | Gate +18, términos/privacidad, perfiles públicos; sin chat |
| Gratis que abre chat | Explicación de Premium, sin insertar conversación ni mensaje |
| Premium válido | Contenido Premium, texto y emojis; no multimedia ni solicitud de video |
| Creadora conversa con Premium | Puede texto, no enviarle ni recibir multimedia |
| Diamante válido | Contenido Diamante y permisos multimedia; video sigue sujeto a aceptación |
| Membresía futura/vencida/sin verificar | Sin acceso de pago, aunque el perfil diga diamond |
| Cuenta suspendida | Sin acceso privado |
| Usuario intenta activar su plan mediante RPC | Denegado |
| Solicitud repetida | Mismo identificador, sin duplicar filas |
| Verificación repetida | No renueva vigencia ni repite auditoría |
| Pago con referencia reutilizada | Denegado |
| Cancelar membresía ajena | Denegado |
| Cancelar membresía propia activa | Mantiene acceso hasta ends_at |
| Cambiar perfil/rol desde cliente | No permite autopromoción ni activación de plan |
| Admin revisa chat | Motivo, auditoría y notificación conservados |
| Recuperar contraseña y registro | Conservan flujos, aceptaciones y cuenta pendiente |
| Creadora publica/edita perfil | Solo recursos propios, moderación conservada |
| Experiencias | Solicitud con membresía válida, confirmación y respuesta conservadas |
| Error de red o RPC ausente | Acceso pagado bloqueado; mensaje claro, sin asignar permisos por defecto |
| Navegación móvil | Sin desbordamiento; formularios, planes y modales utilizables |

También probar peticiones directas que eviten los botones: lecturas de contenido
restringido, INSERT multimedia, obtención de URL firmada, aceptación de llamada
ajena y acceso a perfiles privados. No dar por válida RLS por ocultar controles.

No se avanzará a otra fase grande hasta revisar estos pendientes y recibir
confirmación. El paquete no debe publicarse como versión terminada.
