# CARLÉA 3.2.2 — Corrección de integración

## Alcance

Copia del paquete 3.1 con el original conservado. No se ejecutó la migración
contra Supabase, no se publicó el sitio y no se realizaron pagos, registros,
mensajes ni modificaciones remotas. La inspección remota fue de metadatos:
tablas, columnas, funciones, restricciones y políticas.

Esta entrega aborda el conflicto previo a la arquitectura de membresías.
No declara terminadas las 21 fases ni certifica la seguridad del sistema completo.

### Ajuste guardado para la próxima entrega

Después de autenticar, la aplicación vuelve a consultar `profiles`, refresca la
cuenta y abre el ambiente correspondiente: `admin` para administración,
`studio` para creadoras activas, `home` para clientes activos y `profile` para
cuentas pendientes o suspendidas. Los roles se leen de la tabla protegida
`profiles`; no se toman de metadatos editables del usuario. Los eventos de
actualización o renovación de sesión también refrescan el ambiente sin ejecutar
consultas asíncronas dentro del callback de Auth.

### Catálogo, publicaciones y registro

- Las portadas locales se resuelven desde la ubicación real del módulo y tienen
  una imagen de respaldo si una URL falla.
- Inicio toma la portada elegida o, en su ausencia, la foto pública aprobada más
  reciente de cada creadora.
- Cambios en `creators` y `content` actualizan las vistas abiertas mediante
  Realtime; los formularios locales también recargan su estado inmediatamente.
- El estudio muestra la vista previa de fotos y videos pendientes, aprobados o
  rechazados.
- Se añadieron los privilegios mínimos que faltaban para guardar contenido y
  actualizar perfil/portada, conservando RLS.
- Crear una cuenta ya no se bloquea por datos legales pendientes. Pagos y carga
  de documentos privados continúan bloqueados hasta completar esos datos.

## Reutilización y tablas

Se conservan `profiles`, `creators`, `content`, `conversations`, `messages`,
`notifications`, `experiences`, `experience_requests`, `client_subscriptions`,
`admin_audit`, los buckets y las funciones de autorización existentes.
No se crea ninguna tabla nueva. `creator_memberships`, `registration_requests`
y `payment_requests` permanecen sin cambios; no se conectan a un pago ficticio.

`platform_plans`, `platform_subscriptions` y `registration_details`, citadas por
el frontend 3.1, no existían en el esquema inspeccionado. Se retiraron esas
consultas de la copia. Las propuestas antiguas permanecen en `docs/historico`
con advertencias: no deben aplicarse a esta base.

## Fuente de permisos

La matriz está en `carlea_private.membership_capabilities`; el navegador recibe
capacidades mediante `get_my_entitlements` y `conversation_capabilities`.
No deduce permisos de `profiles.plan` ni concede Diamante por ser creadora.
Los permisos administrativos y de propiedad del contenido siguen separados.

Para conceder acceso nuevo, la cuenta y la membresía deben estar activas, el pago
debe tener revisión registrada y el período debe haber comenzado sin haber
vencido. Como transición, una membresía activa creada antes del corte 3.2
conserva exclusivamente su período original no vencido; no se renueva ni se
extiende. `essential`, `none` o un perfil con `plan=diamond` no bastan para
obtener acceso.

| Plan | Contenido | Chat | Multimedia y solicitud de video |
|---|---|---|---|
| Gratis | Público | No | No |
| Premium · $19.900 COP/mes | Público + Premium | Texto y emojis | No |
| Diamante · $39.900 COP/mes | Público + Premium + Diamante | Texto y emojis | Sí; video requiere aceptación |

La multimedia de la conversación depende de la membresía vigente del cliente,
también cuando envía la creadora. Las políticas existentes de contenido,
mensajes, Storage y llamadas reutilizan los helpers corregidos. Su interacción
con el esquema completo todavía debe comprobarse en un entorno aislado.

## MIGRATION 001

Archivo: `supabase/migrations/20260921161704_membership_entitlements_review.sql`.
Creado con Supabase CLI, sin enlazar ni desplegar el proyecto.

- Añade a `client_subscriptions`: `cancel_at_period_end`, `cancelled_at`,
  `verified_at`, `verified_by` y `payment_reference`.
- Incluye FK del verificador, índices y referencia de pago única.
- Conserva historial y políticas SELECT de propietario/administrador.
- Retira escritura directa del cliente; utiliza RPC con validación.
- Serializa solicitud/cancelación/verificación bloqueando la cuenta.
- Evita duplicar solicitudes; permite hasta cinco nuevas solicitudes por día.
- Registra verificación manual en `admin_audit` y notifica al usuario.
- Repetir la misma verificación no extiende el período ni duplica auditoría.
- Cancelar conserva el acceso hasta `ends_at`.

