const { create } = require('@wppconnect-team/wppconnect');
const { consultarGemini } = require('../services/geminiService');
const db = require('../database/db');

const historialMensajes = {};
const NUMERO_ADMIN = '51946476215@c.us'; 

async function iniciarBot() {
    const cliente = await create({
        session: 'Hotel-Boutique-Valle-Sagrado',
        catchQR: (base64Qr, asciiQR) => console.log(asciiQR),
        statusFind: (status) => console.log('Estatus:', status),
    });

    // =========================================================
    // SPRINT 4: TAREAS AUTOMÁTICAS (ALERTA CADA MINUTO)
    // =========================================================
    setInterval(async () => {
        try {
            // 1. CANCELACIÓN POR FALTA DE PAGO (30 minutos)
            const [expiradas] = await db.db.query("SELECT id, telefono_cliente FROM reservas WHERE estado = 'Pendiente' AND TIMESTAMPDIFF(MINUTE, fecha_registro, NOW()) >= 30");
            for (let reserva of expiradas) {
                await db.db.query("UPDATE reservas SET estado = 'Cancelada' WHERE id = ?", [reserva.id]);
                await cliente.sendText(reserva.telefono_cliente, `⏳ *TIEMPO AGOTADO:*\nTu reserva #${reserva.id} ha sido cancelada por falta de confirmación de pago (Expiró el plazo de 30 min). La habitación ha sido liberada nuevamente al público.`);
                await cliente.sendText(NUMERO_ADMIN, `🔔 *Sistema:* Reserva #${reserva.id} Auto-Cancelada (Pasaron 30 min sin pago).`);
            }

            // 2. RECORDATORIO DE CHECK-IN (30 minutos antes)
            // Asume que fecha_ingreso es un DATETIME (Ej: 2026-05-10 14:00:00)
            const [recordatorios] = await db.db.query("SELECT id, telefono_cliente, fecha_ingreso FROM reservas WHERE estado = 'Confirmada' AND recordatorio_enviado = 0 AND TIMESTAMPDIFF(MINUTE, NOW(), fecha_ingreso) BETWEEN 0 AND 30");
            for (let r of recordatorios) {
                await db.db.query("UPDATE reservas SET recordatorio_enviado = 1 WHERE id = ?", [r.id]);
                await cliente.sendText(r.telefono_cliente, `🛎️ *¡TU ESTADÍA SE ACERCA!*\nTe recordamos que tu reserva #${r.id} en el Hotel Boutique Valle Sagrado está programada para iniciar en aproximadamente 30 minutos. ¡Te esperamos en recepción!`);
            }
        } catch (error) { 
            console.log("Error en tareas automáticas (CronJobs):", error); 
        }
    }, 60000); // Se ejecuta cada 60,000 milisegundos (1 minuto)


    cliente.onMessage(async (mensaje) => {
        if (mensaje.isGroupMsg) return;
        const idUsuario = mensaje.from;

        // ---------------------------------------------------------
        // 1. LÓGICA DE ADMIN (CONFIRMAR, REPORTES Y HABITACIONES)
        // ---------------------------------------------------------
        if (idUsuario === NUMERO_ADMIN) {
            // A. Confirmar Pago
            if (mensaje.body.startsWith('#confirmar')) {
                const idReserva = mensaje.body.split(' ')[1];
                if (!idReserva) return cliente.sendText(idUsuario, "❌ Indica el ID. Ej: #confirmar 10");
                try {
                    await db.db.query("UPDATE reservas SET estado = 'Confirmada' WHERE id = ?", [idReserva]);
                    const [filas] = await db.db.query("SELECT telefono_cliente FROM reservas WHERE id = ?", [idReserva]);
                    if (filas.length > 0) {
                        await cliente.sendText(filas[0].telefono_cliente, `🌟 *¡PAGO VERIFICADO!* Tu reserva #${idReserva} ha sido confirmada. ¡Te esperamos!`);
                        await cliente.sendText(NUMERO_ADMIN, `✅ Reserva #${idReserva} activada y cliente notificado.`);
                    }
                } catch (err) {
                    console.error(err);
                    await cliente.sendText(NUMERO_ADMIN, "❌ Error al confirmar en la base de datos.");
                }
                return;
            }

            // B. Generar Reporte Estadístico (Sprint 4)
            if (mensaje.body === '#reporte') {
                const stats = await db.obtenerReporteEstadistico();
                let textoEstados = stats.estados.map(e => `▪️ ${e.estado}: ${e.cantidad}`).join('\n');
                let mensajeReporte = `📊 *REPORTE ESTADÍSTICO*\n\n📈 *Ventas Confirmadas:*\n- Hoy: S/ ${stats.ventas.hoy || 0}\n- Esta Semana: S/ ${stats.ventas.semana || 0}\n- Este Mes: S/ ${stats.ventas.mes || 0}\n- Este Año: S/ ${stats.ventas.anio || 0}\n\n📋 *Estado de Reservas:*\n${textoEstados || "Sin datos"}`;
                await cliente.sendText(NUMERO_ADMIN, mensajeReporte);
                return;
            }

            // C. Añadir Habitación a la BD (Sprint 4) - COMANDO ANTIGUO MANTENIDO
            if (mensaje.body.startsWith('#añadir_hab')) {
                // Formato: #añadir_hab Suite 200 80
                const partes = mensaje.body.split(' ');
                if(partes.length === 4) {
                    await db.añadirHabitacion(partes[1], partes[2], partes[3]);
                    await cliente.sendText(NUMERO_ADMIN, `✅ Categoría *${partes[1]}* agregada exitosamente a la Base de Datos.`);
                } else {
                    await cliente.sendText(NUMERO_ADMIN, `❌ Uso incorrecto. El formato es: #añadir_hab [Nombre] [PrecioNoche] [PrecioHora]`);
                }
                return;
            }
        }

        // ---------------------------------------------------------
        // 2. RECEPCIÓN DE COMPROBANTES (Imágenes)
        // ---------------------------------------------------------
        if (mensaje.type === 'image') {
            await cliente.sendText(idUsuario, "📸 *Comprobante recibido.* Lo validaremos en breve y te confirmaremos tu reserva.");
            
            let numeroLimpio = idUsuario.replace('@c.us', '');
            let infoParaAdmin = `🔔 *ALERTA DE IMAGEN:*\nEl número ${numeroLimpio} envió una foto.\n👉 *Revisar chat:* https://wa.me/${numeroLimpio}`;
            
            try {
                // Buscamos la reserva 'Pendiente' de este cliente para darle los datos exactos al Admin
                const [reserva] = await db.db.query(
                    `SELECT r.id, r.nombre_cliente, r.tipo_reserva, h.precio_noche, h.precio_hora
                     FROM reservas r 
                     JOIN habitaciones_detalle hd ON r.id_habitacion = hd.id 
                     JOIN habitaciones h ON hd.id_categoria = h.id
                     WHERE r.telefono_cliente = ? AND r.estado = 'Pendiente'
                     ORDER BY r.id DESC LIMIT 1`, [idUsuario]
                );
                
                if (reserva.length > 0) {
                    const r = reserva[0];
                    const precioCobrado = r.tipo_reserva === 'Hora' ? r.precio_hora : r.precio_noche;
                    infoParaAdmin = `🔔 *NUEVO VOUCHER DE PAGO*\n\n` +
                                    `👤 *Cliente:* ${r.nombre_cliente}\n` +
                                    `🪪 *Reserva ID:* #${r.id}\n` +
                                    `💰 *Monto a verificar:* S/ ${precioCobrado}\n` +
                                    `📱 *WhatsApp:* ${numeroLimpio}\n\n` +
                                    `👀 *Ver voucher aquí:* https://wa.me/${numeroLimpio}\n\n` +
                                    `👉 Para aprobar escribe: *#confirmar ${r.id}*`;
                }
            } catch (errorDb) { 
                console.log("Error buscando info del comprobante", errorDb); 
            }
            
            // Le enviamos el texto detallado al Admin
            await cliente.sendText(NUMERO_ADMIN, infoParaAdmin);
            return;
        }

        if (mensaje.type !== 'chat') return;

        // ---------------------------------------------------------
        // 3. CONTEXTO DINÁMICO Y RECONOCIMIENTO
        // ---------------------------------------------------------
        let infoReservaUsuario = "El usuario no tiene reservas registradas.";
        try {
            const [reserva] = await db.db.query(
                `SELECT r.id, r.nombre_cliente, r.estado, r.tipo_reserva, h.tipo, hd.numero, h.precio_noche, h.precio_hora
                 FROM reservas r 
                 JOIN habitaciones_detalle hd ON r.id_habitacion = hd.id 
                 JOIN habitaciones h ON hd.id_categoria = h.id
                 WHERE r.telefono_cliente = ? AND r.estado IN ('Pendiente', 'Confirmada') 
                 ORDER BY r.id DESC LIMIT 1`, [idUsuario]
            );
            if (reserva.length > 0) {
                const r = reserva[0];
                const precioAsignado = r.tipo_reserva === 'Hora' ? r.precio_hora : r.precio_noche;
                infoReservaUsuario = `CLIENTE CONOCIDO: ${r.nombre_cliente}. Tiene la reserva #${r.id} (${r.estado}) en la habitación ${r.numero}. Modalidad: ${r.tipo_reserva}. Monto a pagar exacto: S/ ${precioAsignado}.`;
                
                if (mensaje.body.toLowerCase().includes('reservar') || mensaje.body.toLowerCase().includes('habitación')) {
                    const aviso = `⚠️ Hola ${r.nombre_cliente}, ya tienes una gestión activa (#${r.id}). Por favor, termínala o solicita ayuda humana.`;
                    await cliente.sendText(idUsuario, aviso);
                    await db.guardarHistorialChat(idUsuario, mensaje.body, aviso, 'es'); // Guardar en logs
                    return;
                }
            }
        } catch (e) { console.log("Error consultando reserva previa"); }

        // ---------------------------------------------------------
        // 4. MEMORIA E IA
        // ---------------------------------------------------------
        if (!historialMensajes[idUsuario]) historialMensajes[idUsuario] = [];
        historialMensajes[idUsuario].push(`Usuario: ${mensaje.body}`);
        if (historialMensajes[idUsuario].length > 8) historialMensajes[idUsuario].shift();
        
        try {
            const [precios] = await db.db.query("SELECT tipo, precio_noche, precio_hora, capacidad FROM habitaciones");
            const contextoGlobal = `
                Precios y Tipos: ${JSON.stringify(precios)}
                Datos Cliente DB: ${infoReservaUsuario}
                Historial: ${historialMensajes[idUsuario].join('\n')}
            `;
            
            const respuestaIA = await consultarGemini(mensaje.body, contextoGlobal);

            // =======================================================
            // NUEVO SPRINT 4: GUARDAR HISTORIAL PARA AUDITORÍA
            // =======================================================
            await db.guardarHistorialChat(idUsuario, mensaje.body, respuestaIA, 'es');

            // =======================================================
            // NUEVO COMANDO IA: CREAR HABITACIÓN FÍSICA
            // =======================================================
            if (respuestaIA.includes("CREAR_CUARTO")) {
                // Seguridad: Solo el Administrador puede crear cuartos
                if (idUsuario !== NUMERO_ADMIN) {
                    return cliente.sendText(idUsuario, "❌ No tienes permisos de administrador para realizar esta acción.");
                }

                try {
                    const jsonRaw = respuestaIA.split("CREAR_CUARTO")[1].trim();
                    const datosCuarto = JSON.parse(jsonRaw);
                    
                    await db.añadirHabitacionFisica(datosCuarto);
                    
                    const msgExito = `🤖 *IA ADMINISTRATIVA:* ¡Habitación creada con éxito en la Base de Datos!\n\n` +
                                     `🏨 *Categoría:* ${datosCuarto.categoria}\n` +
                                     `🚪 *Puerta:* ${datosCuarto.numero} (Piso ${datosCuarto.piso})\n` +
                                     `💰 *Precios:* S/ ${datosCuarto.precio_noche} x Noche | S/ ${datosCuarto.precio_hora} x Hora`;
                    
                    return cliente.sendText(idUsuario, msgExito);
                } catch (error) {
                    console.error("Error al crear cuarto con IA:", error);
                    return cliente.sendText(idUsuario, "❌ Hubo un error en la Base de Datos al intentar crear la habitación física.");
                }
            }

            // HU07: Derivación humana y Quejas
            if (respuestaIA.includes("DERIVAR_HUMANO")) {
                await cliente.sendText(idUsuario, "Entiendo. Un recepcionista tomará tu caso en unos instantes. 👋");
                await cliente.sendText(NUMERO_ADMIN, `🚨 *ATENCIÓN REQUERIDA (Queja/Ayuda):*\nEl cliente ${idUsuario.replace('@c.us', '')} requiere atención humana inmediata.\n👉 *Ir al chat:* https://wa.me/${idUsuario.replace('@c.us', '')}`);
                return;
            }

            // HU08: Cancelación de Reserva
            if (respuestaIA.includes("SOLICITAR_CANCELACION")) {
                const jsonRaw = respuestaIA.split("SOLICITAR_CANCELACION")[1].trim();
                const datosCancelacion = JSON.parse(jsonRaw);
                await db.db.query("UPDATE reservas SET estado = 'Cancelada' WHERE id = ?", [datosCancelacion.id]);
                historialMensajes[idUsuario] = [];
                return cliente.sendText(idUsuario, `❌ *RESERVA CANCELADA:* La reserva #${datosCancelacion.id} ha sido anulada con éxito y la habitación está libre nuevamente.`);
            }

            // HU03: Procesar Reserva (Manejo de Transacciones)
            if (respuestaIA.includes("PROCESAR_RESERVA")) {
                const jsonRaw = respuestaIA.split("PROCESAR_RESERVA")[1].trim();
                const datos = JSON.parse(jsonRaw);
                const conexion = await db.db.getConnection();
                await conexion.beginTransaction();
                
                try {
                    const duplicado = await db.tieneReservaActiva(datos.dni);
                    if (duplicado) {
                        await conexion.rollback();
                        return cliente.sendText(idUsuario, "⚠️ Tu DNI ya tiene una reserva vigente.");
                    }
                    
                    const disponible = await db.consultarDisponibilidadSegura(datos.tipo, datos.in, datos.out);
                    
                    if (!disponible) {
                        await conexion.rollback();
                        return cliente.sendText(idUsuario, "❌ Lo sentimos, no hay habitaciones disponibles para esas fechas/horas.");
                    }
                    
                    // Mejoras de precio por hora/noche
                    const esPorHora = datos.modalidad === 'Hora' || mensaje.body.toLowerCase().includes('hora');
                    const precioFinal = esPorHora ? disponible.precio_hora : disponible.precio_noche;
                    const tipoFinal = esPorHora ? 'Hora' : 'Noche';
                    
                    const reservaId = await db.registrarReserva({
                        id_habitacion: disponible.id,
                        nombre: datos.nombre,
                        dni: datos.dni,
                        telefono: idUsuario,
                        fecha_ingreso: datos.in,
                        fecha_salida: datos.out,
                        tipo_reserva: tipoFinal
                    });
                    
                    await conexion.commit();
                    historialMensajes[idUsuario] = []; 
                    
                    const msgConfirmacion = `✅ *¡REGISTRO PENDIENTE!* (ID: #${reservaId})\n\n` +
                                            `🏠 *Habitación:* ${disponible.numero} (Piso ${disponible.piso})\n` +
                                            `💰 *Total a pagar:* S/ ${precioFinal}\n\n` + 
                                            `Por favor, yapee al *946476215* y envíe la captura por aquí para confirmar.\n` +
                                            `⚠️ *Importante:* Tiene 30 minutos para confirmar el pago, de lo contrario el sistema cancelará la reserva automáticamente.`;
                    
                    await cliente.sendText(idUsuario, msgConfirmacion);
                    await db.guardarHistorialChat(idUsuario, mensaje.body, msgConfirmacion, 'es'); // Guardamos esto también
                    return;
                } catch (err) {
                    await conexion.rollback();
                    throw err;
                } finally {
                    conexion.release();
                }
            }

            // Flujo normal de conversación
            historialMensajes[idUsuario].push(`Asistente: ${respuestaIA}`);
            await cliente.sendText(idUsuario, respuestaIA);

        } catch (error) {
            console.error(error);
            await cliente.sendText(idUsuario, "Ups, tuve un inconveniente técnico de comunicación. ¿Podrías repetir tu solicitud?");
        }
    });
}
module.exports = { iniciarBot };