// app.js listo para Render o Railway
const express = require("express");
const http = require("http");
const { Server: WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server }); // SIN path personalizado

// Crear carpeta data si no existe
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log("📁 Carpeta /data creada");
}

// Rutas de archivos
const movementsPath = path.join(dataDir, "movements.json");
const contadoresPath = path.join(dataDir, "contadores.json");
const umbralesPath = path.join(dataDir, "umbrales.json");

// Inicializar archivos si no existen
if (!fs.existsSync(movementsPath)) fs.writeFileSync(movementsPath, "[]");
if (!fs.existsSync(contadoresPath)) fs.writeFileSync(contadoresPath, "{}");
if (!fs.existsSync(umbralesPath)) {
  const umbralesIniciales = {
    ancho: 1.5,
    alto: 2.0,
    cx: 0,
    cy: 0,
    zonaA: { cx: 2, cy: 2, ancho: 1, alto: 1 },
    zonaB: { cx: -2, cy: -2, ancho: 1, alto: 1 },
    modo: "completo"
  };
  fs.writeFileSync(umbralesPath, JSON.stringify(umbralesIniciales, null, 2));
}

// Cargar movimientos a caché
let logCache = [];
try {
  const raw = fs.readFileSync(movementsPath);
  logCache = JSON.parse(raw);
} catch (e) {
  logCache = [];
  console.warn("⚠️ movements.json estaba vacío o corrupto, se inicializa vacío");
}

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "public")));

// Rutas API REST simples (sin /ws-server)
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send("<h1>Servidor WebSocket activo ✅</h1>");
});

app.get("/movements", (req, res) => {
  try {
    const data = fs.readFileSync(movementsPath);
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: "Error al leer movimientos" });
  }
});

app.get("/contadores", (req, res) => {
  try {
    const data = fs.readFileSync(contadoresPath);
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: "Error al leer contadores" });
  }
});

app.post("/reset-contadores", express.json(), (req, res) => {
  fs.writeFileSync(contadoresPath, "{}");
  res.json({ status: "Contadores reiniciados" });
});

let horaReset = "6";

app.post("/hora-reset", express.json(), (req, res) => {
  if (req.body && req.body.hora) {
    horaReset = req.body.hora;
    programarResetContadores();
    res.json({ status: "Hora de reset actualizada", hora: horaReset });
  } else {
    res.status(400).json({ error: "Falta campo 'hora'" });
  }
});

cron.schedule("0 6 * * *", () => {
  fs.writeFileSync(movementsPath, "[]");
});

let tareaReset = null;
function programarResetContadores() {
  if (tareaReset) tareaReset.stop();
  const hora = parseInt(horaReset);
  if (!isNaN(hora) && hora >= 0 && hora <= 23) {
    tareaReset = cron.schedule(`0 ${hora} * * *`, () => {
      fs.writeFileSync(contadoresPath, "{}");
      console.log(`⏰ Contadores reiniciados automáticamente a las ${hora}:00`);
    });
  }
}
programarResetContadores();

setInterval(() => {
  try {
    fs.writeFileSync(movementsPath, JSON.stringify(logCache));
    console.log("💾 Movimientos guardados a disco.");
  } catch (e) {
    console.error("❌ Error guardando movimientos:", e);
  }
}, 5000);

let clients = [];
function broadcastExcept(sender, texto) {
  clients = clients.filter(c => c.readyState === 1);
  clients.forEach(c => { if (c !== sender) c.send(texto); });
}
function broadcastAll(texto) {
  clients = clients.filter(c => c.readyState === 1);
  clients.forEach(c => c.send(texto));
}

setInterval(() => {
  clients = clients.filter(c => c.readyState === 1);
  clients.forEach(c => {
    try { c.ping(); } catch (e) { console.error("Ping error:", e); }
  });
}, 30000);

wss.on("connection", (ws) => {
  clients.push(ws);
  console.log("📶 Cliente conectado. Total:", clients.length);

  ws.on("message", (message) => {
    const ip = ws._socket.remoteAddress;
    const texto = typeof message === "string" ? message : message.toString("utf8");

    try {
      const json = JSON.parse(texto);
      if (json.cmd) {
        broadcastExcept(ws, JSON.stringify({ cmd: json.cmd }));
        return;
      }

      if (json.tipo === "get_umbrales") {
        const raw = fs.readFileSync(umbralesPath);
        const config = JSON.parse(raw);
        ws.send(JSON.stringify({ umbrales: config }));
        return;
      }

      if (json.config) {
        try {
          fs.writeFileSync(umbralesPath, JSON.stringify(json.config, null, 2));
          console.log("💾 Umbrales guardados en disco:", umbralesPath);
        } catch (e) {
          console.error("❌ Error al guardar umbrales:", e);
        }
        broadcastExcept(ws, JSON.stringify({ umbrales: json.config }));
        return;
      }

      if (json.id !== undefined) {
        logCache.push({ ...json, timestamp: Date.now() });
        broadcastAll(JSON.stringify(json));
        return;
      }

      if (Array.isArray(json)) {
        const timestamp = Date.now();
        for (const p of json) logCache.push({ ...p, timestamp });
        broadcastAll(JSON.stringify(json));
        return;
      }

      if (json.evento === "cruce" && Array.isArray(json.trayectoria)) {
        const key = json.trayectoria.join("->");
        const contadores = JSON.parse(fs.readFileSync(contadoresPath));
        contadores[key] = (contadores[key] || 0) + 1;
        fs.writeFileSync(contadoresPath, JSON.stringify(contadores));
        broadcastAll(JSON.stringify({ tipo: "contador", key, valor: contadores[key] }));
        return;
      }

      if (json.conteos) {
        broadcastAll(JSON.stringify(json));
        return;
      }
    } catch (e) {
      console.warn(`❌ Mensaje inválido desde ${ip}:`, texto);
      console.warn(`🛠️ Detalle:`, e.message);
    }
  });

  ws.on("close", () => {
    clients = clients.filter(c => c !== ws);
    console.log("❌ Cliente desconectado. Quedan:", clients.length);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🌐 Servidor corriendo en puerto", PORT);
});