Es una migración de una sola ejecución con control de versiones. Las columnas
usan `IF NOT EXISTS`; no se debe reejecutar a mano. La constraint nueva es
`NOT VALID` para conservar datos históricos: protege nuevas escrituras y debe
validarse después de revisar el historial. La transacción evita una aplicación
parcial. No hay DROP TABLE ni borrado o conversión automática de registros.

### Revisión histórica obligatoria

Las filas antiguas quedan con `verified_at=NULL`. Si ya estaban activas antes del
corte 3.2, conservan únicamente la vigencia que ya tenían y quedan marcadas para
revisión; al vencer dejan de otorgar acceso. Las filas pendientes y todas las
nuevas solicitudes no otorgan acceso hasta verificar su pago. Esta transición
evita cortar una membresía legítima sin convertir ni inventar pagos históricos.

La función administrativa permite verificar una fila histórica activa y vigente
sin extender su fecha. Rechaza períodos inválidos, vencidos o solapados. Cada
pago necesita una referencia no secreta y comprobación humana externa.

### Límite de la verificación manual

Registra una decisión de un administrador autorizado; NO consulta bancos ni
verifica criptográficamente un pago. No es Wompi, Mercado Pago ni un webhook.
No hay renovaciones automáticas ni débito recurrente.

Los RPC heredados de pago simulado se conservaron para no borrar flujos sin
revisión. Esta interfaz no los llama y sus definiciones inspeccionadas no
escriben los campos nuevos de verificación. Antes del lanzamiento deben
aislarse/deshabilitarse y revisarse sus efectos secundarios: la función
administrativa heredada aún puede modificar perfiles y suscripciones.

## Archivos y sustituciones

Es una copia completa para comparar y probar; no pegar fragmentos encima del
archivo minificado anterior. No publicarla todavía.

| Archivo | Cambio |
|---|---|
| `js/app.js` | Reemplaza `tierFor`, `loadAccount`, `plansPage` y la rama administrativa de membresías; añade carga de permisos y avisos de mejora |
| `js/membership.js` | Adaptador de capacidades, comprobación local de vencimiento, nombres y precios; no concede permisos por rol |
| `js/chat.js` | Extiende manejadores existentes: revalida permisos antes de texto, archivos, micrófono y solicitud de video |
| `js/api.js`, `styles.css` | Formato legible, sin cambios funcionales |
| `index.html` | Formato legible y etiqueta de revisión; gate y legales conservados |
| `supabase/migrations/…sql` | Sustituye helpers existentes y añade RPC de solicitud, cancelación y verificación |
| `tests/` | Reemplaza comprobaciones obsoletas y añade pruebas locales |

El registro envía `account_type` y `full_name` esperados por el trigger existente.
No se creó un segundo registro ni otro sistema de experiencias. Se conservaron
autenticación, recuperación, moderación, perfiles, galerías y WebRTC existente.
La validación de edad y aceptaciones en servidor todavía requiere una revisión
dedicada del onboarding.

Se quitaron referencias internas a personas, etiquetas incorrectas de planes e
instrucciones de despliegue incompatibles. No se recortaron legales, mayoría de
edad, consentimiento, privacidad o seguridad. No se anuncia seguir/favoritos
como terminado: esas funciones siguen pendientes de su fase.

## Antes de aprobar aplicación o publicación

1. Copiar el esquema completo en un proyecto aislado con datos sintéticos.
2. Cambiar `js/config.js` y `_redirects` al proyecto de pruebas. Nunca colocar
   credenciales privilegiadas en el navegador.
3. Revisar SQL y membresías históricas. No cargar documentos reales.
4. Aplicar solo la migración nueva al entorno de pruebas, después de autorizarlo.
5. Ejecutar la matriz de `VALIDACION.md` con todos los roles y planes.
6. Comprobar denegaciones con llamadas directas sin la interfaz.
7. Validar móvil, recuperación, contenido, experiencias, RLS y Storage.
8. Acordar revisión histórica, respaldo, ventana de cambio y procedimiento de retorno.
9. Solicitar confirmación independiente antes de producción o publicación.

## Pendientes fuera de esta revisión

Chat con no leídos/lecturas, reconexión sin polling continuo, bandeja móvil
separada, grabación con previsualización/cancelación, inspección del contenido
real de archivos en servidor, rate limiting general, seguir/favoritos, bloqueo
y reportes completos, estadísticas, pagos reales, webhooks, PWA y auditoría final.

Se preservó el flujo heredado de llamadas (`requested/accepted/declined/ended`);
no equivale a los seis estados oficiales solicitados. No se validó WebRTC en
redes reales. Las URLs firmadas ya emitidas mantienen su TTL de cinco minutos;
no se ha implementado revocación instantánea de archivos ya descargados.
