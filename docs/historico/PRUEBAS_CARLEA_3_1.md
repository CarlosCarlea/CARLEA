# Histórico 3.1. No aplicar sus instrucciones a la revisión 3.2.

# CARLÉA 3.1 MVP — pruebas antes de producción

Esta entrega no modifica por sí sola la base de producción. Primero debe probarse `MIGRACION_CARLEA_3_1_GLOBAL.sql` en un proyecto separado o en una copia controlada.

## Matriz mínima

1. Visitante: acepta +18 y políticas; ve perfiles y publicaciones públicas sin iniciar sesión.
2. Registro: formulario completo, validación de edad, contraseñas coincidentes, aceptaciones separadas y regreso sin crear cuenta.
3. Gratis aprobado: mantiene acceso público, pero chat, Premium y Diamante permanecen bloqueados.
4. Premium global: ve contenido Premium y abre chat de texto con cualquier creadora activa.
5. Premium global: no puede enviar/recibir multimedia ni solicitar videollamada.
6. Diamante global: ve todos los niveles, usa multimedia y solicita videollamada.
7. Creadora: solo administra su perfil, publicaciones, conversaciones y solicitudes.
8. Administrador: aprueba cuentas, modera contenido y activa una suscripción global por un mes.
9. Cuenta suspendida: pierde las funciones privadas aunque tenga una suscripción vigente.
10. Seguridad: un usuario no puede leer suscripciones, registro, chats, documentos o archivos de otro usuario.

## Pendientes deliberados

- Pasarela y webhook de pago.
- TURN para garantizar videollamadas entre redes restrictivas.
- Borrado automático de documentos de identidad.
- Streaming y notificaciones push.
- Revisión jurídica final y datos reales del responsable.
