const express = require("express");
const { Pool } = require("pg"); // Quédate solo con esta
const bodyParser = require("body-parser");
const fs = require("fs");
const axios = require('axios');
require('dotenv').config();

const app = express();
const path = require('path');
const { exec } = require('child_process');

// --- CONFIGURACIÓN DE CONEXIÓN ---
// Soporta tanto local como Railway/Supabase

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Emanuel01112@localhost:5432/Consultorio',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000
});

// Log para saber a qué BD nos conectamos (útil para depuración)
console.log(`📊 Conectando a base de datos: ${process.env.DATABASE_URL ? 'REMOTA (Railway/Supabase)' : 'LOCAL (PostgreSQL)'}`);

app.use(bodyParser.json());

// Configuración para asegurar UTF-8 en todas las respuestas
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    next();
});

// ========== CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ==========
// Servir archivos desde la raíz del proyecto
app.use(express.static(__dirname));

// Servir archivos desde la carpeta public (si existe)
app.use(express.static(path.join(__dirname, 'public')));

// Servir carpetas específicas para garantizar que funcionen
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/plugins', express.static(path.join(__dirname, 'plugins')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Middleware para log de archivos solicitados (opcional, para depuración)
app.use((req, res, next) => {
    console.log(`📁 Solicitado: ${req.url}`);
    next();
});
// Servir archivos estáticos con UTF-8
app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
            res.setHeader('Content-Type', `${res.getHeader('Content-Type')}; charset=utf-8`);
        }
    }
}));

app.use(express.static("public"));

// --- 1. MIDDLEWARE DE SEGURIDAD ---
const isAdmin = (req, res, next) => {
    const usuarioHeader = req.headers['x-user-admin']; 
    if (usuarioHeader === 'admin') {
        next(); 
    } else {
        res.status(403).json({ ok: false, message: "Acceso denegado." });
    }
};

// --- 2. RUTAS DE USUARIOS Y LOGIN ---
app.post("/login", async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT * FROM usuarios WHERE usuario = $1 AND password = $2", 
            [usuario, password]
        );
        
        if (result.rows.length > 0) {
            res.json({ success: true });
        } else {
            // Enviamos "message" para que el HTML lo encuentre
            res.json({ success: false, message: "Usuario o contraseña incorrectos" });
        }
    } catch (err) {
        console.error("❌ Error en la base de datos:", err.message);
        // Si hay un error de conexión, también lo enviamos como "message"
        res.status(500).json({ success: false, message: "Error de conexión: " + err.message });
    }
});

