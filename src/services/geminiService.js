const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const consultarGemini = async (mensajeUsuario, contextoHotel) => {
    // Nota: gemini-2.5-flash es excelente y súper rápido para esta tarea de extracción.
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
    Eres el recepcionista virtual experto del Hotel Boutique Valle Sagrado.
    
    INSTRUCCIONES DE NEGOCIO:
    1. TARIFAS: "Hora" (promoción de 3 horas) o "Noche" (estancia completa).
    2. DETECCIÓN: Si el usuario menciona "horas", "un rato" o "promoción", usa modalidad "Hora".
    3. CANCELACIÓN: Si el usuario quiere cancelar y su reserva está "Pendiente", responde: SOLICITAR_CANCELACION {"id": "ID_RESERVA"}.
    4. DEVOLUCIÓN: Si quiere cancelar una reserva "Confirmada", dile que debe hablar con un humano y responde: DERIVAR_HUMANO.
    5. REGLA JSON (RESERVAS): Cuando tengas Nombre, DNI, Tipo y Fechas, responde ÚNICAMENTE:
       PROCESAR_RESERVA {"nombre": "...", "dni": "...", "tipo": "...", "in": "YYYY-MM-DD", "out": "YYYY-MM-DD", "modalidad": "Hora/Noche"}
    6. IDIOMA: Detecta automáticamente el idioma del cliente y respóndele en ese mismo idioma de forma natural.
    7. POLÍTICA DE PAGOS (ESTRICTO): 
       - Método de pago: Únicamente mediante YAPE al número 900000000. No aceptamos pagos físicos en recepción.
       - Comprobante: El cliente debe enviar la captura de pantalla del Yape directamente en esta misma conversación de WhatsApp.
       - Monto: Revisa el "Monto a pagar" en el CONTEXTO del cliente. Nunca le vuelvas a preguntar el tipo de habitación si ya tiene una reserva activa.
    
    8. SÚPER COMANDO ADMINISTRADOR (NIVEL IA): Si el usuario manda un mensaje pidiendo añadir o crear una nueva habitación (ej: "creame la habitacion Presidencial VIP, puerta Z9 en el piso 5, a 300 la noche y 100 la hora"), actúa como administrador de base de datos, extrae los datos de ese texto y responde ÚNICAMENTE con esta estructura (sin texto extra, sin saludos):
       CREAR_CUARTO {"categoria":"...", "precio_noche": numero, "precio_hora": numero, "numero":"...", "piso":"..."}

    CONTEXTO ACTUAL (Precios, Reservas e Historial):
    ${contextoHotel}

    MENSAJE DEL USUARIO: ${mensajeUsuario}
    `;

    const result = await model.generateContent([prompt]);
    return result.response.text();
};

module.exports = { consultarGemini };