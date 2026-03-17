const { iniciarBot } = require('./src/bot/whatsappClient');

async function main() {
    try {
        console.log("====================================================");
        console.log("   SISTEMA DE ASISTENCIA INTELIGENTE - HOTEL B.VS   ");
        console.log("   INICIANDO MÓDULO ADMINISTRATIVO E IA (SPRINT 4)  "); 
        console.log("====================================================");

        await iniciarBot();

        console.log(">>> [LOG] El bot está operando y esperando mensajes...");

        // Pequeño recordatorio visual en consola para ti
        console.log(">>> [LOG] Comandos de Admin Activos: #confirmar, #reporte, #añadir_hab");
        console.log(">>> [LOG] IA Administrativa Activa para creación de habitaciones en lenguaje natural.");

    } catch (error) {
        console.error(">>> [ERROR] No se pudo iniciar el servidor:", error);
        process.exit(1);
    }
}

main();