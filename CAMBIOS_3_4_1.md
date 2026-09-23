# CARLÉA 3.4.1 — Videollamadas y pagos

- Corrige la consulta de `payment_requests` indicando explícitamente la relación de `user_id` y `reviewed_by` con `profiles`.
- Elimina el error de PostgREST: `Could not embed because more than one relationship was found for 'payment_requests' and 'profiles'`.
- Añade botones **Confirmar pago** y **Rechazar pago** directamente en Administración > Videollamadas cuando el pago está pendiente.
- Mantiene Administración > Pagos como centro general de validación.
- Usa `admin_review_payment` del backend; la creadora solo puede aceptar la llamada después de que el administrador confirme el pago.