// --- 3. GESTIÓN DE TURNOS ---
app.get("/turnos", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM turnos ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



//Guardar Turno Nuevo
app.post("/guardar-turno", async (req, res) => {
    const { consultorio, medico, nombre, dni, fecha, hora, telefono, mensaje } = req.body;

    function getFechaLocalStr() {
        const fecha = new Date();
        const anio = fecha.getFullYear();
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const dia = String(fecha.getDate()).padStart(2, '0');
        return `${anio}-${mes}-${dia}`;
    }

    const hoyStr = getFechaLocalStr();
    const fechaTurnoStr = fecha;

    if (fechaTurnoStr < hoyStr) {
        return res.status(400).json({ 
            error: "No se pueden asignar turnos en fechas anteriores al día de hoy" 
        });
    }

    try {
        const verificar = await pool.query(
            "SELECT * FROM turnos WHERE fecha = $1 AND hora = $2 AND medico = $3",
            [fecha, hora, medico]
        );
        
        if (verificar.rows.length > 0) {
            return res.status(400).json({ 
                error: `El Dr. ${medico} ya tiene un turno asignado para el día ${fecha} a las ${hora}` 
            });
        }
        
        let pacienteId;
        const pacienteExistente = await pool.query(
            "SELECT id, nombre, telefono FROM pacientes WHERE dni = $1",
            [dni]
        );
        
        if (pacienteExistente.rows.length > 0) {
            pacienteId = pacienteExistente.rows[0].id;
            if (pacienteExistente.rows[0].nombre !== nombre || 
                pacienteExistente.rows[0].telefono !== telefono) {
                await pool.query(
                    `UPDATE pacientes SET nombre = $1, telefono = $2, updated_at = CURRENT_TIMESTAMP 
                     WHERE dni = $3`,
                    [nombre, telefono, dni]
                );
            }
        } else {
            const nuevoPaciente = await pool.query(
                `INSERT INTO pacientes (dni, nombre, telefono) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [dni, nombre, telefono]
            );
            pacienteId = nuevoPaciente.rows[0].id;
        }
        
        // INSERTAR Y DEVOLVER EL ID
        const result = await pool.query(
            `INSERT INTO turnos (consultorio, medico, nombre, dni, fecha, hora, telefono, mensaje, paciente_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [consultorio, medico, nombre, dni, fecha, hora, telefono, mensaje, pacienteId]
        );
        
        const turnoId = result.rows[0].id;
        
        // LOG IMPORTANTE - Verificar que se generó el ID
        console.log("✅ TURNO GUARDADO CON ID:", turnoId);
        
        res.json({ success: true, turnoId: turnoId });
        
    } catch (err) {
        console.error("Error al guardar:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// Obtener turno por DNI
app.get("/turnos/:dni", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM turnos WHERE dni = $1 ORDER BY id DESC LIMIT 1",
            [req.params.dni]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json(null);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.delete("/eliminar-turno/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM turnos WHERE id = $1", [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. HISTORIA CLÍNICA ---
app.get("/historia/:dni", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM historia_clinica WHERE paciente_dni = $1 ORDER BY id DESC", 
            [req.params.dni]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//Modificar Historia Guardar

app.post("/historia/guardar", async (req, res) => {
    const { paciente_dni, paciente_nombre, fecha, medico, diagnostico, tratamiento, telefono } = req.body;
    
    try {
        // Buscar o crear paciente
        let pacienteId;
        const pacienteExistente = await pool.query(
            "SELECT id FROM pacientes WHERE dni = $1",
            [paciente_dni]
        );
        
        if (pacienteExistente.rows.length > 0) {
            pacienteId = pacienteExistente.rows[0].id;
            // Actualizar datos del paciente
            await pool.query(
                `UPDATE pacientes SET nombre = $1, telefono = $2, updated_at = CURRENT_TIMESTAMP 
                 WHERE dni = $3`,
                [paciente_nombre, telefono || '', paciente_dni]
            );
        } else {
            // Crear nuevo paciente
            const nuevoPaciente = await pool.query(
                `INSERT INTO pacientes (dni, nombre, telefono) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [paciente_dni, paciente_nombre, telefono || '']
            );
            pacienteId = nuevoPaciente.rows[0].id;
        }
        
        // Guardar historia clínica con paciente_id
        const sql = `INSERT INTO historia_clinica (paciente_dni, paciente_nombre, fecha, medico, diagnostico, tratamiento, telefono, paciente_id) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
        
        await pool.query(sql, [paciente_dni, paciente_nombre, fecha, medico, diagnostico, tratamiento, telefono || '', pacienteId]);
        res.json({ ok: true });
        
    } catch (err) {
        console.error("Error al guardar historia:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// --- 5. ADMINISTRACIÓN (PROTEGIDO) ---
app.get("/usuarios", isAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, usuario FROM usuarios");
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.post("/usuarios/nuevo", isAdmin, async (req, res) => {
    const { usuario, password } = req.body;
    try {
        await pool.query("INSERT INTO usuarios (usuario, password) VALUES ($1, $2)", [usuario, password]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, message: "Error al crear usuario" });
    }
});

app.post("/usuarios/cambiar-pass", isAdmin, async (req, res) => {
    const { usuario, newPassword } = req.body;
    try {
        await pool.query("UPDATE usuarios SET password = $1 WHERE usuario = $2", [newPassword, usuario]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).send(err);
    }
});

// ELIMINAR registro de historia clínica
app.delete("/historia/eliminar/:id", async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query(
            "DELETE FROM historia_clinica WHERE id = $1 RETURNING *",
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                ok: false, 
                message: "Registro no encontrado" 
            });
        }
        
        res.json({ 
            ok: true, 
            message: "Registro eliminado correctamente",
            eliminado: result.rows[0]
        });
    } catch (err) {
        console.error("Error al eliminar:", err);
        res.status(500).json({ 
            ok: false, 
            error: err.message 
        });
    }
});

// MODIFICAR registro de historia clínica
app.put("/historia/editar/:id", async (req, res) => {
    const id = req.params.id;
    const { fecha, medico, diagnostico, tratamiento } = req.body;
    
    try {
        const result = await pool.query(
            `UPDATE historia_clinica 
             SET fecha = $1, medico = $2, diagnostico = $3, tratamiento = $4 
             WHERE id = $5 RETURNING *`,
            [fecha, medico, diagnostico, tratamiento, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                ok: false, 
                message: "Registro no encontrado" 
            });
        }
        
        res.json({ 
            ok: true, 
            message: "Registro actualizado correctamente",
            registro: result.rows[0]
        });
    } catch (err) {
        console.error("Error al actualizar:", err);
        res.status(500).json({ 
            ok: false, 
            error: err.message 
        });
    }
});

// Endpoint para verificar disponibilidad de turno (AGREGAR NUEVO)
app.get("/verificar-turno", async (req, res) => {
    const { fecha, hora, medico } = req.query;
    
    try {
        const result = await pool.query(
            "SELECT * FROM turnos WHERE fecha = $1 AND hora = $2 AND medico = $3",
            [fecha, hora, medico]
        );
        
        res.json({ 
            disponible: result.rows.length === 0 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ========== ENDPOINTS PARA MÉDICOS ==========

// Obtener todos los médicos
app.get("/medicos", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM medicos ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener médicos:", err);
        res.status(500).json({ error: err.message });
    }
});

// Agregar nuevo médico
app.post("/medicos", async (req, res) => {
    const { nombre, especialidad, telefono, email } = req.body;
    
    if (!nombre) {
        return res.status(400).json({ error: "El nombre es obligatorio" });
    }
    
    try {
        const result = await pool.query(
            "INSERT INTO medicos (nombre, especialidad, telefono, email) VALUES ($1, $2, $3, $4) RETURNING *",
            [nombre, especialidad || null, telefono || null, email || null]
        );
        res.json({ success: true, medico: result.rows[0] });
    } catch (err) {
        console.error("Error al crear médico:", err);
        res.status(500).json({ error: err.message });
    }
});

// Editar médico
app.put("/medicos/:id", async (req, res) => {
    const { id } = req.params;
    const { nombre, especialidad, telefono, email } = req.body;
    
    try {
        const result = await pool.query(
            "UPDATE medicos SET nombre = $1, especialidad = $2, telefono = $3, email = $4 WHERE id = $5 RETURNING *",
            [nombre, especialidad || null, telefono || null, email || null, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Médico no encontrado" });
        }
        
        res.json({ success: true, medico: result.rows[0] });
    } catch (err) {
        console.error("Error al actualizar médico:", err);
        res.status(500).json({ error: err.message });
    }
});

// Eliminar médico
app.delete("/medicos/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query("DELETE FROM medicos WHERE id = $1 RETURNING *", [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Médico no encontrado" });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error("Error al eliminar médico:", err);
        res.status(500).json({ error: err.message });
    }
});

// ========== ENDPOINTS PARA CONSULTORIOS ==========

// Obtener todos los consultorios
app.get("/consultorios", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM consultorios ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener consultorios:", err);
        res.status(500).json({ error: err.message });
    }
});

// Agregar nuevo consultorio
app.post("/consultorios", async (req, res) => {
    const { nombre, ubicacion, telefono } = req.body;
    
    if (!nombre) {
        return res.status(400).json({ error: "El nombre es obligatorio" });
    }
    
    try {
        const result = await pool.query(
            "INSERT INTO consultorios (nombre, ubicacion, telefono) VALUES ($1, $2, $3) RETURNING *",
            [nombre, ubicacion || null, telefono || null]
        );
        res.json({ success: true, consultorio: result.rows[0] });
    } catch (err) {
        console.error("Error al crear consultorio:", err);
        res.status(500).json({ error: err.message });
    }
});

// Editar consultorio
app.put("/consultorios/:id", async (req, res) => {
    const { id } = req.params;
    const { nombre, ubicacion, telefono } = req.body;
    
    try {
        const result = await pool.query(
            "UPDATE consultorios SET nombre = $1, ubicacion = $2, telefono = $3 WHERE id = $4 RETURNING *",
            [nombre, ubicacion || null, telefono || null, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Consultorio no encontrado" });
        }
        
        res.json({ success: true, consultorio: result.rows[0] });
    } catch (err) {
        console.error("Error al actualizar consultorio:", err);
        res.status(500).json({ error: err.message });
    }
});

// Eliminar consultorio
app.delete("/consultorios/:id", async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query("DELETE FROM consultorios WHERE id = $1 RETURNING *", [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Consultorio no encontrado" });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error("Error al eliminar consultorio:", err);
        res.status(500).json({ error: err.message });
    }
});


// Endpoint para médicos
app.get("/medicos", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM medicos ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener médicos:", err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para consultorios
app.get("/consultorios", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM consultorios ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener consultorios:", err);
        res.status(500).json({ error: err.message });
    }
});


// Obtener todos los usuarios (protegido)
app.get("/usuarios", isAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, usuario FROM usuarios ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener usuarios:", err);
        res.status(500).json({ error: err.message });
    }
});


// Eliminar usuario
app.delete("/usuarios/eliminar/:id", isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        // Verificar que no se elimine al admin
        const usuarioResult = await pool.query("SELECT usuario FROM usuarios WHERE id = $1", [id]);
        if (usuarioResult.rows.length > 0 && usuarioResult.rows[0].usuario === 'admin') {
            return res.status(400).json({ success: false, message: "No se puede eliminar al administrador principal" });
        }
        
        const result = await pool.query("DELETE FROM usuarios WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});



// ========== ENDPOINTS PARA PACIENTES ==========

// Obtener paciente por DNI
app.get("/pacientes/:dni", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM pacientes WHERE dni = $1",
            [req.params.dni]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json(null);
        }
    } catch (err) {
        console.error("Error al obtener paciente:", err);
        res.status(500).json({ error: err.message });
    }
});

// Crear o actualizar paciente completo
app.post("/pacientes", async (req, res) => {
    const { 
        dni, nombre, telefono, email, fecha_nacimiento, direccion, 
        obra_social, numero_afiliado, contacto_emergencia, 
        telefono_emergencia, alergias, antecedentes 
    } = req.body;
    
    console.log("📝 Recibida solicitud para guardar paciente:", { dni, nombre });
    
    // Validaciones básicas
    if (!dni || !nombre) {
        return res.status(400).json({ 
            success: false, 
            error: "DNI y nombre son obligatorios" 
        });
    }
    
    try {
        // Verificar si el paciente ya existe
        const existente = await pool.query(
            "SELECT id FROM pacientes WHERE dni = $1",
            [dni]
        );
        
        let paciente;
        
        if (existente.rows.length > 0) {
            // Actualizar paciente existente
            const result = await pool.query(
                `UPDATE pacientes SET 
                    nombre = $1, 
                    telefono = $2, 
                    email = $3, 
                    fecha_nacimiento = $4,
                    direccion = $5, 
                    obra_social = $6, 
                    numero_afiliado = $7,
                    contacto_emergencia = $8, 
                    telefono_emergencia = $9,
                    alergias = $10, 
                    antecedentes = $11, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE dni = $12 
                RETURNING *`,
                [
                    nombre, 
                    telefono || null, 
                    email || null, 
                    fecha_nacimiento || null, 
                    direccion || null, 
                    obra_social || null, 
                    numero_afiliado || null, 
                    contacto_emergencia || null, 
                    telefono_emergencia || null, 
                    alergias || null, 
                    antecedentes || null, 
                    dni
                ]
            );
            paciente = result.rows[0];
            console.log("✅ Paciente actualizado:", paciente.id);
        } else {
            // Crear nuevo paciente
            const result = await pool.query(
                `INSERT INTO pacientes 
                    (dni, nombre, telefono, email, fecha_nacimiento, direccion, 
                     obra_social, numero_afiliado, contacto_emergencia, 
                     telefono_emergencia, alergias, antecedentes) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
                RETURNING *`,
                [
                    dni, 
                    nombre, 
                    telefono || null, 
                    email || null, 
                    fecha_nacimiento || null, 
                    direccion || null, 
                    obra_social || null, 
                    numero_afiliado || null, 
                    contacto_emergencia || null, 
                    telefono_emergencia || null, 
                    alergias || null, 
                    antecedentes || null
                ]
            );
            paciente = result.rows[0];
            console.log("✅ Nuevo paciente creado:", paciente.id);
        }
        
        res.json({ success: true, paciente });
        
    } catch (err) {
        console.error("❌ Error al guardar paciente:", err);
        res.status(500).json({ 
            success: false, 
            error: err.message,
            details: err.stack
        });
    }
});

// Buscar pacientes por DNI o nombre (autocompletado)
app.get("/pacientes/buscar/:termino", async (req, res) => {
    const termino = req.params.termino;
    try {
        const result = await pool.query(
            `SELECT * FROM pacientes 
             WHERE dni ILIKE $1 OR nombre ILIKE $1 
             ORDER BY nombre LIMIT 10`,
            [`%${termino}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error al buscar pacientes:", err);
        res.status(500).json({ error: err.message });
    }
});

// Obtener todos los pacientes (para gestión)
app.get("/pacientes", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM pacientes ORDER BY nombre"
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener pacientes:", err);
        res.status(500).json({ error: err.message });
    }
});

// Eliminar paciente (con todas sus historias clínicas y turnos)
app.delete("/pacientes/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // Verificar si tiene turnos activos (futuros)
        const turnosActivos = await pool.query(
            "SELECT * FROM turnos WHERE paciente_id = $1 AND fecha >= CURRENT_DATE",
            [id]
        );
        
        if (turnosActivos.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `No se puede eliminar el paciente porque tiene ${turnosActivos.rows.length} turno(s) activo(s).`
            });
        }
        
        // Contar cuántas historias clínicas tiene
        const historiasCount = await pool.query(
            "SELECT COUNT(*) FROM historia_clinica WHERE paciente_id = $1",
            [id]
        );
        
        // Iniciar transacción para eliminar todo en orden
        await pool.query('BEGIN');
        
        try {
            // 1. Eliminar historias clínicas
            await pool.query("DELETE FROM historia_clinica WHERE paciente_id = $1", [id]);
            
            // 2. Eliminar turnos (solo los pasados, los activos ya se verificaron)
            await pool.query("DELETE FROM turnos WHERE paciente_id = $1", [id]);
            
            // 3. Eliminar paciente
            const result = await pool.query("DELETE FROM pacientes WHERE id = $1 RETURNING *", [id]);
            
            if (result.rows.length === 0) {
                throw new Error("Paciente no encontrado");
            }
            
            await pool.query('COMMIT');
            
            res.json({ 
                success: true,
                message: "Paciente eliminado correctamente",
                detalles: {
                    paciente: result.rows[0].nombre,
                    historias_eliminadas: parseInt(historiasCount.rows[0].count)
                }
            });
            
        } catch (err) {
            await pool.query('ROLLBACK');
            throw err;
        }
        
    } catch (err) {
        console.error("Error al eliminar paciente:", err);
        res.status(500).json({ 
            success: false, 
            message: err.message 
        });
    }
});


const archiver = require('archiver');

// ========== ENDPOINTS PARA BACKUP ==========

// Obtener listado de backups
app.get("/backup/listar", isAdmin, async (req, res) => {
    const backupsDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
    try {
        const files = fs.readdirSync(backupsDir);
        const backups = files.filter(file => file.endsWith('.sql')).map(file => {
            const stats = fs.statSync(path.join(backupsDir, file));
            return {
                nombre: file,
                tamaño: stats.size,
                fecha: stats.mtime
            };
        }).sort((a, b) => b.fecha - a.fecha);
        res.json({ success: true, backups });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Crear backup
app.post("/backup/crear", isAdmin, async (req, res) => {
    const { nombrePersonalizado } = req.body;
    const backupsDir = path.join(__dirname, 'backups');
    
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
    
    const fecha = new Date();
    const fechaStr = fecha.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // Eliminar espacios del nombre personalizado
    const nombreLimpio = nombrePersonalizado ? nombrePersonalizado.replace(/\s/g, '_') : '';
    const nombreArchivo = nombreLimpio 
        ? `${nombreLimpio}_${fechaStr}.sql`
        : `backup_${fechaStr}.sql`;
    const rutaArchivo = path.join(backupsDir, nombreArchivo);
    
    const dbConfig = {
        user: 'postgres',
        host: 'localhost',
        database: 'Consultorio',
        password: 'Emanuel01112',
        port: 5432
    };
    
    // Ruta completa de pg_dump (CAMBIAR LA VERSIÓN SEGÚN TU INSTALACIÓN)
    // Opción 1: PostgreSQL 18
    const pgDumpPath = `"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump"`;
    // Opción 2: PostgreSQL 15
    // const pgDumpPath = `"C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump"`;
    // Opción 3: PostgreSQL 14
    // const pgDumpPath = `"C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump"`;
    
    const dumpCommand = `${pgDumpPath} -U ${dbConfig.user} -h ${dbConfig.host} -p ${dbConfig.port} -d ${dbConfig.database} -F p -f "${rutaArchivo}"`;
    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    
    console.log("Ejecutando backup...");
    console.log("Comando:", dumpCommand);
    
    exec(dumpCommand, { env }, (error, stdout, stderr) => {
        if (error) {
            console.error("Error detallado:", error);
            return res.status(500).json({ 
                success: false, 
                error: "Error al crear el backup: " + error.message,
                detalle: stderr
            });
        }
        
        if (stderr) {
            console.warn("Advertencia:", stderr);
        }
        
        const stats = fs.statSync(rutaArchivo);
        res.json({ 
            success: true, 
            message: "Backup creado correctamente",
            archivo: nombreArchivo,
            ruta: rutaArchivo,
            tamaño: stats.size
        });
    });
});

// Descargar backup
app.get("/backup/descargar/:nombre", isAdmin, async (req, res) => {
    const { nombre } = req.params;
    const rutaArchivo = path.join(__dirname, 'backups', nombre);
    
    if (!fs.existsSync(rutaArchivo)) {
        return res.status(404).json({ success: false, error: "Archivo no encontrado" });
    }
    res.download(rutaArchivo, nombre);
});

// Eliminar backup
app.delete("/backup/eliminar/:nombre", isAdmin, async (req, res) => {
    const { nombre } = req.params;
    const rutaArchivo = path.join(__dirname, 'backups', nombre);
    
    if (!fs.existsSync(rutaArchivo)) {
        return res.status(404).json({ success: false, error: "Archivo no encontrado" });
    }
    
    try {
        fs.unlinkSync(rutaArchivo);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== CONFIGURACIÓN WHATSAPP BUSINESS ==========
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Función para enviar mensajes por WhatsApp Business
async function enviarMensajeWhatsApp(telefono, mensaje) {
    try {
        // Limpiar número de teléfono (formato internacional)
        let numeroLimpio = telefono.replace(/[^0-9]/g, '');
        if (numeroLimpio.startsWith('0')) {
            numeroLimpio = numeroLimpio.substring(1);
        }
        if (!numeroLimpio.startsWith('549')) {
            numeroLimpio = '549' + numeroLimpio;
        }
        
        const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
        
        const response = await axios({
            method: 'POST',
            url: url,
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: numeroLimpio,
                type: 'text',
                text: {
                    preview_url: false,
                    body: mensaje
                }
            }
        });
        
        return { success: true, messageId: response.data.messages[0].id };
    } catch (error) {
        console.error('Error enviando WhatsApp:', error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}

// Función para enviar plantillas
async function enviarPlantillaWhatsApp(telefono, templateName, componentes = []) {
    try {
        let numeroLimpio = telefono.replace(/[^0-9]/g, '');
        if (numeroLimpio.startsWith('0')) {
            numeroLimpio = numeroLimpio.substring(1);
        }
        if (!numeroLimpio.startsWith('549')) {
            numeroLimpio = '549' + numeroLimpio;
        }
        
        const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
        
        const response = await axios({
            method: 'POST',
            url: url,
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: numeroLimpio,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: 'es_AR' },
                    components: componentes
                }
            }
        });
        
        return { success: true, messageId: response.data.messages[0].id };
    } catch (error) {
        console.error('Error enviando plantilla:', error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
}

// ========== ENDPOINTS WHATSAPP BUSINESS ==========

// Endpoint para enviar confirmación de turno - VERSIÓN MEJORADA
app.post("/api/whatsapp/enviar-turno/:turnoId", async (req, res) => {
    try {
        const { turnoId } = req.params;
        
        console.log("📨 Solicitud WhatsApp recibida - ID:", turnoId);
        console.log("Tipo de ID:", typeof turnoId, "Valor:", turnoId);
        
        // Validar que el ID sea un número válido
        const turnoIdNumerico = parseInt(turnoId);
        if (isNaN(turnoIdNumerico)) {
            console.error("❌ ID inválido recibido:", turnoId);
            return res.status(400).json({ 
                success: false, 
                error: `ID de turno inválido: ${turnoId}. Debe ser un número.` 
            });
        }
        
        const turnoResult = await pool.query(
            `SELECT t.*, p.telefono as telefono_paciente
             FROM turnos t
             LEFT JOIN pacientes p ON t.dni = p.dni
             WHERE t.id = $1`,
            [turnoIdNumerico]
        );
        
        console.log("🔍 Búsqueda en BD - ID:", turnoIdNumerico);
        console.log("Resultados encontrados:", turnoResult.rows.length);
        
        if (turnoResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: `Turno con ID ${turnoIdNumerico} no encontrado` 
            });
        }
        
        const turno = turnoResult.rows[0];
        const telefono = turno.telefono || turno.telefono_paciente;
        
        if (!telefono) {
            return res.status(400).json({ 
                success: false, 
                error: "El paciente no tiene teléfono registrado" 
            });
        }
        
        const fechaFormateada = new Date(turno.fecha).toLocaleDateString('es-AR');
        const horaFormateada = turno.hora.substring(0, 5);
        
        const mensaje = `*🏥 CONSULTORIO MÉDICO - TURNO CONFIRMADO*%0A%0A` +
            `*Paciente:* ${turno.nombre}%0A` +
            `*DNI:* ${turno.dni || 'N/A'}%0A` +
            `*Médico:* ${turno.medico}%0A` +
            `*Consultorio:* ${turno.consultorio || 'No especificado'}%0A` +
            `*Fecha:* ${fechaFormateada}%0A` +
            `*Hora:* ${horaFormateada} hs%0A` +
            `*Motivo:* ${turno.mensaje || 'Consulta médica'}%0A%0A` +
            `⚠️ *Recomendaciones:*%0A` +
            `• Llegar con 10 minutos de anticipación%0A` +
            `• Traer DNI y documentación médica%0A` +
            `• Presentar este comprobante%0A%0A` +
            `¡Gracias por confiar en nosotros! 🏥`;
        
        const resultado = await enviarMensajeWhatsApp(telefono, mensaje);
        
        if (resultado.success) {
            res.json({ success: true, message: "Mensaje enviado", messageId: resultado.messageId });
        } else {
            res.status(500).json({ success: false, error: resultado.error });
        }
        
    } catch (error) {
        console.error("❌ Error enviando mensaje:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Endpoint para enviar recordatorio masivo (turnos de mañana)
app.post("/api/whatsapp/recordatorio-masivo", async (req, res) => {
    try {
        const manana = new Date();
        manana.setDate(manana.getDate() + 1);
        const fechaManana = manana.toISOString().split('T')[0];
        
        const turnosManana = await pool.query(
            `SELECT t.*, p.telefono as telefono_paciente
             FROM turnos t
             LEFT JOIN pacientes p ON t.dni = p.dni
             WHERE t.fecha = $1 AND t.fecha >= CURRENT_DATE`,
            [fechaManana]
        );
        
        const resultados = [];
        
        for (const turno of turnosManana.rows) {
            const telefono = turno.telefono || turno.telefono_paciente;
            if (telefono) {
                const fechaFormateada = new Date(turno.fecha).toLocaleDateString('es-AR');
                const horaFormateada = turno.hora.substring(0, 5);
                
                const mensaje = `*📅 RECORDATORIO DE TURNO*%0A%0A` +
                    `Hola *${turno.nombre}*, te recordamos que tienes un turno mañana:%0A%0A` +
                    `📅 *Fecha:* ${fechaFormateada}%0A` +
                    `⏰ *Hora:* ${horaFormateada} hs%0A` +
                    `👨‍⚕️ *Médico:* ${turno.medico}%0A%0A` +
                    `Por favor, confirma tu asistencia respondiendo:%0A` +
                    `✅ *SI* - Confirmo mi asistencia%0A` +
                    `❌ *NO* - Necesito reprogramar%0A%0A` +
                    `¡Esperamos verte! 🏥`;
                
                const resultado = await enviarMensajeWhatsApp(telefono, mensaje);
                resultados.push({ turno: turno.id, telefono, resultado: resultado.success });
                
                // Pausa para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        res.json({
            success: true,
            enviados: resultados.filter(r => r.resultado).length,
            total: turnosManana.rows.length,
            detalles: resultados
        });
        
    } catch (error) {
        console.error("Error enviando recordatorios:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Webhook para recibir respuestas de pacientes
app.get("/api/whatsapp/webhook", (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        console.log("Webhook verificado correctamente");
        res.status(200).send(challenge);
    } else {
        res.status(403).send('Forbidden');
    }
});

app.post("/api/whatsapp/webhook", async (req, res) => {
    try {
        const body = req.body;
        
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry[0];
            const changes = entry.changes[0];
            const message = changes.value.messages?.[0];
            
            if (message && message.type === 'text') {
                const telefono = message.from;
                const texto = message.text.body.toLowerCase();
                
                // Buscar paciente por teléfono
                const pacienteResult = await pool.query(
                    `SELECT * FROM pacientes WHERE telefono = $1 OR telefono LIKE $2`,
                    [telefono, `%${telefono.substring(3)}%`]
                );
                
                if (pacienteResult.rows.length > 0) {
                    const paciente = pacienteResult.rows[0];
                    
                    // Buscar turnos pendientes
                    const turnoResult = await pool.query(
                        `SELECT * FROM turnos 
                         WHERE dni = $1 AND fecha >= CURRENT_DATE 
                         ORDER BY fecha ASC LIMIT 1`,
                        [paciente.dni]
                    );
                    
                    if (turnoResult.rows.length > 0) {
                        const turno = turnoResult.rows[0];
                        
                        if (texto.includes('si') || texto.includes('confirmo') || texto === '1') {
                            // Confirmar turno
                            await pool.query(
                                `UPDATE turnos SET estado = 'confirmado' WHERE id = $1`,
                                [turno.id]
                            );
                            
                            const fechaFormateada = new Date(turno.fecha).toLocaleDateString('es-AR');
                            const mensajeConfirmacion = `✅ *TURNO CONFIRMADO*%0A%0A` +
                                `Gracias ${paciente.nombre}, tu turno ha sido confirmado.%0A%0A` +
                                `📅 Fecha: ${fechaFormateada}%0A` +
                                `⏰ Hora: ${turno.hora.substring(0, 5)} hs%0A%0A` +
                                `¡Te esperamos! 🏥`;
                            
                            await enviarMensajeWhatsApp(telefono, mensajeConfirmacion);
                            
                        } else if (texto.includes('no') || texto.includes('reprogramar') || texto === '2') {
                            // Cancelar turno
                            await pool.query(
                                `UPDATE turnos SET estado = 'cancelado' WHERE id = $1`,
                                [turno.id]
                            );
                            
                            const fechaFormateada = new Date(turno.fecha).toLocaleDateString('es-AR');
                            const mensajeCancelacion = `❌ *TURNO CANCELADO*%0A%0A` +
                                `Hola ${paciente.nombre}, hemos cancelado tu turno del día ${fechaFormateada}.%0A%0A` +
                                `Para solicitar un nuevo turno, contactanos al ${process.env.CONTACTO_ADMIN || 'tu número'}.%0A%0A` +
                                `¡Gracias por avisarnos! 🏥`;
                            
                            await enviarMensajeWhatsApp(telefono, mensajeCancelacion);
                        }
                        
                        // Registrar respuesta
                        await pool.query(
                            `INSERT INTO whatsapp_respuestas (telefono, mensaje_recibido, turno_id) 
                             VALUES ($1, $2, $3)`,
                            [telefono, texto, turno.id]
                        );
                    }
                }
            }
        }
        
        res.sendStatus(200);
        
    } catch (error) {
        console.error("Error en webhook:", error);
        res.sendStatus(500);
    }
});

// Endpoint para verificar estado de WhatsApp Business
app.get("/api/whatsapp/status", async (req, res) => {
    if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
        res.json({
            connected: false,
            error: "WhatsApp Business no está configurado"
        });
        return;
    }
    
    try {
        const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}`;
        const response = await axios({
            method: 'GET',
            url: url,
            headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
        });
        
        res.json({
            connected: true,
            phoneNumber: response.data.verified_name,
            quality_rating: response.data.quality_rating
        });
    } catch (error) {
        res.json({
            connected: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
});

// ========== MODIFICAR GUARDAR TURNO PARA DEVOLVER ID ==========
app.post("/guardar-turno", async (req, res) => {
    const { consultorio, medico, nombre, dni, fecha, hora, telefono, mensaje } = req.body;
    
    const hoyStr = getFechaLocalStr();
    const fechaTurnoStr = fecha;
    
    if (fechaTurnoStr < hoyStr) {
        return res.status(400).json({ 
            error: "No se pueden asignar turnos en fechas anteriores al día de hoy" 
        });
    }
    
    try {
        const verificar = await pool.query(
            "SELECT * FROM turnos WHERE fecha = $1 AND hora = $2 AND medico = $3",
            [fecha, hora, medico]
        );
        
        if (verificar.rows.length > 0) {
            return res.status(400).json({ 
                error: `El Dr. ${medico} ya tiene un turno asignado para el día ${fecha} a las ${hora}` 
            });
        }
        
        let pacienteId;
        const pacienteExistente = await pool.query(
            "SELECT id, nombre, telefono FROM pacientes WHERE dni = $1",
            [dni]
        );
        
        if (pacienteExistente.rows.length > 0) {
            pacienteId = pacienteExistente.rows[0].id;
            if (pacienteExistente.rows[0].nombre !== nombre || 
                pacienteExistente.rows[0].telefono !== telefono) {
                await pool.query(
                    `UPDATE pacientes SET nombre = $1, telefono = $2, updated_at = CURRENT_TIMESTAMP 
                     WHERE dni = $3`,
                    [nombre, telefono, dni]
                );
            }
        } else {
            const nuevoPaciente = await pool.query(
                `INSERT INTO pacientes (dni, nombre, telefono) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [dni, nombre, telefono]
            );
            pacienteId = nuevoPaciente.rows[0].id;
        }
        
        // Insertar y devolver el ID
        const result = await pool.query(
            `INSERT INTO turnos (consultorio, medico, nombre, dni, fecha, hora, telefono, mensaje, paciente_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [consultorio, medico, nombre, dni, fecha, hora, telefono, mensaje, pacienteId]
        );
        
        res.json({ success: true, turnoId: result.rows[0].id });
        
    } catch (err) {
        console.error("Error al guardar:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint para obtener el verify token (solo para mostrar en admin)
app.get("/api/whatsapp/verify-token", (req, res) => {
    res.json({ token: process.env.WHATSAPP_VERIFY_TOKEN || 'No configurado' });
});

 // Endpoint temporal para verificar los turnos (solo para depuración)
app.get("/api/debug/turnos", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, nombre, fecha FROM turnos ORDER BY id DESC LIMIT 5");
        res.json({ turnos: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Puerto dinámico para Railway (usa el que asigna la nube)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));