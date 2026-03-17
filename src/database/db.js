const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 20
});

const db = pool.promise();

const consultarDisponibilidadSegura = async (tipo, fechaIn, fechaOut) => {
    const consulta = `
        SELECT hd.id, hd.numero, hd.piso, h.precio_noche, h.precio_hora
        FROM habitaciones_detalle hd
        JOIN habitaciones h ON hd.id_categoria = h.id
        WHERE h.tipo LIKE ? AND hd.estado_limpieza = 'Limpia'
        AND hd.id NOT IN (
            SELECT id_habitacion FROM reservas 
            WHERE estado IN ('Pendiente', 'Confirmada')
            AND NOT (fecha_salida <= ? OR fecha_ingreso >= ?)
        ) LIMIT 1 FOR UPDATE;`;
        
    const [filas] = await db.query(consulta, [`%${tipo}%`, fechaIn, fechaOut]);
    return filas[0];
};

const tieneReservaActiva = async (identificador) => {
    const [filas] = await db.query(
        "SELECT COUNT(*) as total FROM reservas WHERE (dni_cliente=? OR telefono_cliente=?) AND estado IN ('Pendiente','Confirmada')", 
        [identificador, identificador]
    );
    return filas[0].total > 0;
};

const registrarReserva = async (datos) => {
    const [resultado] = await db.query(
        "INSERT INTO reservas (id_habitacion, nombre_cliente, dni_cliente, telefono_cliente, fecha_ingreso, fecha_salida, tipo_reserva, estado) VALUES (?,?,?,?,?,?,?, 'Pendiente')",
        [datos.id_habitacion, datos.nombre, datos.dni, datos.telefono, datos.fecha_ingreso, datos.fecha_salida, datos.tipo_reserva]
    );

    return resultado.insertId;
};

// ==========================================
// SPRINT 4: AUDITORÍA Y REPORTES
// ==========================================

// HU08: Almacenamiento de Chats (Usando tu tabla original historial_chats)
const guardarHistorialChat = async (telefono, mensajeUsuario, respuestaBot, idioma = 'es') => {
    try {
        await db.query(
            "INSERT INTO historial_chats (telefono_cliente, mensaje_usuario, respuesta_bot, idioma_detectado) VALUES (?, ?, ?, ?)", 
            [telefono, mensajeUsuario, respuestaBot, idioma]
        );
    } catch (error) {
        console.error("Error guardando el historial de chat:", error);
    }
};

// HU12: Reportes Estadísticos (Ventas y Estados)
const obtenerReporteEstadistico = async () => {
    try {
        // 1. Conteo de estados de reservas (Pendientes, Confirmadas, Canceladas)
        const [estados] = await db.query(`
            SELECT estado, COUNT(*) as cantidad FROM reservas GROUP BY estado;
        `);
        
        // 2. Ventas (Hoy, Semana, Mes, Año) de reservas Confirmadas
        // Sumamos el precio de hora o noche dependiendo del tipo de reserva
        const [ventas] = await db.query(`
            SELECT 
                SUM(CASE WHEN DATE(r.fecha_registro) = CURDATE() THEN (CASE WHEN r.tipo_reserva = 'Hora' THEN h.precio_hora ELSE h.precio_noche END) ELSE 0 END) as hoy,
                SUM(CASE WHEN YEARWEEK(r.fecha_registro, 1) = YEARWEEK(CURDATE(), 1) THEN (CASE WHEN r.tipo_reserva = 'Hora' THEN h.precio_hora ELSE h.precio_noche END) ELSE 0 END) as semana,
                SUM(CASE WHEN MONTH(r.fecha_registro) = MONTH(CURDATE()) AND YEAR(r.fecha_registro) = YEAR(CURDATE()) THEN (CASE WHEN r.tipo_reserva = 'Hora' THEN h.precio_hora ELSE h.precio_noche END) ELSE 0 END) as mes,
                SUM(CASE WHEN YEAR(r.fecha_registro) = YEAR(CURDATE()) THEN (CASE WHEN r.tipo_reserva = 'Hora' THEN h.precio_hora ELSE h.precio_noche END) ELSE 0 END) as anio
            FROM reservas r 
            JOIN habitaciones_detalle hd ON r.id_habitacion = hd.id 
            JOIN habitaciones h ON hd.id_categoria = h.id
            WHERE r.estado = 'Confirmada';
        `);

        return { 
            estados: estados, 
            ventas: ventas[0] || { hoy: 0, semana: 0, mes: 0, anio: 0 } 
        };
    } catch (error) {
        console.error("Error generando reporte:", error);
        return { estados: [], ventas: { hoy: 0, semana: 0, mes: 0, anio: 0 } };
    }
};

// ==========================================
// MÓDULO ADMINISTRATIVO (ANTIGUO - MANTENIDO POR SPRINT ANTERIOR)
// ==========================================
const añadirHabitacion = async (tipo, precioNoche, precioHora) => {
    const [res] = await db.query(
        "INSERT INTO habitaciones (tipo, precio_noche, precio_hora, capacidad) VALUES (?, ?, ?, 2)", 
        [tipo, precioNoche, precioHora]
    );
    return res.insertId;
};

// ==========================================
// MÓDULO ADMINISTRATIVO (NUEVO NIVEL IA)
// ==========================================
const añadirHabitacionFisica = async (datos) => {
    const conexion = await db.getConnection();
    await conexion.beginTransaction();
    
    try {
        // 1. Buscamos si la categoría ya existe (ej: "Suite Presidencial")
        const [categorias] = await conexion.query(
            "SELECT id FROM habitaciones WHERE tipo LIKE ?", 
            [`%${datos.categoria}%`]
        );
        
        let idCategoria;

        if (categorias.length > 0) {
            // Ya existe, reciclamos su ID
            idCategoria = categorias[0].id;
        } else {
            // No existe, creamos la nueva categoría
            const [nuevaCat] = await conexion.query(
                "INSERT INTO habitaciones (tipo, precio_noche, precio_hora, capacidad) VALUES (?, ?, ?, 2)", 
                [datos.categoria, datos.precio_noche, datos.precio_hora]
            );
            idCategoria = nuevaCat.insertId;
        }

        // 2. Insertamos la puerta física en la tabla detalle (Por defecto "Limpia")
        await conexion.query(
            "INSERT INTO habitaciones_detalle (id_categoria, numero, piso, estado_limpieza) VALUES (?, ?, ?, 'Limpia')",
            [idCategoria, datos.numero, datos.piso]
        );

        await conexion.commit();
        return { exito: true, id_categoria: idCategoria };
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }
};

module.exports = { 
    db, 
    consultarDisponibilidadSegura, 
    tieneReservaActiva, 
    registrarReserva,
    guardarHistorialChat,
    obtenerReporteEstadistico,
    añadirHabitacion,
    añadirHabitacionFisica
};